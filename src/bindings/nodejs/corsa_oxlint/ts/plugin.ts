import * as oxlintPluginApi from "@oxlint/plugins";
import type {
  Context as OxlintContext,
  Plugin as OxlintPlugin,
  Rule as OxlintRule,
} from "@oxlint/plugins";

import { resolveTypeAwareParserOptions } from "./context";
import { getParserServices } from "./parser_services";
import type { ContextWithParserOptions, ParserServices } from "./types";

export type Plugin = Omit<OxlintPlugin, "rules"> & {
  readonly rules: Record<string, Rule>;
} & Record<string, unknown>;
export type Rule = OxlintRule & Record<string, unknown>;

const defineOxlintPlugin = oxlintPluginApi.definePlugin;
const defineOxlintRule = oxlintPluginApi.defineRule;
const baseCompatPlugin = Reflect.get(
  oxlintPluginApi as object,
  ["es", "lintCompatPlugin"].join(""),
) as typeof oxlintPluginApi.definePlugin;

export function definePlugin(plugin: Plugin): Plugin {
  return defineOxlintPlugin({
    ...plugin,
    rules: wrapRules(plugin.rules ?? {}),
  } as OxlintPlugin) as Plugin;
}

/**
 * Defines a single Oxlint rule with type-aware parser services.
 *
 * @example
 * ```ts
 * export default defineRule({
 *   meta: { schema: [], messages: { demo: "demo" } },
 *   create(context) {
 *     const services = context.parserServices;
 *     return {};
 *   },
 * });
 * ```
 */
export function defineRule(rule: Rule): Rule {
  return defineOxlintRule(decorateRule(rule) as OxlintRule) as Rule;
}

export function compatPlugin(plugin: Plugin): Plugin {
  return baseCompatPlugin(definePlugin(plugin)) as Plugin;
}

export function decorateRule(rule: Rule): Rule {
  if (rule.create) {
    return {
      ...rule,
      create(context) {
        return rule.create!(decorateContext(context, rule));
      },
    } as Rule;
  }
  if ("createOnce" in rule && typeof (rule as any).createOnce === "function") {
    return {
      ...rule,
      createOnce(context) {
        return (rule as any).createOnce(decorateContext(context, rule));
      },
    } as Rule;
  }
  return rule;
}

function wrapRules(rules: Record<string, Rule>): Record<string, Rule> {
  return Object.fromEntries(
    Object.entries(rules).map(([name, rule]) => [name, decorateRule(rule)]),
  );
}

function decorateContext(context: ContextWithParserOptions, rule: Rule): ContextWithParserOptions {
  const parserOptions = Object.freeze(
    resolveTypeAwareParserOptions(context, {
      projectService: requiresTypeChecking(rule),
    }),
  );
  const baseLanguageOptions = context.languageOptions;
  const languageOptions = Object.freeze({
    ...baseLanguageOptions,
    parserOptions,
  });
  return Object.create(context as OxlintContext, {
    languageOptions: {
      configurable: true,
      enumerable: true,
      get() {
        return languageOptions;
      },
    },
    parserOptions: {
      configurable: true,
      enumerable: false,
      get() {
        return parserOptions;
      },
    },
    parserServices: {
      configurable: true,
      enumerable: false,
      get(): ParserServices {
        return getParserServices(context);
      },
    },
  }) as ContextWithParserOptions;
}

function requiresTypeChecking(rule: Rule): boolean {
  return (
    (rule.meta as { readonly docs?: { readonly requiresTypeChecking?: unknown } } | undefined)?.docs
      ?.requiresTypeChecking === true
  );
}
