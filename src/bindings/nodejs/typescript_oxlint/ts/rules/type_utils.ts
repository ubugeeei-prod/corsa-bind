import type { Node } from "@oxlint/plugins";

import { OxlintUtils } from "../oxlint_utils";
import {
  classifyTypeText as classifyTypeTextFromRust,
  isAnyLikeTypeTexts,
  isArrayLikeTypeTexts,
  isBigIntLikeTypeTexts,
  isErrorLikeTypeTexts,
  isNumberLikeTypeTexts,
  isPromiseLikeTypeTexts,
  isStringLikeTypeTexts,
  isUnknownLikeTypeTexts,
  splitTopLevelTypeText as splitTopLevelTypeTextFromRust,
  splitTypeText as splitTypeTextFromRust,
} from "../utils";
import { isIdentifierNamed, memberPropertyName, stripChainExpression } from "./ast";
import type { ContextWithParserOptions, TsgoType, TsgoTypeCheckerShape } from "../types";

const baseTypeCache = new WeakMap<object, TsgoType | null>();
const propertyNamesCache = new WeakMap<object, readonly string[]>();
const symbolTypeCache = new WeakMap<object, TsgoType | null>();
const typeTextsCache = new WeakMap<object, readonly string[]>();

export function checkerFor(context: ContextWithParserOptions): TsgoTypeCheckerShape {
  return OxlintUtils.getParserServices(context).program.getTypeChecker();
}

export function typeAtNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): TsgoType | undefined {
  return checkerFor(context).getTypeAtLocation(node as Node);
}

export function baseTypeAtNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): TsgoType | undefined {
  const key = nodeCacheKey(node);
  if (key && baseTypeCache.has(key)) {
    return baseTypeCache.get(key) ?? undefined;
  }
  const type = typeAtNode(context, node);
  const resolved = type ? (checkerFor(context).getBaseTypeOfLiteralType(type) ?? type) : undefined;
  if (key) {
    baseTypeCache.set(key, resolved ?? null);
  }
  return resolved;
}

export function symbolTypeAtNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): TsgoType | undefined {
  const key = nodeCacheKey(node);
  if (key && symbolTypeCache.has(key)) {
    return symbolTypeCache.get(key) ?? undefined;
  }
  const checker = checkerFor(context);
  const symbol = checker.getSymbolAtLocation(node as Node);
  const resolved = symbol
    ? (checker.getTypeOfSymbol(symbol) ?? checker.getDeclaredTypeOfSymbol(symbol))
    : undefined;
  if (key) {
    symbolTypeCache.set(key, resolved ?? null);
  }
  return resolved;
}

export function typeTextAtNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): string | undefined {
  const type = baseTypeAtNode(context, node);
  return type ? checkerFor(context).typeToString(type) : undefined;
}

export function symbolTypeTextAtNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): string | undefined {
  const type = symbolTypeAtNode(context, node);
  if (!type) {
    return undefined;
  }
  const checker = checkerFor(context);
  return checker.typeToString(checker.getBaseTypeOfLiteralType(type) ?? type);
}

export function propertyNamesOfNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): readonly string[] {
  const key = nodeCacheKey(node);
  const cached = key ? propertyNamesCache.get(key) : undefined;
  if (cached) {
    return cached;
  }
  const checker = checkerFor(context);
  const names = new Set<string>();
  for (const type of [baseTypeAtNode(context, node), symbolTypeAtNode(context, node)]) {
    if (!type) {
      continue;
    }
    for (const property of checker.getPropertiesOfType(type)) {
      names.add(property.name);
    }
  }
  const resolved = [...names];
  if (key) {
    propertyNamesCache.set(key, resolved);
  }
  return resolved;
}

export function isPromiseLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  const current = stripChainExpression(node as any) as any;
  if (current?.type === "NewExpression" && isIdentifierNamed(current.callee, "Promise")) {
    return true;
  }
  if (
    current?.type === "CallExpression" &&
    memberPropertyName(current.callee) === "resolve" &&
    isIdentifierNamed((current.callee as any).object, "Promise")
  ) {
    return true;
  }
  return isPromiseLikeTypeTexts(
    [typeTextAtNode(context, node), symbolTypeTextAtNode(context, node)].filter(
      (text): text is string => Boolean(text),
    ),
    propertyNamesOfNode(context, node),
  );
}

export function isArrayLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  const current = stripChainExpression(node as any) as any;
  if (current?.type === "ArrayExpression") {
    return true;
  }
  return isArrayLikeTypeTexts(typeTextsAtNode(context, node));
}

export function isStringLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  return isStringLikeTypeTexts(typeTextsAtNode(context, node));
}

export function isErrorLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  const current = stripChainExpression(node as any) as any;
  if (current?.type === "NewExpression") {
    const callee = stripChainExpression(current.callee);
    const identifier = callee?.type === "Identifier" ? callee.name : memberPropertyName(callee);
    if (identifier?.endsWith("Error")) {
      return true;
    }
  }
  return isErrorLikeTypeTexts(typeTextsAtNode(context, node), propertyNamesOfNode(context, node));
}

export function isNumberLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  return isNumberLikeTypeTexts(typeTextsAtNode(context, node));
}

export function isBigIntLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  return isBigIntLikeTypeTexts(typeTextsAtNode(context, node));
}

export function isAnyLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  const current = stripChainExpression(node as any) as any;
  if (current?.type === "TSAsExpression" && current.typeAnnotation?.type === "TSAnyKeyword") {
    return true;
  }
  return isAnyLikeTypeTexts(typeTextsAtNode(context, node));
}

export function isUnknownLikeNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): boolean {
  const current = stripChainExpression(node as any) as any;
  if (current?.type === "TSAsExpression" && current.typeAnnotation?.type === "TSUnknownKeyword") {
    return true;
  }
  return isUnknownLikeTypeTexts(typeTextsAtNode(context, node));
}

export function typeTextsAtNode(
  context: ContextWithParserOptions,
  node: Node | { readonly range: readonly [number, number] },
): readonly string[] {
  const key = nodeCacheKey(node);
  const cached = key ? typeTextsCache.get(key) : undefined;
  if (cached) {
    return cached;
  }
  const values = new Set<string>();
  const checker = checkerFor(context);
  collectTexts(baseTypeAtNode(context, node));
  collectTexts(symbolTypeAtNode(context, node));
  const resolved = [...values];
  if (key) {
    typeTextsCache.set(key, resolved);
  }
  return resolved;

  function collectTexts(type: TsgoType | undefined): void {
    if (!type) {
      return;
    }
    const texts = Array.isArray(type.texts) ? type.texts : [];
    for (const text of [...texts, checker.typeToString(type)]) {
      if (text) {
        values.add(text);
      }
    }
  }
}

function nodeCacheKey(
  node: Node | { readonly range: readonly [number, number] },
): object | undefined {
  return typeof node === "object" && node !== null ? node : undefined;
}

export function classifyTypeText(
  text: string | undefined,
): "any" | "bigint" | "boolean" | "nullish" | "number" | "regexp" | "string" | "unknown" | "other" {
  return classifyTypeTextFromRust(text);
}

export function splitTopLevelTypeText(text: string, delimiter: "|" | "&" | ","): readonly string[] {
  return splitTopLevelTypeTextFromRust(text, delimiter);
}

export function splitTypeText(text: string): readonly string[] {
  return splitTypeTextFromRust(text);
}
