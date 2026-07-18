import type { Node } from "@oxlint/plugins";

import { createNodeMaps, toPosition } from "./node_map";
import { sessionForContext } from "./registry";
import type { CorsaProjectSession } from "./session";
import { SignatureKind } from "./types";
import type {
  ContextWithParserOptions,
  CorsaNode,
  CorsaProgramShape,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypeCheckerShape,
} from "./types";

type ImplementingClassCache = {
  readonly sourceText: string;
  readonly names: ReadonlySet<string>;
};

const implementingClassNamesBySession = new WeakMap<
  CorsaProjectSession,
  Map<string, ImplementingClassCache>
>();

export function createProgram(
  context: ContextWithParserOptions,
): CorsaProgramShape & { readonly nodeMaps: ReturnType<typeof createNodeMaps> } {
  const nodeMaps = createNodeMaps(context);
  return {
    nodeMaps,
    getCompilerOptions() {
      return sessionForContext(context).session.getCompilerOptions();
    },
    getCurrentDirectory() {
      return sessionForContext(context).project.rootDir;
    },
    getRootFileNames() {
      return sessionForContext(context).session.getRootFileNames();
    },
    getSourceFile(fileName = context.filename) {
      return { fileName, text: context.sourceCode.text };
    },
    getTypeChecker() {
      return createTypeChecker(context);
    },
  };
}

export function createTypeChecker(context: ContextWithParserOptions): CorsaTypeCheckerShape {
  return {
    getTypeAtLocation(node) {
      if ((node as { readonly type?: string }).type === "NewExpression") {
        return typeOfNewExpression(node as Node, this);
      }
      const lookupNode = nodeForTypeLookup(node);
      return sessionForContext(context).session.getTypeAtSourceRange(
        filenameFor(context, lookupNode),
        toPosition(lookupNode),
        endPosition(lookupNode),
        sourceTextFor(context, lookupNode),
        nodeKind(lookupNode),
      );
    },
    getContextualType(node) {
      return this.getTypeAtLocation(node);
    },
    getSymbolAtLocation(node) {
      const lookupNode = nodeForTypeLookup(node);
      return sessionForContext(context).session.getSymbolAtPosition(
        filenameFor(context, lookupNode),
        toPosition(lookupNode),
        sourceTextFor(context, lookupNode),
      );
    },
    getSymbol(symbol) {
      return sessionForContext(context).session.getSymbol(symbol);
    },
    getSymbolById(id) {
      return sessionForContext(context).session.getSymbol(id);
    },
    getSymbolOfType(type) {
      return sessionForContext(context).session.getSymbolOfType(type);
    },
    getNode(node) {
      return sessionForContext(context).session.getNode(node);
    },
    getNodeById(id) {
      return sessionForContext(context).session.getNode(id);
    },
    getTypeOfSymbol(symbol) {
      return sessionForContext(context).session.getTypeOfSymbol(symbol);
    },
    getTypeOfSymbolById(id) {
      return sessionForContext(context).session.getTypeOfSymbolById(id);
    },
    getDeclaredTypeOfSymbol(symbol) {
      return sessionForContext(context).session.getDeclaredTypeOfSymbol(symbol);
    },
    getDeclaredTypeOfSymbolById(id) {
      return sessionForContext(context).session.getDeclaredTypeOfSymbolById(id);
    },
    getTypeOfSymbolAtLocation(symbol, node) {
      return (
        this.getTypeOfSymbol(symbol) ??
        this.getDeclaredTypeOfSymbol(symbol) ??
        this.getTypeAtLocation(node)
      );
    },
    typeToString(type, enclosingDeclaration, flags) {
      void enclosingDeclaration;
      return sessionForContext(context).session.typeToString(type, flags);
    },
    getBaseTypeOfLiteralType(type) {
      return sessionForContext(context).session.getBaseTypeOfLiteralType(type);
    },
    getPropertiesOfType(type) {
      return sessionForContext(context).session.getPropertiesOfType(type);
    },
    getSignaturesOfType(type, kind) {
      return sessionForContext(context).session.getSignaturesOfType(type, kind);
    },
    getCallSignatureFacts(type, kind, argumentTypeTexts, explicitTypeArgumentTexts) {
      return sessionForContext(context).session.getCallSignatureFacts(
        type,
        kind,
        argumentTypeTexts,
        explicitTypeArgumentTexts,
      );
    },
    getReturnTypeOfSignature(signature) {
      return sessionForContext(context).session.getReturnTypeOfSignature(signature);
    },
    getTypePredicateOfSignature(signature) {
      return sessionForContext(context).session.getTypePredicateOfSignature(signature);
    },
    getBaseTypes(type) {
      return sessionForContext(context).session.getBaseTypes(type);
    },
    getImplementedTypes(node) {
      if ("pos" in node) {
        return implementedTypesFromCorsaNode(context, node, this);
      }
      const sourceText = sourceTextFor(context, node);
      const sourceNode = sourceText ? corsaNodeFromEstree(context, node) : undefined;
      if (sourceText && sourceNode) {
        const implemented = implementedTypesFromSourceText(context, sourceNode, sourceText, this);
        if (implemented.length > 0) {
          return implemented;
        }
      }
      return implementedClauseNodes(node)
        .map((clause) => {
          const expression = implementedClauseChildNode(clause, "expression") ?? clause;
          const symbol = this.getSymbolAtLocation(expression) ?? this.getSymbolAtLocation(clause);
          return symbol
            ? (this.getDeclaredTypeOfSymbol(symbol) ?? this.getTypeOfSymbol(symbol))
            : (this.getTypeAtLocation(expression) ?? this.getTypeAtLocation(clause));
        })
        .filter((type): type is CorsaType => type !== undefined);
    },
    getImplementedTypesOfType(type) {
      return implementedTypesFromTypeAndBases(context, type, this);
    },
    getTypeArguments(type) {
      return sessionForContext(context).session.getTypeArguments(type);
    },
    getTypesOfType(type) {
      return sessionForContext(context).session.getTypesOfType(type);
    },
    getTargetOfType(type) {
      return sessionForContext(context).session.getTargetOfType(type);
    },
    getTypeParametersOfType(type) {
      return sessionForContext(context).session.getTypeParametersOfType(type);
    },
    getOuterTypeParametersOfType(type) {
      return sessionForContext(context).session.getOuterTypeParametersOfType(type);
    },
    getLocalTypeParametersOfType(type) {
      return sessionForContext(context).session.getLocalTypeParametersOfType(type);
    },
    getObjectTypeOfType(type) {
      return sessionForContext(context).session.getObjectTypeOfType(type);
    },
    getIndexTypeOfType(type) {
      return sessionForContext(context).session.getIndexTypeOfType(type);
    },
    getCheckTypeOfType(type) {
      return sessionForContext(context).session.getCheckTypeOfType(type);
    },
    getExtendsTypeOfType(type) {
      return sessionForContext(context).session.getExtendsTypeOfType(type);
    },
    getBaseTypeOfType(type) {
      return sessionForContext(context).session.getBaseTypeOfType(type);
    },
    getConstraintOfType(type) {
      return sessionForContext(context).session.getConstraintOfType(type);
    },
    isUnionType(type) {
      return (type.flags & typeFlags.union) !== 0;
    },
    isIntersectionType(type) {
      return (type.flags & typeFlags.intersection) !== 0;
    },
  };
}

const typeFlags = {
  union: 1 << 27,
  intersection: 1 << 28,
} as const;

function sourceTextFor(
  context: ContextWithParserOptions,
  node: Node | CorsaNode | CorsaType | CorsaSymbol | CorsaSignature,
): string | undefined {
  return sourceTextForPath(context, filenameFor(context, node));
}

function sourceTextForPath(
  context: ContextWithParserOptions,
  fileName: string,
): string | undefined {
  return pathsReferToSameFile(fileName, context.filename)
    ? context.sourceCode.text
    : sessionForContext(context).session.getSourceTextForPath(fileName);
}

function pathsReferToSameFile(left: string, right: string): boolean {
  const normalizedLeft = left.replaceAll("\\", "/").toLowerCase();
  const normalizedRight = right.replaceAll("\\", "/").toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function typeOfNewExpression(node: Node, checker: CorsaTypeCheckerShape): CorsaType | undefined {
  const callee = childNode(node, "callee");
  if (!callee) {
    return undefined;
  }
  const calleeType = checker.getTypeAtLocation(callee);
  if (!calleeType) {
    return undefined;
  }
  const constructSignature = checker.getSignaturesOfType(calleeType, SignatureKind.Construct)[0];
  return constructSignature
    ? (checker.getReturnTypeOfSignature(constructSignature) ?? calleeType)
    : calleeType;
}

function nodeForTypeLookup(node: Node | CorsaNode): Node | CorsaNode {
  if ("pos" in node) {
    return node;
  }
  switch ((node as { readonly type?: string }).type) {
    case "ClassDeclaration":
    case "ClassExpression":
      return childNode(node, "id") ?? node;
    case "TSPropertySignature":
      return childNode(node, "key") ?? node;
    default:
      return node;
  }
}

function endPosition(node: Node | CorsaNode): number {
  if ("end" in node) {
    return node.end;
  }
  const range = (node as Node & { readonly range?: readonly [number, number] }).range;
  if (!range) {
    throw new Error("corsa oxlint requires ESTree nodes with range data");
  }
  return range[1];
}

function nodeKind(node: Node | CorsaNode): string | undefined {
  return "pos" in node ? undefined : (node as { readonly type?: string }).type;
}

function childNode(node: Node, key: string): Node | undefined {
  const value = (node as unknown as Record<string, unknown>)[key];
  if (isNode(value)) {
    return value;
  }
  return undefined;
}

function implementedClauseNodes(node: Node | CorsaNode): readonly Node[] {
  if ("pos" in node) {
    return [];
  }
  const clauses = (node as unknown as { readonly implements?: unknown }).implements;
  if (!Array.isArray(clauses)) {
    return [];
  }
  return clauses.filter(isNode);
}

function implementedClauseChildNode(node: Node, key: string): Node | undefined {
  const value = (node as unknown as Record<string, unknown>)[key];
  if (isNode(value)) {
    return value;
  }
  return undefined;
}

function implementedTypesFromCorsaNode(
  context: ContextWithParserOptions,
  node: CorsaNode,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol) {
    const declaredType = checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol);
    if (declaredType) {
      const implemented = checker.getImplementedTypesOfType(declaredType);
      if (implemented.length > 0) {
        return implemented;
      }
    }
  }
  const sourceText = sourceTextFor(context, node);
  if (sourceText) {
    return implementedTypesFromSourceText(context, node, sourceText, checker);
  }
  const type = checker.getTypeAtLocation(node);
  return type ? checker.getImplementedTypesOfType(type) : [];
}

function corsaNodeFromEstree(context: ContextWithParserOptions, node: Node): CorsaNode | undefined {
  const range = (node as { readonly range?: unknown }).range;
  if (
    !Array.isArray(range) ||
    range.length < 2 ||
    typeof range[0] !== "number" ||
    typeof range[1] !== "number"
  ) {
    return undefined;
  }
  return {
    fileName: context.filename,
    pos: range[0],
    end: range[1],
    range: [range[0], range[1]] as const,
  };
}

function implementedTypesFromTypeAndBases(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const session = sessionForContext(context).session;
  const cached = session.getCachedImplementedTypes(type.id);
  if (cached) {
    return cached;
  }
  // Iterative DFS over the base chain so we don't pay for one closure call
  // and one `push(...subResult)` spread per base (each spread used to copy
  // the entire growing accumulator). Visit order doesn't matter because we
  // dedupe by `type.id`.
  const seenTypes = new Set<string>();
  const seenImplementedTypes = new Set<string>();
  const implemented: CorsaType[] = [];
  const stack: CorsaType[] = [type];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seenTypes.has(current.id)) {
      continue;
    }
    seenTypes.add(current.id);

    const ownImplemented = implementedTypesFromTypeDeclaration(context, current, checker);
    for (let index = 0; index < ownImplemented.length; index += 1) {
      const ownType = ownImplemented[index]!;
      if (seenImplementedTypes.has(ownType.id)) {
        continue;
      }
      seenImplementedTypes.add(ownType.id);
      implemented.push(ownType);
    }

    const bases = checker.getBaseTypes(current);
    // Push in reverse so the natural visit order matches the recursive form.
    for (let index = bases.length - 1; index >= 0; index -= 1) {
      const baseType = bases[index]!;
      if (seenTypes.has(baseType.id)) {
        continue;
      }
      stack.push(baseType);
    }
  }
  return session.cacheImplementedTypes(type.id, implemented);
}

function implementedTypesFromTypeDeclaration(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const session = sessionForContext(context).session;
  const cached = session.getCachedOwnImplementedTypes(type.id);
  if (cached) {
    return cached;
  }
  const symbol = type.symbol
    ? session.getSymbol(type.symbol)
    : shouldRecoverImplementationSymbol(context, type)
      ? checker.getSymbolOfType(type)
      : undefined;
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  const declarationNode = declaration ? session.getNode(declaration) : undefined;
  const sourceText = declarationNode
    ? sourceTextForPath(context, declarationNode.fileName)
    : undefined;
  const implemented =
    declarationNode && sourceText
      ? implementedTypesFromSourceText(context, declarationNode, sourceText, checker)
      : [];
  return session.cacheOwnImplementedTypes(type.id, implemented);
}

function shouldRecoverImplementationSymbol(
  context: ContextWithParserOptions,
  type: CorsaType,
): boolean {
  const name = typeSymbolName(type.texts ?? []);
  return name !== undefined && implementingClassNames(context).has(name);
}

function typeSymbolName(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const match =
      /^(?:typeof\s+)?(?:[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*\.)*([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)(?:\s*<|$)/u.exec(
        text.trim(),
      );
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function implementingClassNames(context: ContextWithParserOptions): ReadonlySet<string> {
  const session = sessionForContext(context).session;
  let byFile = implementingClassNamesBySession.get(session);
  if (!byFile) {
    byFile = new Map();
    implementingClassNamesBySession.set(session, byFile);
  }
  const sourceText = context.sourceCode.text;
  const cached = byFile.get(context.filename);
  if (cached?.sourceText === sourceText) {
    return cached.names;
  }
  const names = collectImplementingClassNames(sourceText);
  byFile.set(context.filename, { sourceText, names });
  return names;
}

function collectImplementingClassNames(sourceText: string): ReadonlySet<string> {
  const names = new Set<string>();
  let offset = 0;
  while (offset < sourceText.length) {
    const classOffset = findKeywordOutsideTrivia(sourceText.slice(offset), "class");
    if (classOffset < 0) {
      break;
    }
    const declarationStart = offset + classOffset + "class".length;
    const rest = sourceText.slice(declarationStart);
    const match = /^\s*([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)/u.exec(rest);
    if (match?.[1]) {
      const bodyOpen = findClassBodyOpen(rest, 0);
      const header = rest.slice(0, bodyOpen >= 0 ? bodyOpen : rest.length);
      if (findKeywordOutsideTrivia(header, "implements") >= 0) {
        names.add(match[1]);
      }
    }
    offset = declarationStart;
  }
  return names;
}

function implementedTypesFromSourceText(
  context: ContextWithParserOptions,
  node: CorsaNode,
  sourceText: string,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  if (node.pos < 0 || node.end > sourceText.length || node.pos >= node.end) {
    return [];
  }
  const classText = sourceText.slice(node.pos, node.end);
  const classStart = findKeywordOutsideTrivia(classText, "class");
  const headerStart = classStart >= 0 ? classStart : 0;
  const bodyOpen = findClassBodyOpen(classText, headerStart);
  const headerText = classText.slice(headerStart, bodyOpen >= 0 ? bodyOpen : classText.length);
  const implementsIndex = findKeywordOutsideTrivia(headerText, "implements");
  if (implementsIndex < 0) {
    return [];
  }
  const clauseText = headerText.slice(implementsIndex + "implements".length);
  const clauseStart = node.pos + headerStart + implementsIndex + "implements".length;
  return splitTopLevelRanges(clauseText, ",")
    .map((range) => {
      const raw = clauseText.slice(range.start, range.end);
      const leading = raw.search(/\S/);
      if (leading < 0) {
        return undefined;
      }
      const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
      const pos = clauseStart + range.start + leading;
      const end = clauseStart + range.end - trailing;
      const lookupNode: CorsaNode = {
        fileName: node.fileName,
        pos,
        end,
        range: [pos, end] as const,
      };
      const nameNode = implementedClauseNameNode(lookupNode, raw);
      const symbol =
        checker.getSymbolAtLocation(nameNode) ?? checker.getSymbolAtLocation(lookupNode);
      const type = symbol
        ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
        : (checker.getTypeAtLocation(nameNode) ?? checker.getTypeAtLocation(lookupNode));
      if (type) {
        try {
          checker.typeToString(type);
        } catch {
          // Corsa-side relation fallbacks handle stale type handles; avoid
          // deriving replacement text from source names in the JS bridge.
        }
      }
      return type;
    })
    .filter((type): type is CorsaType => type !== undefined);
}

function implementedClauseNameNode(node: CorsaNode, raw: string): CorsaNode {
  const range = lastTypeNameIdentifierRange(raw);
  if (!range) {
    return node;
  }
  const pos = node.pos + range.start;
  const end = node.pos + range.end;
  return {
    fileName: node.fileName,
    pos,
    end,
    range: [pos, end] as const,
  };
}

function lastTypeNameIdentifierRange(
  text: string,
): { readonly start: number; readonly end: number } | undefined {
  let last: { start: number; end: number } | undefined;
  const scanner = createScanner();
  for (let index = 0; index < text.length; index += 1) {
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    const char = text[index];
    if (char === "<") {
      break;
    }
    if (!isIdentifierStart(char)) {
      continue;
    }
    let end = index + 1;
    while (isIdentifierPart(text[end])) {
      end += 1;
    }
    last = { start: index, end };
    index = end - 1;
  }
  return last;
}

function findClassBodyOpen(text: string, start: number): number {
  const scanner = createScanner();
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    const char = text[index];
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (
      char === "{" &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    } else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
  }
  return -1;
}

function findKeywordOutsideTrivia(text: string, keyword: string): number {
  const scanner = createScanner();
  for (let index = 0; index < text.length; index += 1) {
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    if (matchesKeyword(text, keyword, index)) {
      return index;
    }
  }
  return -1;
}

function matchesKeyword(text: string, keyword: string, index: number): boolean {
  return (
    text.startsWith(keyword, index) &&
    !isIdentifierPart(text[index - 1]) &&
    !isIdentifierPart(text[index + keyword.length])
  );
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && (isIdentifierStart(char) || /[0-9]/.test(char));
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_$]/.test(char);
}

function splitTopLevelRanges(
  text: string,
  delimiter: string,
): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const scanner = createScanner();
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (
      char === delimiter &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function createScanner(): {
  skip(text: string, index: number): number;
} {
  let quote: string | undefined;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  return {
    skip(text, index) {
      const char = text[index];
      const next = text[index + 1];
      if (inLineComment) {
        if (char === "\n" || char === "\r") {
          inLineComment = false;
        }
        return index + 1;
      }
      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          return index + 2;
        }
        return index + 1;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        return index + 1;
      }
      if (char === "/" && next === "/") {
        inLineComment = true;
        return index + 2;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        return index + 2;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        return index + 1;
      }
      return index;
    },
  };
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value && "range" in value;
}

function filenameFor(
  context: ContextWithParserOptions,
  node: Node | CorsaNode | CorsaType | CorsaSymbol | CorsaSignature,
): string {
  if ("fileName" in node) {
    return node.fileName;
  }
  return context.filename;
}
