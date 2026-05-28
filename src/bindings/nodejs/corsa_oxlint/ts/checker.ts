import type { Node } from "@oxlint/plugins";

import { createNodeMaps, toPosition } from "./node_map";
import { sessionForContext } from "./registry";
import type {
  ContextWithParserOptions,
  CorsaNode,
  CorsaProgramShape,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypeCheckerShape,
} from "./types";

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
      return sessionForContext(context).session.getTypeAtPosition(
        filenameFor(context, lookupNode),
        toPosition(lookupNode),
        sourceTextFor(context, lookupNode),
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
    getNode(node) {
      return sessionForContext(context).session.getNode(node);
    },
    getNodeById(id) {
      return sessionForContext(context).session.getNode(id);
    },
    getTypeOfSymbol(symbol) {
      return sessionForContext(context).session.getTypeOfSymbol(symbol);
    },
    getDeclaredTypeOfSymbol(symbol) {
      return sessionForContext(context).session.getDeclaredTypeOfSymbol(symbol);
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
        const implemented = implementedTypesFromSourceText(sourceNode, sourceText, this);
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
  const normalizedFileName = fileName.toLowerCase();
  const normalizedContextFilename = context.filename.toLowerCase();
  return normalizedFileName === normalizedContextFilename ||
    normalizedFileName.endsWith(normalizedContextFilename) ||
    normalizedContextFilename.endsWith(normalizedFileName)
    ? context.sourceCode.text
    : sessionForContext(context).session.getSourceTextForPath(fileName);
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
  const constructSignature = checker.getSignaturesOfType(calleeType, 1)[0];
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
    return implementedTypesFromSourceText(node, sourceText, checker);
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
  const seenTypes = new Set<string>();
  const seenImplementedTypes = new Set<string>();

  function collect(current: CorsaType): CorsaType[] {
    if (seenTypes.has(current.id)) {
      return [];
    }
    seenTypes.add(current.id);

    const implemented: CorsaType[] = [];
    for (const ownType of implementedTypesFromTypeDeclaration(context, current, checker)) {
      if (seenImplementedTypes.has(ownType.id)) {
        continue;
      }
      seenImplementedTypes.add(ownType.id);
      implemented.push(ownType);
    }
    for (const baseType of checker.getBaseTypes(current)) {
      implemented.push(...collect(baseType));
    }
    return implemented;
  }

  return collect(type);
}

function implementedTypesFromTypeDeclaration(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const session = sessionForContext(context).session;
  const symbol = type.symbol ? session.getSymbol(type.symbol) : undefined;
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  const declarationNode = declaration ? session.getNode(declaration) : undefined;
  const sourceText = declarationNode
    ? sourceTextForPath(context, declarationNode.fileName)
    : undefined;
  return declarationNode && sourceText
    ? implementedTypesFromSourceText(declarationNode, sourceText, checker)
    : [];
}

function implementedTypesFromSourceText(
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
      const symbol = checker.getSymbolAtLocation(lookupNode);
      return symbol
        ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
        : checker.getTypeAtLocation(lookupNode);
    })
    .filter((type): type is CorsaType => type !== undefined);
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
  return char !== undefined && /[A-Za-z0-9_$]/.test(char);
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
