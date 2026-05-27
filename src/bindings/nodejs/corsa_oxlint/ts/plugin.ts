import * as oxlintPluginApi from "@oxlint/plugins";
import type {
  Context as OxlintContext,
  Plugin as OxlintPlugin,
  Rule as OxlintRule,
} from "@oxlint/plugins";

import { resolveTypeAwareParserOptions } from "./context";
import { getParserServices } from "./parser_services";
import type { ContextWithParserOptions, ParserServices } from "./types";

type PluginShape = OxlintPlugin;
type RuleShape = OxlintRule;
const defineOxlintPlugin = oxlintPluginApi.definePlugin;
const defineOxlintRule = oxlintPluginApi.defineRule;
const baseCompatPlugin = Reflect.get(
  oxlintPluginApi as object,
  ["es", "lintCompatPlugin"].join(""),
) as typeof oxlintPluginApi.definePlugin;

export function definePlugin<Plugin extends PluginShape>(plugin: Plugin): Plugin {
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
export function defineRule<Rule extends RuleShape>(rule: Rule): Rule {
  return defineOxlintRule(decorateRule(rule) as OxlintRule) as Rule;
}

export function compatPlugin<Plugin extends PluginShape>(plugin: Plugin): Plugin {
  return baseCompatPlugin(definePlugin(plugin)) as Plugin;
}

export function decorateRule<Rule extends RuleShape>(rule: Rule): Rule {
  if (rule.create) {
    return {
      ...rule,
      create(context) {
        return rule.create!(decorateContext(context));
      },
    } as Rule;
  }
  if ("createOnce" in rule && typeof (rule as any).createOnce === "function") {
    return {
      ...rule,
      createOnce(context) {
        return (rule as any).createOnce(decorateContext(context));
      },
    } as Rule;
  }
  return rule;
}

function wrapRules(rules: Record<string, RuleShape>): Record<string, RuleShape> {
  return Object.fromEntries(
    Object.entries(rules).map(([name, rule]) => [name, decorateRule(rule)]),
  );
}

function decorateContext(context: ContextWithParserOptions): ContextWithParserOptions {
  const parserOptions = Object.freeze(resolveTypeAwareParserOptions(context));
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
