import { relative, resolve } from "node:path";

import type { Node } from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import type {
  Checker,
  Project,
  Signature,
  Symbol as TypeScriptSymbol,
} from "typescript/unstable/sync";
import { API, SymbolFlags } from "typescript/unstable/sync";

import type { ApiEntry, ApiParam, MarkdownPage } from "./types.ts";

const ENTRYPOINTS = [
  ["@corsa-bind/napi", "src/bindings/nodejs/corsa_node/ts/index.ts"],
  ["corsa-oxlint", "src/bindings/nodejs/corsa_oxlint/ts/index.ts"],
  ["corsa-oxlint/rules", "src/bindings/nodejs/corsa_oxlint/ts/rules/index.ts"],
  ["corsa-oxlint/stylistic", "src/bindings/nodejs/corsa_oxlint/ts/stylistic.ts"],
] as const;

const PUBLIC_API_KINDS: ReadonlySet<SyntaxKind> = new Set([
  SyntaxKind.ClassDeclaration,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.VariableDeclaration,
]);

/**
 * Builds API reference Markdown from public TypeScript exports and JSDoc.
 *
 * TypeScript 7 replaced the in-process compiler API with the out-of-process
 * `typescript/unstable/sync` API, so entrypoints are opened as files and each
 * one is documented through the configured project that already owns it. That
 * keeps the `paths` mapping in the binding tsconfigs authoritative instead of
 * restating compiler options here.
 */
export function buildApiPages(rootDir: string): MarkdownPage[] {
  const files = ENTRYPOINTS.map(([, path]) => resolve(rootDir, path));
  const api = new API({ cwd: rootDir });
  try {
    const snapshot = api.updateSnapshot({ openFiles: files });
    try {
      const pages = ENTRYPOINTS.map(([name], index) =>
        modulePage(rootDir, snapshot.getDefaultProjectForFile(files[index]), name, files[index]),
      );
      return [indexPage(pages), ...pages];
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}

function modulePage(
  rootDir: string,
  project: Project | undefined,
  name: string,
  file: string,
): MarkdownPage {
  const source = project?.program.getSourceFile(file);
  const moduleSymbol = project && source ? project.checker.getSymbolAtLocation(source) : undefined;
  const entries =
    project && moduleSymbol
      ? project.checker
          .getExportsOfModule(moduleSymbol)
          .flatMap((symbol) => apiEntry(rootDir, project, symbol))
      : [];
  const apiFile = apiFileName(name);
  return {
    route: `api/${apiFile}/index.html`,
    sourcePath: `api/${apiFile}.md`,
    markdown: renderModuleMarkdown(name, entries),
  };
}

function apiEntry(rootDir: string, project: Project, symbol: TypeScriptSymbol): ApiEntry[] {
  const checker = project.checker;
  const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const handle = target.valueDeclaration ?? target.declarations[0];
  const declaration = handle?.resolve(project);
  if (!declaration || !PUBLIC_API_KINDS.has(declaration.kind)) {
    return [];
  }
  const source = declaration.getSourceFile();
  const signature = signatureText(project, target, declaration);
  const line = source.getLineAndCharacterOfPosition(declaration.getStart(source)).line + 1;
  return [
    {
      name: symbol.name,
      kind: kindOf(declaration),
      description: target.getDocumentationComment(checker),
      signature,
      sourcePath: relative(rootDir, source.fileName),
      line,
      params: paramsOf(checker, declaration),
      returns: returnsOf(checker, declaration),
    },
  ];
}

function signatureText(project: Project, symbol: TypeScriptSymbol, node: Node): string {
  const checker = project.checker;
  if (node.kind === SyntaxKind.FunctionDeclaration) {
    const signature = checker.getSignatureFromDeclaration(node);
    const call = signature ? callSignatureText(project, signature, node) : undefined;
    return call ? `${symbol.name}${call}` : symbol.name;
  }
  if (node.kind === SyntaxKind.VariableDeclaration) {
    return `const ${symbol.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node))}`;
  }
  return node.getText(node.getSourceFile()).split("{", 1)[0].trim();
}

/**
 * Renders `(a: string, b?: number): void`.
 *
 * TypeScript 7 dropped `signatureToString`, so the signature is rebuilt as a
 * call signature node and printed. That keeps type parameters and optional
 * parameter markers, which a parameter-by-parameter render would lose.
 */
function callSignatureText(project: Project, signature: Signature, node: Node): string | undefined {
  const printed = project.checker.signatureToSignatureDeclaration(
    signature,
    SyntaxKind.CallSignature,
    node,
  );
  return printed ? project.emitter.printNode(printed).replace(/;$/, "") : undefined;
}

function paramsOf(checker: Checker, node: Node): ApiParam[] {
  const signature = signatureOfFunction(checker, node);
  return (
    signature?.getParameters().map((param) => ({
      name: param.name,
      type: typeTextOfSymbol(checker, param, node),
      description: param.getDocumentationComment(checker),
    })) ?? []
  );
}

function returnsOf(checker: Checker, node: Node): string | undefined {
  const signature = signatureOfFunction(checker, node);
  const returnType = signature ? checker.getReturnTypeOfSignature(signature) : undefined;
  return returnType ? checker.typeToString(returnType) : undefined;
}

function signatureOfFunction(checker: Checker, node: Node): Signature | undefined {
  return node.kind === SyntaxKind.FunctionDeclaration
    ? checker.getSignatureFromDeclaration(node)
    : undefined;
}

function typeTextOfSymbol(checker: Checker, symbol: TypeScriptSymbol, node: Node): string {
  return checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node));
}

function kindOf(node: Node): string {
  switch (node.kind) {
    case SyntaxKind.ClassDeclaration:
      return "class";
    case SyntaxKind.InterfaceDeclaration:
      return "interface";
    case SyntaxKind.TypeAliasDeclaration:
      return "type";
    case SyntaxKind.FunctionDeclaration:
      return "function";
    default:
      return "value";
  }
}

function renderModuleMarkdown(name: string, entries: ApiEntry[]): string {
  const body = entries.map(renderEntry).join("\n\n");
  return `---\ntitle: ${JSON.stringify(`${name} API`)}\n---\n\n# ${name}\n\n${entries.length} documented exports.\n\n${body}\n`;
}

function renderEntry(entry: ApiEntry): string {
  const params = entry.params.length
    ? `\n\n| Parameter | Type | Description |\n| --- | --- | --- |\n${entry.params
        .map((param) => `| \`${param.name}\` | \`${param.type}\` | ${param.description || "-"} |`)
        .join("\n")}`
    : "";
  const returns = entry.returns ? `\n\nReturns: \`${entry.returns}\`` : "";
  return `## ${entry.name}\n\n${entry.description || "_No documentation comment yet._"}\n\n\`\`\`ts\n${entry.signature}\n\`\`\`\n\n[Source](https://github.com/ubugeeei-prod/corsa-bind/blob/main/${entry.sourcePath}#L${entry.line})${params}${returns}`;
}

function indexPage(pages: MarkdownPage[]): MarkdownPage {
  const links = pages.map((page) => {
    const label = page.sourcePath.replace(/^api\//, "").replace(/\.md$/, "");
    const href = page.sourcePath.replace(/^api\//, "");
    return `- [${label}](./${href})`;
  });
  return {
    route: "api/index.html",
    sourcePath: "api/index.md",
    markdown: `---\ntitle: "API reference"\n---\n\n# API reference\n\n${links.join("\n")}\n`,
  };
}

function apiFileName(name: string): string {
  return name.replace(/^@/, "").replaceAll("/", "-");
}
