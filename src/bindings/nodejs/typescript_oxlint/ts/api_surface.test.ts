import { describe, expect, it } from "vitest";

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
    expect(main.TSUtils.isArray([])).toBe(true);
    expect(tsUtilsEntry.TSUtils.isArray({})).toBe(false);
    expect(main.TSESLint.RuleTester).toBe(main.RuleTester);
    expect(tsEslintEntry.TSESLint.RuleTester).toBe(main.RuleTester);
    expect(tsEslintEntry.RuleTester).toBe(main.RuleTester);
    expect(eslintUtilsEntry.ESLintUtils.getParserServices).toBe(main.getParserServices);
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
