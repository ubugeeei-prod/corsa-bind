import { createProgram, createTypeChecker } from "./checker";
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
