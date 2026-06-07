import {
  nativeStylisticRuleMetas,
  runNativeStylisticLint,
  type NativeLintDiagnostic,
  type NativeLintFix,
  type NativeLintRange,
  type NativeLintRuleMeta,
  type NativeLintSuggestion,
  type NativeStylisticRuleConfig,
} from "@corsa-bind/napi";

import { definePlugin, defineRule } from "./plugin";
import type { ContextWithParserOptions } from "./types";

type ProgramNode = {
  readonly type: string;
  readonly range?: readonly [number, number];
};

export type CorsaStylisticRuleName =
  | "eol-last"
  | "linebreak-style"
  | "no-multiple-empty-lines"
  | "no-tabs"
  | "no-trailing-spaces"
  | "quotes"
  | "unicode-bom"
  | "arrow-spacing"
  | "comma-spacing"
  | "semi-spacing"
  | "space-in-parens"
  | "template-curly-spacing"
  | "rest-spread-spacing"
  | "no-multi-spaces"
  | "no-whitespace-before-property"
  | "dot-location"
  | "spaced-comment"
  | "object-curly-spacing"
  | "array-bracket-spacing"
  | "computed-property-spacing"
  | "block-spacing"
  | "space-before-blocks"
  | "function-call-spacing"
  | "space-before-function-paren"
  | "no-floating-decimal"
  | "template-tag-spacing"
  | "yield-star-spacing"
  | "generator-star-spacing"
  | "comma-dangle"
  | "space-infix-ops"
  | "max-len"
  | "semi-style"
  | "comma-style"
  | "arrow-parens"
  | "switch-colon-spacing"
  | "no-extra-semi"
  | "new-parens"
  | "space-unary-ops"
  | "wrap-regex"
  | "implicit-arrow-linebreak"
  | "operator-linebreak"
  | "keyword-spacing";

export type CorsaStylisticRuleOptions = readonly unknown[];

export interface CorsaStylisticSettings {
  /**
   * Rule options used by the native batch runner.
   *
   * Keep this in sync with enabled Oxlint rules when several stylistic rules
   * are active; the JS bridge can then perform one native scan and share the
   * diagnostics across individual rule reports.
   */
  readonly rules?: Partial<Record<CorsaStylisticRuleName, CorsaStylisticRuleOptions>>;
}

const stylisticMetas = nativeStylisticRuleMetas();
const stylisticMetasByName = new Map(stylisticMetas.map((meta) => [meta.name, meta]));
type CachedStylisticDiagnostics = {
  readonly sourceText: string;
  readonly diagnostics: readonly NativeLintDiagnostic[];
};

type ByteToUtf16Mapper = (offset: number) => number;

type NonAsciiSpan = {
  readonly byteStart: number;
  readonly byteEnd: number;
  readonly utf16Start: number;
  readonly deltaAfter: number;
};

const diagnosticsCache = new WeakMap<object, Map<string, CachedStylisticDiagnostics>>();

/**
 * Native stylistic rule names exported by `corsa-oxlint/stylistic`.
 */
export const implementedStylisticRuleNames = [
  "eol-last",
  "linebreak-style",
  "no-multiple-empty-lines",
  "no-tabs",
  "no-trailing-spaces",
  "quotes",
  "unicode-bom",
  "arrow-spacing",
  "comma-spacing",
  "semi-spacing",
  "space-in-parens",
  "template-curly-spacing",
  "rest-spread-spacing",
  "no-multi-spaces",
  "no-whitespace-before-property",
  "dot-location",
  "spaced-comment",
  "object-curly-spacing",
  "array-bracket-spacing",
  "computed-property-spacing",
  "block-spacing",
  "space-before-blocks",
  "function-call-spacing",
  "space-before-function-paren",
  "no-floating-decimal",
  "template-tag-spacing",
  "yield-star-spacing",
  "generator-star-spacing",
  "comma-dangle",
  "space-infix-ops",
  "max-len",
  "semi-style",
  "comma-style",
  "arrow-parens",
  "switch-colon-spacing",
  "no-extra-semi",
  "new-parens",
  "space-unary-ops",
  "wrap-regex",
  "implicit-arrow-linebreak",
  "operator-linebreak",
  "keyword-spacing",
] as const satisfies readonly CorsaStylisticRuleName[];

/**
 * Oxlint-compatible stylistic rules backed by the Rust source scanner.
 */
export const corsaStylisticRules = Object.freeze(
  Object.fromEntries(
    implementedStylisticRuleNames.map((ruleName) => [ruleName, createStylisticRule(ruleName)]),
  ),
) as Readonly<Record<CorsaStylisticRuleName, ReturnType<typeof createStylisticRule>>>;

/**
 * Oxlint plugin exposing Corsa's Rust-backed stylistic rules.
 *
 * Register it under any namespace, then enable rules such as
 * `stylistic/quotes` or `stylistic/no-trailing-spaces`.
 */
export const corsaStylisticPlugin = definePlugin({
  meta: { name: "oxlint-plugin-corsa-stylistic" },
  rules: corsaStylisticRules,
});

export default corsaStylisticPlugin;

function createStylisticRule(ruleName: CorsaStylisticRuleName) {
  const meta = stylisticRuleMeta(ruleName);
  return defineRule({
    defaultOptions: [],
    meta: {
      type: "layout",
      docs: {
        description: meta.docsDescription,
        requiresTypeChecking: false,
        url: `https://github.com/ubugeeei-prod/corsa-bind/tree/main/src/bindings/nodejs/corsa_oxlint/ts/stylistic.ts`,
      },
      fixable: "whitespace",
      hasSuggestions: meta.hasSuggestions,
      messages: meta.messages,
      schema: { type: "array" },
    },
    create(context: ContextWithParserOptions) {
      return {
        Program(node: ProgramNode) {
          reportStylisticDiagnostics(
            context,
            node,
            diagnosticsForRule(context, ruleName).filter(
              (diagnostic) => diagnostic.ruleName === ruleName,
            ),
          );
        },
      };
    },
  });
}

function diagnosticsForRule(
  context: ContextWithParserOptions,
  ruleName: CorsaStylisticRuleName,
): readonly NativeLintDiagnostic[] {
  const sourceCode = context.sourceCode as unknown as object;
  const sourceText = sourceTextForContext(context);
  const config = stylisticRunConfig(context, ruleName);
  const key = JSON.stringify(config);
  let sourceCache = diagnosticsCache.get(sourceCode);
  if (!sourceCache) {
    sourceCache = new Map();
    diagnosticsCache.set(sourceCode, sourceCache);
  }

  const cached = sourceCache.get(key);
  if (cached?.sourceText === sourceText) {
    return cached.diagnostics;
  }

  const diagnostics = mapNativeDiagnosticRanges(
    runNativeStylisticLint(sourceText, { rules: config }),
    sourceText,
  );
  sourceCache.set(key, { sourceText, diagnostics });
  return diagnostics;
}

function stylisticRunConfig(
  context: ContextWithParserOptions,
  currentRuleName: CorsaStylisticRuleName,
): readonly NativeStylisticRuleConfig[] {
  const settingsRules = context.settings?.corsaStylistic?.rules;
  const rules = new Map<CorsaStylisticRuleName, CorsaStylisticRuleOptions>();

  if (settingsRules) {
    for (const [name, options] of Object.entries(settingsRules)) {
      assertKnownStylisticRuleName(name);
      rules.set(name, normalizeOptions(options));
    }
  }

  const currentOptions = currentRuleOptions(context);
  if (!rules.has(currentRuleName) || currentOptions.length > 0) {
    rules.set(currentRuleName, currentOptions);
  }

  return implementedStylisticRuleNames
    .filter((ruleName) => rules.has(ruleName))
    .map((ruleName) => ({
      name: ruleName,
      options: rules.get(ruleName) ?? [],
    }));
}

function reportStylisticDiagnostics(
  context: ContextWithParserOptions,
  program: ProgramNode,
  diagnostics: readonly NativeLintDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    context.report({
      node: rangeNode(program, diagnostic.range),
      messageId: diagnostic.messageId,
      ...(diagnostic.suggestions?.length
        ? {
            suggest: diagnostic.suggestions.map((suggestion) => ({
              messageId: suggestion.messageId,
              fix: (fixer: any) =>
                suggestion.fixes.map((fix) =>
                  fixer.replaceTextRange(oxlintRange(fix.range), fix.replacementText),
                ),
            })),
          }
        : {}),
    } as never);
  }
}

function rangeNode(program: ProgramNode, range: NativeLintRange): ProgramNode {
  return {
    ...program,
    range: oxlintRange(range),
  };
}

function oxlintRange(range: NativeLintRange): [number, number] {
  return [range.start, range.end];
}

function mapNativeDiagnosticRanges(
  diagnostics: readonly NativeLintDiagnostic[],
  sourceText: string,
): readonly NativeLintDiagnostic[] {
  const byteToUtf16 = createByteToUtf16Mapper(sourceText);
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    range: mapNativeRange(diagnostic.range, byteToUtf16),
    ...(diagnostic.suggestions?.length
      ? {
          suggestions: diagnostic.suggestions.map((suggestion) =>
            mapNativeSuggestion(suggestion, byteToUtf16),
          ),
        }
      : {}),
  }));
}

function mapNativeSuggestion(
  suggestion: NativeLintSuggestion,
  byteToUtf16: ByteToUtf16Mapper,
): NativeLintSuggestion {
  return {
    ...suggestion,
    fixes: suggestion.fixes.map((fix) => mapNativeFix(fix, byteToUtf16)),
  };
}

function mapNativeFix(fix: NativeLintFix, byteToUtf16: ByteToUtf16Mapper): NativeLintFix {
  return {
    ...fix,
    range: mapNativeRange(fix.range, byteToUtf16),
  };
}

function mapNativeRange(range: NativeLintRange, byteToUtf16: ByteToUtf16Mapper): NativeLintRange {
  return {
    start: byteToUtf16(range.start),
    end: byteToUtf16(range.end),
  };
}

function createByteToUtf16Mapper(sourceText: string): ByteToUtf16Mapper {
  const nonAsciiSpans: NonAsciiSpan[] = [];
  let byteOffset = 0;
  let utf16Offset = 0;

  while (utf16Offset < sourceText.length) {
    const codePoint = sourceText.codePointAt(utf16Offset);
    if (codePoint === undefined) {
      break;
    }
    const utf16Length = codePoint > 0xffff ? 2 : 1;
    const byteLength = utf8ByteLength(codePoint);
    const byteEnd = byteOffset + byteLength;
    const utf16End = utf16Offset + utf16Length;
    if (byteLength !== utf16Length) {
      nonAsciiSpans.push({
        byteStart: byteOffset,
        byteEnd,
        utf16Start: utf16Offset,
        deltaAfter: byteEnd - utf16End,
      });
    }
    byteOffset = byteEnd;
    utf16Offset = utf16End;
  }

  if (nonAsciiSpans.length === 0) {
    return (offset) => clampOffset(offset, sourceText.length);
  }

  const totalBytes = byteOffset;
  return (offset) => {
    const byteOffset = clampOffset(offset, totalBytes);
    let low = 0;
    let high = nonAsciiSpans.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (nonAsciiSpans[mid].byteEnd <= byteOffset) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    const nextSpan = nonAsciiSpans[low];
    if (nextSpan && byteOffset >= nextSpan.byteStart && byteOffset < nextSpan.byteEnd) {
      return nextSpan.utf16Start;
    }

    const previousSpan = nonAsciiSpans[low - 1];
    const delta = previousSpan?.deltaAfter ?? 0;
    return clampOffset(byteOffset - delta, sourceText.length);
  };
}

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) {
    return 1;
  }
  if (codePoint <= 0x7ff) {
    return 2;
  }
  if (codePoint <= 0xffff) {
    return 3;
  }
  return 4;
}

function clampOffset(offset: number, max: number): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  if (offset <= 0) {
    return 0;
  }
  if (offset >= max) {
    return max;
  }
  return Math.trunc(offset);
}

function sourceTextForContext(context: ContextWithParserOptions): string {
  const text = (context.sourceCode as { text?: unknown }).text;
  if (typeof text === "string") {
    return text;
  }
  return context.sourceCode.getText({ type: "Program" } as never);
}

function currentRuleOptions(context: ContextWithParserOptions): CorsaStylisticRuleOptions {
  return normalizeOptions((context as { options?: unknown }).options);
}

function normalizeOptions(options: unknown): CorsaStylisticRuleOptions {
  if (Array.isArray(options)) {
    return options;
  }
  if (options == null) {
    return [];
  }
  return [options];
}

function assertKnownStylisticRuleName(name: string): asserts name is CorsaStylisticRuleName {
  if (!(implementedStylisticRuleNames as readonly string[]).includes(name)) {
    throw new Error(`unknown corsa stylistic rule: ${name}`);
  }
}

function stylisticRuleMeta(ruleName: CorsaStylisticRuleName): NativeLintRuleMeta {
  const meta = stylisticMetasByName.get(ruleName);
  if (!meta) {
    throw new Error(`corsa stylistic native Rust rule is not registered: ${ruleName}`);
  }
  return meta;
}
