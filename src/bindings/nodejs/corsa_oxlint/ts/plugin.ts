import * as oxlintPluginApi from "@oxlint/plugins";
import type {
  Context as OxlintContext,
  Diagnostic,
  Plugin as OxlintPlugin,
  Rule as OxlintRule,
  RuleMeta as OxlintRuleMeta,
} from "@oxlint/plugins";

import { AST_NODE_TYPES } from "./compat";
import { resolveTypeAwareParserOptions } from "./context";
import type { ESTree as PublicESTree } from "./index";
import { getParserServices } from "./parser_services";
import type { ContextWithParserOptions, ParserServices } from "./types";

export type Plugin = Omit<OxlintPlugin, "rules"> & {
  readonly rules: Record<string, Rule>;
} & Record<string, unknown>;
export type Rule = OxlintRule & Record<string, unknown>;
export type RuleDiagnostic<MessageId extends string = string> = Diagnostic & {
  readonly messageId?: MessageId | null | undefined;
};
export type RuleContext<
  MessageId extends string = string,
  Options extends readonly unknown[] = readonly unknown[],
> = Omit<ContextWithParserOptions, "options" | "report"> & {
  readonly options: Readonly<Options>;
  report(this: void, diagnostic: RuleDiagnostic<MessageId>): void;
};
export type RuleDocs = {
  readonly description?: string;
  readonly recommended?: unknown;
  readonly url?: string;
  /**
   * Enables corsa-oxlint's type-aware parser service defaults for this rule.
   *
   * @default false
   */
  readonly requiresTypeChecking?: boolean;
};
export type RuleMetaWithMessages<MessageId extends string = string> = Omit<
  OxlintRuleMeta,
  "docs" | "messages"
> & {
  readonly docs?: RuleDocs;
  readonly messages?: Record<MessageId, string>;
};
type CorsaAstNodeType = keyof typeof AST_NODE_TYPES;
type BivariantVisitorHandler<Handler extends (...args: any[]) => any> = {
  bivarianceHack(...args: Parameters<Handler>): ReturnType<Handler>;
}["bivarianceHack"];
type VisitorNode<Kind extends CorsaAstNodeType> = PublicESTree[Kind];

export type Visitor = {
  [Kind in CorsaAstNodeType]?: BivariantVisitorHandler<(node: VisitorNode<Kind>) => void>;
} & {
  [Kind in CorsaAstNodeType as `${Kind}:exit`]?: BivariantVisitorHandler<
    (node: VisitorNode<Kind>) => void
  >;
} & Record<string, BivariantVisitorHandler<(node: PublicESTree.Node) => void> | undefined>;

export type VisitorWithHooks = Visitor & {
  readonly before?: () => boolean | void;
  readonly after?: () => void;
};
export type RuleDefinition<
  MessageId extends string = string,
  Options extends readonly unknown[] = readonly unknown[],
> = Record<string, unknown> & {
  readonly defaultOptions?: Options;
  readonly meta?: RuleMetaWithMessages<MessageId>;
} & (
    | {
        readonly create: (context: RuleContext<MessageId, Options>) => Visitor;
        readonly createOnce?: never;
      }
    | {
        readonly create?: (context: RuleContext<MessageId, Options>) => Visitor;
        readonly createOnce: (context: RuleContext<MessageId, Options>) => VisitorWithHooks;
      }
  );

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
export function defineRule<
  MessageId extends string = string,
  const Options extends readonly unknown[] = readonly unknown[],
>(rule: RuleDefinition<MessageId, Options>): Rule;
export function defineRule(rule: RuleDefinition): Rule {
  return defineOxlintRule(decorateRule(rule as unknown as Rule) as OxlintRule) as Rule;
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
  const typeAware = requiresTypeChecking(rule);
  const parserOptions = Object.freeze(
    resolveTypeAwareParserOptions(context, {
      corsa: typeAware,
      projectService: typeAware,
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
