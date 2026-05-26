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
  return filenameFor(context, node) === context.filename ? context.sourceCode.text : undefined;
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
