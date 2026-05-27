import { binding } from "./binding";
import { fromJson, toJson } from "./json";

import type {
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRuleMeta,
  TypeTextKind,
  UnsafeTypeFlowInput,
} from "./types";

/** Runs the Rust unsafe-assignment classifier against serialized type-flow data. */
export function isUnsafeAssignment(input: UnsafeTypeFlowInput): boolean {
  return binding.isUnsafeAssignment(toJson(input));
}

/** Runs the Rust unsafe-return classifier against serialized type-flow data. */
export function isUnsafeReturn(input: UnsafeTypeFlowInput): boolean {
  return binding.isUnsafeReturn(toJson(input));
}

/** Executes a native lint rule implementation and returns normalized diagnostics. */
export function runNativeLintRule(ruleName: string, node: NativeLintNode): NativeLintDiagnostic[] {
  return fromJson(binding.runNativeLintRule(ruleName, toJson(node)));
}

/** Lists rule metadata exposed by the Rust-backed native rule registry. */
export function nativeLintRuleMetas(): NativeLintRuleMeta[] {
  return fromJson(binding.nativeLintRuleMetasJson());
}

/** Classifies a TypeScript type string into the Rust fast-path type categories. */
export function classifyTypeText(text?: string): TypeTextKind {
  return binding.classifyTypeText(text) as TypeTextKind;
}

/** Splits a type string by a top-level delimiter while respecting nested syntax. */
export function splitTopLevelTypeText(text: string, delimiter: string): string[] {
  return binding.splitTopLevelTypeText(text, delimiter);
}

/** Splits a union/intersection-like type string into top-level constituents. */
export function splitTypeText(text: string): string[] {
  return binding.splitTypeText(text);
}

/** Returns whether any supplied type text is string-like. */
export function isStringLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isStringLikeTypeTexts([...typeTexts]);
}

/** Returns whether any supplied type text is number-like. */
export function isNumberLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isNumberLikeTypeTexts([...typeTexts]);
}

/** Returns whether any supplied type text is bigint-like. */
export function isBigIntLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isBigIntLikeTypeTexts([...typeTexts]);
}

/** Returns whether any supplied type text is `any`-like. */
export function isAnyLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isAnyLikeTypeTexts([...typeTexts]);
}

/** Returns whether any supplied type text is `unknown`-like. */
export function isUnknownLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isUnknownLikeTypeTexts([...typeTexts]);
}

/** Returns whether any supplied type text represents an array-like value. */
export function isArrayLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isArrayLikeTypeTexts([...typeTexts]);
}

/** Returns whether any supplied type text represents an array of strings. */
export function isStringArrayLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isStringArrayLikeTypeTexts([...typeTexts]);
}

/** Returns whether type text plus property names looks Promise-like. */
export function isPromiseLikeTypeTexts(
  typeTexts: readonly string[],
  propertyNames: readonly string[] = [],
): boolean {
  return binding.isPromiseLikeTypeTexts([...typeTexts], [...propertyNames]);
}

/** Returns whether type text plus property names looks Error-like. */
export function isErrorLikeTypeTexts(
  typeTexts: readonly string[],
  propertyNames: readonly string[] = [],
): boolean {
  return binding.isErrorLikeTypeTexts([...typeTexts], [...propertyNames]);
}

/** Namespaced utility export matching the previous public API shape. */
export const Utils = Object.freeze({
  classifyTypeText,
  splitTopLevelTypeText,
  splitTypeText,
  isStringLikeTypeTexts,
  isNumberLikeTypeTexts,
  isBigIntLikeTypeTexts,
  isAnyLikeTypeTexts,
  isUnknownLikeTypeTexts,
  isArrayLikeTypeTexts,
  isStringArrayLikeTypeTexts,
  isPromiseLikeTypeTexts,
  isErrorLikeTypeTexts,
});
