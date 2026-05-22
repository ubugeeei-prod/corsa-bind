import { describe, expect, it } from "vitest";

import * as astUtilsEntry from "./ast_utils";
import * as main from "./index";
import * as eslintUtilsEntry from "./oxlint_utils";
import * as compatEntry from "./oxlint_compat";
import * as rules from "./rules";
import * as tsEslintEntry from "./ts_eslint";
import * as tsestreeEntry from "./ts_estree";
import * as tsUtilsEntry from "./ts_utils";

describe("api surface", () => {
  it("re-exports the compatibility entrypoint", () => {
    expect(typeof compatEntry.oxlintCompat.config).toBe("function");
    expect(compatEntry.oxlintCompat.parser.meta.name).toBe("oxlint-plugin-corsa/parser");
  });

  it("re-exports ts-estree helpers from the root entry", () => {
    expect(main.TSESTree.AST_NODE_TYPES.Program).toBe("Program");
    expect(main.TSESTree.AST_NODE_TYPES.JSXElement).toBe("JSXElement");
    expect(main.TSESTree.AST_NODE_TYPES.TSArrayType).toBe("TSArrayType");
    expect(main.TSESTree.AST_NODE_TYPES.TSExpressionWithTypeArguments).toBe(
      "TSExpressionWithTypeArguments",
    );
    expect(main.TSESTree.AST_TOKEN_TYPES.Block).toBe("Block");
    expect(tsestreeEntry.AST_NODE_TYPES.Identifier).toBe("Identifier");
  });

  it("re-exports typescript-eslint-style utility namespaces", () => {
    expect(main.ESLintUtils.RuleCreator).toBe(main.RuleCreator);
    expect(main.ESLintUtils.nullThrows("value", "present")).toBe("value");
    expect(main.ESLintUtils.NullThrowsReasons.MissingToken("token", "node")).toBe(
      "Expected to find a token for the node.",
    );
    expect(main.ESLintUtils.applyDefault([{ nested: { enabled: true }, value: 1 }], [{}])).toEqual([
      { nested: { enabled: true }, value: 1 },
    ]);
    expect(
      main.ESLintUtils.applyDefault(
        [{ nested: { enabled: true }, value: 1 }],
        [{ nested: { enabled: false } }],
      ),
    ).toEqual([{ nested: { enabled: false }, value: 1 }]);
    expect(typeof main.RuleCreator.withoutDocs).toBe("function");
    expect(main.TSUtils.isArray([])).toBe(true);
    expect(tsUtilsEntry.TSUtils.isArray({})).toBe(false);
    expect(main.TSESLint.RuleTester).toBe(main.RuleTester);
    expect(tsEslintEntry.TSESLint.RuleTester).toBe(main.RuleTester);
    expect(tsEslintEntry.RuleTester).toBe(main.RuleTester);
    expect(eslintUtilsEntry.ESLintUtils.getParserServices).toBe(main.getParserServices);
  });

  it("tracks the pinned typescript-eslint utility namespace keys", async () => {
    const upstream =
      await import("../../../../../bench/cli_compare/node_modules/@typescript-eslint/utils/dist/index.js");

    expectMissingKeys("root", main, upstream, ["__esModule", "default", "module.exports"]);
    expectMissingKeys("AST_NODE_TYPES", main.AST_NODE_TYPES, upstream.AST_NODE_TYPES);
    expectMissingKeys("AST_TOKEN_TYPES", main.AST_TOKEN_TYPES, upstream.AST_TOKEN_TYPES);
    expectMissingKeys("ASTUtils", astUtilsEntry, upstream.ASTUtils);
    expectMissingKeys("ESLintUtils", eslintUtilsEntry.ESLintUtils, upstream.ESLintUtils);
    expectMissingKeys("TSESLint", tsEslintEntry.TSESLint, upstream.TSESLint);
    expectMissingKeys("TSUtils", tsUtilsEntry.TSUtils, upstream.TSUtils);
  });

  it("marks ESLint-only utility exports as unsupported", () => {
    expect(() => astUtilsEntry.findVariable()).toThrow(/ASTUtils\.findVariable/);
    expect(() => new astUtilsEntry.ReferenceTracker()).toThrow(/ASTUtils\.ReferenceTracker/);
    expect(() => new main.TSESLint.Linter()).toThrow(/TSESLint\.Linter/);
  });

  it("supports typescript-eslint-style ASTUtils predicate factories", () => {
    const identifier = { type: "Identifier", name: "value" };
    const optionalCall = { type: "CallExpression", optional: true };
    const awaitToken = { type: "Identifier", value: "await" };
    const colonToken = { type: "Punctuator", value: ":" };

    expect(astUtilsEntry.isNodeOfType("Identifier")(identifier)).toBe(true);
    expect(astUtilsEntry.isNodeOfType(identifier, "Identifier")).toBe(true);
    expect(astUtilsEntry.isNodeOfTypes(["Identifier"])(identifier)).toBe(true);
    expect(
      astUtilsEntry.isNodeOfTypeWithConditions("CallExpression", { optional: true })(optionalCall),
    ).toBe(true);
    expect(
      astUtilsEntry.isTokenOfTypeWithConditions("Punctuator", { value: ":" })(colonToken),
    ).toBe(true);
    expect(
      astUtilsEntry.isNotTokenOfTypeWithConditions("Punctuator", { value: ":" })(awaitToken),
    ).toBe(true);
    expect(astUtilsEntry.isAwaitKeyword(awaitToken)).toBe(true);
    expect(astUtilsEntry.isClassOrTypeElement({ type: "TSPropertySignature" })).toBe(true);
  });

  it("re-exports the native rules surface from both entrypoints", () => {
    expect(typeof main.rules.typescriptOxlintPlugin).toBe("object");
    expect(rules.implementedNativeRuleNames).toContain("restrict-plus-operands");
  });

  it("re-exports Rust-backed utility helpers from the root entry", () => {
    expect(main.Utils.classifyTypeText("Promise<string>")).toBe("other");
    expect(main.Utils.isPromiseLikeTypeTexts(["Promise<string>"])).toBe(true);
    expect(main.Utils.splitTypeText("string | number & bigint")).toEqual([
      "string",
      "number",
      "bigint",
    ]);
  });
});

function expectMissingKeys(
  label: string,
  local: Record<string, unknown>,
  upstream: Record<string, unknown>,
  ignored: readonly string[] = [],
): void {
  const localKeys = new Set(Object.keys(local));
  const ignoredKeys = new Set(ignored);
  const missing = Object.keys(upstream)
    .filter((key) => !ignoredKeys.has(key))
    .filter((key) => !localKeys.has(key));
  expect(missing, `${label} missing keys`).toEqual([]);
}
