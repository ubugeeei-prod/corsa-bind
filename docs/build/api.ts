import { relative } from "node:path";

import ts from "typescript";

import type { ApiEntry, ApiParam, MarkdownPage } from "./types.ts";

const ENTRYPOINTS = [
  ["@corsa-bind/napi", "src/bindings/nodejs/corsa_node/ts/index.ts"],
  ["corsa-oxlint", "src/bindings/nodejs/corsa_oxlint/ts/index.ts"],
  ["corsa-oxlint/rules", "src/bindings/nodejs/corsa_oxlint/ts/rules/index.ts"],
] as const;

/** Builds API reference Markdown from public TypeScript exports and JSDoc. */
export function buildApiPages(rootDir: string): MarkdownPage[] {
  const program = ts.createProgram(
    ENTRYPOINTS.map(([, path]) => path),
    {
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    },
  );
  const checker = program.getTypeChecker();
  const pages = ENTRYPOINTS.map(([name, path]) =>
    modulePage(rootDir, program, checker, name, path),
  );
  return [indexPage(pages), ...pages];
}

function modulePage(
  rootDir: string,
  program: ts.Program,
  checker: ts.TypeChecker,
  name: string,
  path: string,
): MarkdownPage {
  const source = program.getSourceFile(path);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  const entries = moduleSymbol
    ? checker
        .getExportsOfModule(moduleSymbol)
        .flatMap((symbol) => apiEntry(rootDir, checker, symbol))
    : [];
  const file = apiFileName(name);
  return {
    route: `api/${file}/index.html`,
    sourcePath: `api/${file}.md`,
    markdown: renderModuleMarkdown(name, entries),
  };
}

function apiEntry(rootDir: string, checker: ts.TypeChecker, symbol: ts.Symbol): ApiEntry[] {
  const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = target.valueDeclaration ?? target.declarations?.[0];
  if (!declaration || !isPublicApiDeclaration(declaration)) {
    return [];
  }
  const source = declaration.getSourceFile();
  const signature = signatureText(checker, target, declaration);
  const line = source.getLineAndCharacterOfPosition(declaration.getStart()).line + 1;
  return [
    {
      name: symbol.getName(),
      kind: kindOf(declaration),
      description: ts.displayPartsToString(target.getDocumentationComment(checker)),
      signature,
      sourcePath: relative(rootDir, source.fileName),
      line,
      params: paramsOf(checker, declaration),
      returns: returnsOf(checker, declaration),
    },
  ];
}

function isPublicApiDeclaration(node: ts.Declaration): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableDeclaration(node)
  );
}

function signatureText(checker: ts.TypeChecker, symbol: ts.Symbol, node: ts.Declaration): string {
  if (ts.isFunctionDeclaration(node)) {
    const signature = checker.getSignatureFromDeclaration(node);
    return signature ? `${symbol.name}${checker.signatureToString(signature)}` : symbol.name;
  }
  if (ts.isVariableDeclaration(node)) {
    return `const ${symbol.name}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, node))}`;
  }
  return node.getText(node.getSourceFile()).split("{", 1)[0].trim();
}

function paramsOf(checker: ts.TypeChecker, node: ts.Declaration): ApiParam[] {
  const signature = ts.isFunctionDeclaration(node)
    ? checker.getSignatureFromDeclaration(node)
    : undefined;
  return (
    signature?.getParameters().map((param) => ({
      name: param.name,
      type: checker.typeToString(checker.getTypeOfSymbolAtLocation(param, node)),
      description: ts.displayPartsToString(param.getDocumentationComment(checker)),
    })) ?? []
  );
}

function returnsOf(checker: ts.TypeChecker, node: ts.Declaration): string | undefined {
  const signature = ts.isFunctionDeclaration(node)
    ? checker.getSignatureFromDeclaration(node)
    : undefined;
  return signature ? checker.typeToString(signature.getReturnType()) : undefined;
}

function kindOf(node: ts.Declaration): string {
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isFunctionDeclaration(node)) return "function";
  return "value";
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
  return `## ${entry.name}\n\n${entry.description || "_No documentation comment yet._"}\n\n\`\`\`ts\n${entry.signature}\n\`\`\`\n\n[Source](https://github.com/ubugeeei/corsa-bind/blob/main/${entry.sourcePath}#L${entry.line})${params}${returns}`;
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
