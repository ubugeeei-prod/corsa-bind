import type { Rule } from "@oxlint/plugins";
import { describe, expect, expectTypeOf, it } from "vitest";

import { defineRule } from "./plugin";
import { OxlintUtils } from "./oxlint_utils";

describe("corsa oxlint RuleCreator types", () => {
  it("preserves typed RuleCreator return values", () => {
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "typed-options",
      meta: {
        type: "problem",
        docs: {
          description: "typed rule",
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      defaultOptions: [{ allow: true }] as const,
      create(context) {
        expectTypeOf(context.parserServices).toMatchTypeOf<object | undefined>();
        return {};
      },
    });
    const ruleWithoutOptions = createRule({
      name: "typed-default-options",
      meta: {
        type: "problem",
        docs: {
          description: "typed rule with defaulted options",
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      create() {
        return {};
      },
    });

    expectTypeOf(rule).toMatchTypeOf<Rule>();
    expectTypeOf(rule.defaultOptions).toEqualTypeOf<readonly [{ readonly allow: true }]>();
    expectTypeOf(rule.meta.docs.url).toEqualTypeOf<string>();
    expectTypeOf(rule.meta.messages.unexpected).toMatchTypeOf<string>();
    expectTypeOf(ruleWithoutOptions.defaultOptions).toEqualTypeOf<readonly []>();
    expect(rule.defaultOptions).toEqual([{ allow: true }]);
    expect(ruleWithoutOptions.defaultOptions).toEqual([]);
    expect(rule.meta.docs.url).toBe("https://example.com/rules/typed-options");
    expectTypeOf(rule.meta.docs.requiresTypeChecking).toEqualTypeOf<boolean | undefined>();
  });

  it("surfaces requiresTypeChecking on typed rule docs", () => {
    const rule = defineRule({
      meta: {
        type: "problem",
        docs: {
          description: "typed rule docs",
          requiresTypeChecking: true,
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      create() {
        return {};
      },
    });

    expectTypeOf(rule.meta?.docs?.requiresTypeChecking).toEqualTypeOf<boolean | undefined>();

    defineRule({
      meta: {
        type: "problem",
        docs: {
          description: "typed rule docs",
          // @ts-expect-error typo should be rejected by the public docs type.
          requiresTypeCheckng: true,
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      create() {
        return {};
      },
    });
  });
});
