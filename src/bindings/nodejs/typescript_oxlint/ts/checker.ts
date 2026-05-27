import type { Node } from "@oxlint/plugins";

import { createNodeMaps, toPosition } from "./node_map";
import { sessionForContext } from "./registry";
import type {
  ContextWithParserOptions,
  TsgoNode,
  TsgoProgramShape,
  TsgoSignature,
  TsgoSymbol,
  TsgoType,
  TsgoTypeCheckerShape,
} from "./types";

export function createProgram(
  context: ContextWithParserOptions,
): TsgoProgramShape & { readonly nodeMaps: ReturnType<typeof createNodeMaps> } {
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

export function createTypeChecker(context: ContextWithParserOptions): TsgoTypeCheckerShape {
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
      return this.getTypeAtLocation(node) ?? this.getTypeOfSymbol(symbol);
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
        return implementedTypesFromTsgoNode(context, node, this);
      }
      return implementedClauseNodes(node)
        .map((clause) => {
          const expression = implementedClauseChildNode(clause, "expression") ?? clause;
          const symbol = this.getSymbolAtLocation(expression) ?? this.getSymbolAtLocation(clause);
          return symbol
            ? (this.getDeclaredTypeOfSymbol(symbol) ?? this.getTypeOfSymbol(symbol))
            : (this.getTypeAtLocation(expression) ?? this.getTypeAtLocation(clause));
        })
        .filter((type): type is TsgoType => type !== undefined);
    },
    getImplementedTypesOfType(type) {
      return sessionForContext(context).session.getBaseTypes(type);
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
  node: Node | TsgoNode | TsgoType | TsgoSymbol | TsgoSignature,
): string | undefined {
  const fileName = filenameFor(context, node);
  const normalizedFileName = fileName.toLowerCase();
  const normalizedContextFilename = context.filename.toLowerCase();
  return normalizedFileName === normalizedContextFilename ||
    normalizedFileName.endsWith(normalizedContextFilename) ||
    normalizedContextFilename.endsWith(normalizedFileName)
    ? context.sourceCode.text
    : undefined;
}

function typeOfNewExpression(node: Node, checker: TsgoTypeCheckerShape): TsgoType | undefined {
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

function nodeForTypeLookup(node: Node | TsgoNode): Node | TsgoNode {
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

function implementedClauseNodes(node: Node | TsgoNode): readonly Node[] {
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

function implementedTypesFromTsgoNode(
  context: ContextWithParserOptions,
  node: TsgoNode,
  checker: TsgoTypeCheckerShape,
): readonly TsgoType[] {
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
    const classText = sourceText.slice(node.pos, node.end);
    const bodyOpen = classText.indexOf("{");
    const headerText = bodyOpen >= 0 ? classText.slice(0, bodyOpen) : classText;
    const implementsIndex = headerText.indexOf("implements");
    if (implementsIndex >= 0) {
      const clauseText = headerText.slice(implementsIndex + "implements".length);
      const implemented = splitTopLevelRanges(clauseText, ",")
        .map((range) => {
          const raw = clauseText.slice(range.start, range.end);
          const leading = raw.search(/\S/);
          if (leading < 0) {
            return undefined;
          }
          const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
          const pos = node.pos + implementsIndex + "implements".length + range.start + leading;
          const end = node.pos + implementsIndex + "implements".length + range.end - trailing;
          const lookupNode = {
            type: "Identifier",
            range: [pos, end] as const,
          };
          const symbol = checker.getSymbolAtLocation(lookupNode);
          return symbol
            ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
            : checker.getTypeAtLocation(lookupNode);
        })
        .filter((type): type is TsgoType => type !== undefined);
      return implemented;
    }
  }
  const type = checker.getTypeAtLocation(node);
  return type ? checker.getImplementedTypesOfType(type) : [];
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
    if (scanner.inQuote(char)) {
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
  inQuote(char: string): boolean;
} {
  let quote: string | undefined;
  let escaped = false;
  return {
    inQuote(char) {
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        return true;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        return true;
      }
      return false;
    },
  };
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value && "range" in value;
}

function filenameFor(
  context: ContextWithParserOptions,
  node: Node | TsgoNode | TsgoType | TsgoSymbol | TsgoSignature,
): string {
  if ("fileName" in node) {
    return node.fileName;
  }
  return context.filename;
}
