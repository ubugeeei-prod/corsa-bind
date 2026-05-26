import { createProgram, createTypeChecker } from "./checker";
import { resolveTypeAwareParserOptions } from "./context";
import { createNodeMaps } from "./node_map";
import type {
  ContextWithParserOptions,
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
  if (!parserOptions.corsa && !parserOptions.tsgo && hasEslintParserServices(context.parserServices)) {
    const services = createEslintParserServices(context);
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
  context: ContextWithParserOptions,
): ParserServicesWithTypeInformation {
  const parserServices = context.parserServices as unknown as EslintParserServices;
  const checker = parserServices.program.getTypeChecker();
  return {
    program: parserServices.program as never,
    esTreeNodeToTSNodeMap: parserServices.esTreeNodeToTSNodeMap,
    tsNodeToESTreeNodeMap: parserServices.tsNodeToESTreeNodeMap,
    hasFullTypeInformation: true,
    getTypeAtLocation(node) {
      const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getTypeAtLocation(tsNode as never) : undefined;
    },
    getSymbolAtLocation(node) {
      const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);
      return tsNode ? checker.getSymbolAtLocation(tsNode as never) : undefined;
    },
  };
}

function hasEslintParserServices(
  value: ContextWithParserOptions["parserServices"],
): value is EslintParserServices {
  return Boolean(
    value &&
      typeof value === "object" &&
      "program" in value &&
      "esTreeNodeToTSNodeMap" in value &&
      "tsNodeToESTreeNodeMap" in value,
  );
}

type EslintParserServices = {
  readonly program: {
    getTypeChecker(): {
      getTypeAtLocation(node: unknown): unknown;
      getSymbolAtLocation(node: unknown): unknown;
    };
  };
  readonly esTreeNodeToTSNodeMap: {
    get(node: unknown): unknown;
    has(node: unknown): boolean;
  };
  readonly tsNodeToESTreeNodeMap: {
    get(node: unknown): unknown;
    has(node: unknown): boolean;
  };
};
