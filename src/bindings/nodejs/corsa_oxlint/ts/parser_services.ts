import { createProgram, createTypeChecker } from "./checker";
import { resolveTypeAwareParserOptions } from "./context";
import { createNodeMaps } from "./node_map";
import type {
  ContextWithParserOptions,
  CorsaTypeCheckerShape,
  ParserServices,
  ParserServicesWithTypeInformation,
} from "./types";

const parserServices = new WeakMap<object, ParserServices>();

/**
 * Returns type-aware parser services backed by Corsa.
 *
 * @example
 * ```ts
 * const services = getParserServices(context);
 * const checker = services.program.getTypeChecker();
 * ```
 */
export function getParserServices(
  context: ContextWithParserOptions,
  allowWithoutFullTypeInformation = false,
): ParserServices {
  const current = parserServices.get(context);
  if (current) {
    return current;
  }
  const parserOptions = resolveTypeAwareParserOptions(context);
  const eslintParserServices = resolveEslintParserServices(context);
  if (!parserOptions.corsa && eslintParserServices) {
    const services = createEslintParserServices(eslintParserServices);
    parserServices.set(context, services);
    return services;
  }
  try {
    const maps = createNodeMaps(context);
    const program = createProgram(context);
    const services: ParserServicesWithTypeInformation = {
      program,
      ...maps,
      hasFullTypeInformation: true,
      getTypeAtLocation(node) {
        return createTypeChecker(context).getTypeAtLocation(node);
      },
      getSymbolAtLocation(node) {
        return createTypeChecker(context).getSymbolAtLocation(node);
      },
    };
    parserServices.set(context, services);
    return services;
  } catch (error) {
    if (!allowWithoutFullTypeInformation) {
      throw error;
    }
    const fallback: ParserServices = {
      program: createProgram(context),
      ...createNodeMaps(context),
      hasFullTypeInformation: false,
      getTypeAtLocation() {
        return undefined;
      },
      getSymbolAtLocation() {
        return undefined;
      },
    };
    parserServices.set(context, fallback);
    return fallback;
  }
}

function createEslintParserServices(
  parserServices: ParserServices,
): ParserServicesWithTypeInformation {
  const checker = createEslintTypeChecker(
    parserServices.program.getTypeChecker(),
    parserServices.esTreeNodeToTSNodeMap,
  );
  return {
    program: createEslintProgram(parserServices.program, checker),
    esTreeNodeToTSNodeMap: parserServices.esTreeNodeToTSNodeMap,
    tsNodeToESTreeNodeMap: parserServices.tsNodeToESTreeNodeMap,
    hasFullTypeInformation: true,
    getTypeAtLocation(node) {
      const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getTypeAtLocation(tsNode) : undefined;
    },
    getSymbolAtLocation(node) {
      const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getSymbolAtLocation(tsNode) : undefined;
    },
  };
}

function createEslintProgram(
  program: ParserServices["program"],
  checker: CorsaTypeCheckerShape,
): ParserServices["program"] {
  return Object.assign(Object.create(program), {
    getTypeChecker() {
      return checker;
    },
  });
}

function createEslintTypeChecker(
  checker: CorsaTypeCheckerShape,
  esTreeNodeToTSNodeMap: ParserServices["esTreeNodeToTSNodeMap"],
): CorsaTypeCheckerShape {
  const source = checker as unknown as Record<string, unknown>;
  return {
    ...checker,
    getTypeAtLocation(node) {
      return callChecker(source, "getTypeAtLocation", tsNodeFor(node, esTreeNodeToTSNodeMap));
    },
    getContextualType(node) {
      return (
        callChecker(source, "getContextualType", tsNodeFor(node, esTreeNodeToTSNodeMap)) ??
        this.getTypeAtLocation(node)
      );
    },
    getSymbolAtLocation(node) {
      return callChecker(source, "getSymbolAtLocation", tsNodeFor(node, esTreeNodeToTSNodeMap));
    },
    getSymbol(symbol) {
      return typeof symbol === "object" ? symbol : undefined;
    },
    getSymbolById(id) {
      return typeof id === "object" ? id : undefined;
    },
    getNode(node) {
      return typeof node === "object" ? node : undefined;
    },
    getNodeById(id) {
      return typeof id === "object" ? id : undefined;
    },
    getTypeOfSymbol(symbol) {
      return callChecker(source, "getTypeOfSymbol", symbol);
    },
    getDeclaredTypeOfSymbol(symbol) {
      return callChecker(source, "getDeclaredTypeOfSymbol", symbol);
    },
    getTypeOfSymbolAtLocation(symbol, node) {
      return (
        callChecker(
          source,
          "getTypeOfSymbolAtLocation",
          symbol,
          tsNodeFor(node, esTreeNodeToTSNodeMap),
        ) ??
        this.getTypeOfSymbol(symbol) ??
        this.getDeclaredTypeOfSymbol(symbol)
      );
    },
    typeToString(type, enclosingDeclaration, flags) {
      return (
        callChecker(
          source,
          "typeToString",
          type,
          enclosingDeclaration ? tsNodeFor(enclosingDeclaration, esTreeNodeToTSNodeMap) : undefined,
          flags,
        ) ?? fallbackTypeText(type)
      );
    },
    getBaseTypeOfLiteralType(type) {
      return callChecker(source, "getBaseTypeOfLiteralType", type) ?? type;
    },
    getPropertiesOfType(type) {
      return asReadonlyArray(callChecker(source, "getPropertiesOfType", type));
    },
    getSignaturesOfType(type, kind) {
      return asReadonlyArray(callChecker(source, "getSignaturesOfType", type, kind));
    },
    getReturnTypeOfSignature(signature) {
      return callChecker(source, "getReturnTypeOfSignature", signature);
    },
    getTypePredicateOfSignature(signature) {
      return callChecker(source, "getTypePredicateOfSignature", signature);
    },
    getBaseTypes(type) {
      const baseTypes = asReadonlyArray(callChecker(source, "getBaseTypes", type));
      return baseTypes.length > 0 ? baseTypes : heritageTypes(type, source, "extends");
    },
    getImplementedTypes(node) {
      return heritageTypesFromDeclaration(
        tsNodeFor(node, esTreeNodeToTSNodeMap),
        source,
        "implements",
      );
    },
    getImplementedTypesOfType(type) {
      return implementedTypesIncludingBases(type, source);
    },
    getTypeArguments(type) {
      return asReadonlyArray(callChecker(source, "getTypeArguments", type));
    },
    getTypesOfType(type) {
      return asReadonlyArray((type as { readonly types?: unknown }).types);
    },
    getTargetOfType(type) {
      return (type as { readonly target?: unknown }).target as never;
    },
    getTypeParametersOfType(type) {
      return asReadonlyArray((type as { readonly typeParameters?: unknown }).typeParameters);
    },
    getOuterTypeParametersOfType(type) {
      return asReadonlyArray(
        (type as { readonly outerTypeParameters?: unknown }).outerTypeParameters,
      );
    },
    getLocalTypeParametersOfType(type) {
      return asReadonlyArray(
        (type as { readonly localTypeParameters?: unknown }).localTypeParameters,
      );
    },
    getObjectTypeOfType(type) {
      return (type as { readonly objectType?: unknown }).objectType as never;
    },
    getIndexTypeOfType(type) {
      return (type as { readonly indexType?: unknown }).indexType as never;
    },
    getCheckTypeOfType(type) {
      return (type as { readonly checkType?: unknown }).checkType as never;
    },
    getExtendsTypeOfType(type) {
      return (type as { readonly extendsType?: unknown }).extendsType as never;
    },
    getBaseTypeOfType(type) {
      return (type as { readonly baseType?: unknown }).baseType as never;
    },
    getConstraintOfType(type) {
      return callChecker(source, "getBaseConstraintOfType", type);
    },
    isUnionType(type) {
      const value = type as { readonly isUnion?: unknown };
      return typeof value.isUnion === "function" ? Boolean(value.isUnion()) : false;
    },
    isIntersectionType(type) {
      const value = type as { readonly isIntersection?: unknown };
      return typeof value.isIntersection === "function" ? Boolean(value.isIntersection()) : false;
    },
  } as CorsaTypeCheckerShape;
}

function callChecker(
  checker: Record<string, unknown>,
  method: string,
  ...args: readonly unknown[]
): never | undefined {
  const candidate = checker[method];
  return typeof candidate === "function" ? candidate.apply(checker, args) : undefined;
}

function asReadonlyArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? value : [];
}

function tsNodeFor(
  node: unknown,
  esTreeNodeToTSNodeMap: ParserServices["esTreeNodeToTSNodeMap"],
): unknown {
  return hasNode(esTreeNodeToTSNodeMap, node) ? esTreeNodeToTSNodeMap.get(node as never) : node;
}

function hasNode(
  esTreeNodeToTSNodeMap: ParserServices["esTreeNodeToTSNodeMap"],
  node: unknown,
): boolean {
  return typeof node === "object" && node !== null && esTreeNodeToTSNodeMap.has(node as never);
}

function fallbackTypeText(type: unknown): string {
  const name = (type as { readonly name?: unknown }).name;
  return typeof name === "string" || typeof name === "number" || typeof name === "boolean"
    ? String(name)
    : "";
}

function heritageTypes(
  type: unknown,
  checker: Record<string, unknown>,
  keyword: "extends" | "implements",
): readonly never[] {
  const declarations = asReadonlyArray(
    (type as { readonly symbol?: { readonly declarations?: unknown } }).symbol?.declarations,
  );
  return declarations.flatMap((declaration) =>
    heritageTypesFromDeclaration(declaration, checker, keyword),
  );
}

/**
 * Mirrors the tsgo-backed `getImplementedTypesOfType` behaviour by walking the
 * base-type chain so a class that implements an interface only through a base
 * class still reports that interface. Without this, a rule shared between
 * oxlint (tsgo) and ESLint (this `@typescript-eslint` fallback checker) would
 * see different implemented types for the same source (GH#207).
 */
function implementedTypesIncludingBases(
  type: unknown,
  checker: Record<string, unknown>,
): readonly never[] {
  const visited = new Set<unknown>();
  const seenImplemented = new Set<unknown>();
  const implemented: never[] = [];
  const queue: unknown[] = [type];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const ownType of heritageTypes(current, checker, "implements")) {
      if (seenImplemented.has(ownType)) {
        continue;
      }
      seenImplemented.add(ownType);
      implemented.push(ownType);
    }
    const directBases = asReadonlyArray(callChecker(checker, "getBaseTypes", current));
    const bases = directBases.length > 0 ? directBases : heritageTypes(current, checker, "extends");
    for (const baseType of bases) {
      queue.push(baseType);
    }
  }
  return implemented;
}

function heritageTypesFromDeclaration(
  declaration: unknown,
  checker: Record<string, unknown>,
  keyword: "extends" | "implements",
): readonly never[] {
  const clauses = asReadonlyArray(
    (declaration as { readonly heritageClauses?: unknown }).heritageClauses,
  );
  return clauses
    .filter((clause) => heritageClauseText(clause).trimStart().startsWith(keyword))
    .flatMap((clause) => asReadonlyArray((clause as { readonly types?: unknown }).types))
    .map((node) => {
      const expression = (node as { readonly expression?: unknown }).expression ?? node;
      return callChecker(checker, "getTypeAtLocation", expression);
    })
    .filter((type): type is never => type !== undefined);
}

function heritageClauseText(clause: unknown): string {
  const getText = (clause as { readonly getText?: unknown }).getText;
  return typeof getText === "function" ? String(getText.call(clause)) : "";
}

function resolveEslintParserServices(
  context: ContextWithParserOptions,
): ParserServices | undefined {
  const candidates = [context.parserServices, context.sourceCode.parserServices] as const;
  for (const candidate of candidates) {
    if (hasEslintParserServices(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function hasEslintParserServices(value: unknown): value is ParserServices {
  return Boolean(
    value &&
    typeof value === "object" &&
    "program" in value &&
    "esTreeNodeToTSNodeMap" in value &&
    "tsNodeToESTreeNodeMap" in value,
  );
}
