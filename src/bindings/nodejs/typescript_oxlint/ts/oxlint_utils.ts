import type { Rule, RuleMeta, Visitor } from "@oxlint/plugins";

import { getParserServices } from "./parser_services";
import { decorateRule } from "./plugin";
import type { ContextWithParserOptions } from "./types";

export type RuleCreatorRule<
  TOptions extends readonly unknown[] = readonly unknown[],
  TMessageIds extends string = string,
> = {
  readonly name: string;
  readonly meta: RuleMeta & {
    readonly messages?: Record<TMessageIds, string>;
  };
  readonly defaultOptions?: TOptions;
  readonly create: (context: ContextWithParserOptions) => Visitor;
};

export type RuleCreatorCreatedRule<TRule extends RuleCreatorRule> = Omit<
  TRule,
  "defaultOptions" | "meta"
> & {
  readonly defaultOptions: TRule extends { readonly defaultOptions: infer TOptions }
    ? TOptions
    : readonly [];
  readonly meta: TRule["meta"] & {
    readonly docs: NonNullable<TRule["meta"]["docs"]> & {
      readonly url: string;
    };
  };
} & Rule &
  Record<string, unknown>;

export type RuleCreatorFactory = <TRule extends RuleCreatorRule>(
  rule: TRule,
) => RuleCreatorCreatedRule<TRule>;

/**
 * Self-hosted type-aware utilities for Oxlint rules backed by tsgo.
 */
export const OxlintUtils = Object.freeze({
  RuleCreator(urlCreator: (ruleName: string) => string): RuleCreatorFactory {
    return ((rule) => {
      const docs = rule.meta?.docs;
      return decorateRule({
        ...rule,
        meta: {
          ...rule.meta,
          docs: {
            ...docs,
            url: urlCreator(rule.name),
          },
        },
        defaultOptions: rule.defaultOptions ?? [],
      } as unknown as Rule) as RuleCreatorCreatedRule<typeof rule>;
    }) as RuleCreatorFactory;
  },
  getParserServices(context: ContextWithParserOptions, allowWithoutFullTypeInformation = false) {
    return getParserServices(context, allowWithoutFullTypeInformation);
  },
});

export const NullThrowsReasons = Object.freeze({
  MissingParent: "Expected node to have a parent.",
  MissingToken: (token: string, thing: string) => `Expected to find a ${token} for the ${thing}.`,
});

export const RuleCreator = OxlintUtils.RuleCreator;
export { getParserServices } from "./parser_services";

export function applyDefault<
  Values extends readonly unknown[],
  Defaults extends readonly unknown[],
>(values: Values | undefined, defaults: Defaults): readonly unknown[] {
  return deepMerge(defaults, values ?? []) as readonly unknown[];
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base) && Array.isArray(override)) {
    return base.map((value, index) => deepMerge(value, override[index])) as unknown as T;
  }
  if (isObject(base) && isObject(override)) {
    return Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(override)])].map((key) => [
        key,
        deepMerge((base as any)[key], (override as any)[key]),
      ]),
    ) as T;
  }
  return (override ?? base) as T;
}

export function nullThrows<T>(
  value: T | null | undefined,
  message = "Expected value to be present",
): T {
  if (value == null) {
    throw new Error(`Non-null Assertion Failed: ${message}`);
  }
  return value;
}

export function isObjectNotArray(value: unknown): value is Record<string, unknown> {
  return isObject(value);
}

export const ESLintUtils = Object.freeze({
  NullThrowsReasons,
  RuleCreator,
  applyDefault,
  deepMerge,
  getParserServices,
  isObjectNotArray,
  nullThrows,
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
