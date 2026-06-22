import { getParserServices } from "./parser_services";
import { decorateRule } from "./plugin";
import type { Rule, RuleMetaWithMessages, Visitor } from "./plugin";
import type { ContextWithParserOptions } from "./types";

export type RuleCreatorRule<
  TOptions extends readonly unknown[] = readonly unknown[],
  TMessageIds extends string = string,
> = {
  readonly name: string;
  readonly meta: RuleCreatorMeta<TMessageIds>;
  readonly defaultOptions?: TOptions;
  readonly create: (context: ContextWithParserOptions) => Visitor;
};

export type RuleCreatorMeta<TMessageIds extends string = string> =
  RuleMetaWithMessages<TMessageIds>;

export type RuleCreatorCreatedRule<
  TOptions extends readonly unknown[] = readonly [],
  TMeta extends RuleMetaWithMessages = RuleMetaWithMessages,
> = Rule & {
  readonly defaultOptions: TOptions;
  readonly meta: TMeta & {
    readonly docs: NonNullable<TMeta["docs"]> & {
      readonly url: string;
    };
  };
};

type RuleCreatorInput<
  TOptions extends readonly unknown[],
  TMessageIds extends string,
  TMeta extends RuleCreatorMeta<TMessageIds>,
> = Omit<RuleCreatorRule<TOptions, TMessageIds>, "defaultOptions" | "meta"> & {
  readonly defaultOptions?: TOptions;
  readonly meta: TMeta;
};

export interface RuleCreatorFactory {
  <
    TOptions extends readonly unknown[],
    TMessageIds extends string,
    TMeta extends RuleCreatorMeta<TMessageIds>,
  >(
    rule: RuleCreatorInput<TOptions, TMessageIds, TMeta> & {
      readonly defaultOptions: TOptions;
    },
  ): RuleCreatorCreatedRule<TOptions, TMeta>;
  <TMessageIds extends string, TMeta extends RuleCreatorMeta<TMessageIds>>(
    rule: RuleCreatorInput<readonly [], TMessageIds, TMeta> & {
      readonly defaultOptions?: undefined;
    },
  ): RuleCreatorCreatedRule<readonly [], TMeta>;
}

/**
 * Self-hosted type-aware utilities for Oxlint rules backed by Corsa.
 */
export const OxlintUtils = Object.freeze({
  RuleCreator(urlCreator: (ruleName: string) => string): RuleCreatorFactory {
    return ((rule: RuleCreatorRule) => {
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
      } as unknown as Rule) as never;
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

export const RuleCreator = Object.assign(OxlintUtils.RuleCreator, {
  withoutDocs<TRule extends Omit<RuleCreatorRule, "name">>(
    rule: TRule,
  ): Rule & {
    readonly defaultOptions: TRule extends { readonly defaultOptions: infer TOptions }
      ? TOptions
      : readonly [];
  } {
    return decorateRule({
      ...rule,
      defaultOptions: rule.defaultOptions ?? [],
    } as unknown as Rule) as never;
  },
});
export { getParserServices } from "./parser_services";

export function applyDefault<User extends readonly unknown[], Defaults extends readonly unknown[]>(
  defaultOptions: Defaults,
  userOptions: User | null | undefined,
): readonly unknown[] {
  const options = structuredClone(defaultOptions) as unknown as unknown[];
  if (userOptions == null) {
    return options;
  }
  options.forEach((option, index) => {
    if (userOptions[index] === undefined) {
      return;
    }
    const userOption = userOptions[index];
    options[index] =
      isObjectNotArray(option) && isObjectNotArray(userOption)
        ? deepMerge(option, userOption)
        : userOption;
  });
  return options;
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (isObject(base) && isObject(override)) {
    return Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(override)])].map((key) => [
        key,
        key in base && key in override
          ? deepMerge((base as any)[key], (override as any)[key])
          : key in base
            ? (base as any)[key]
            : (override as any)[key],
      ]),
    ) as T;
  }
  return (override === undefined ? base : override) as T;
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
