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

  it("supports scope-free ASTUtils static evaluation helpers", async () => {
    const upstream =
      await import("../../../../../bench/cli_compare/node_modules/@typescript-eslint/utils/dist/index.js");
    const member = {
      type: "MemberExpression",
      computed: false,
      property: { type: "Identifier", name: "value" },
    };
    const computedMember = {
      type: "MemberExpression",
      computed: true,
      property: { type: "Literal", value: "value" },
    };
    const template = {
      type: "TemplateLiteral",
      expressions: [{ type: "Literal", value: 1 }],
      quasis: [
        { type: "TemplateElement", value: { cooked: "left", raw: "left" } },
        { type: "TemplateElement", value: { cooked: "right", raw: "right" } },
      ],
    };
    const binary = {
      type: "BinaryExpression",
      operator: "+",
      left: { type: "Literal", value: "v" },
      right: { type: "Literal", value: 1 },
    };

    expect(astUtilsEntry.getPropertyName(member)).toBe(upstream.ASTUtils.getPropertyName(member));
    expect(astUtilsEntry.getPropertyName(computedMember)).toBe(
      upstream.ASTUtils.getPropertyName(computedMember),
    );
    expect(astUtilsEntry.getStringIfConstant(template)).toBe(
      upstream.ASTUtils.getStringIfConstant(template),
    );
    expect(astUtilsEntry.getStaticValue(binary)).toEqual(
      upstream.ASTUtils.getStaticValue(binary),
    );
    expect(
      astUtilsEntry.getStringIfConstant({
        type: "Literal",
        value: null,
        regex: { pattern: "a+", flags: "u" },
      }),
    ).toBe(upstream.ASTUtils.getStringIfConstant({
      type: "Literal",
      value: null,
      regex: { pattern: "a+", flags: "u" },
    }));
    expect(
      astUtilsEntry.getPropertyName({
        type: "PropertyDefinition",
        computed: false,
        key: { type: "PrivateIdentifier", name: "value" },
      }),
    ).toBe(upstream.ASTUtils.getPropertyName({
      type: "PropertyDefinition",
      computed: false,
      key: { type: "PrivateIdentifier", name: "value" },
    }));
  });

  it("matches scope and function ASTUtils helpers for lightweight inputs", async () => {
    const upstream =
      await import("../../../../../bench/cli_compare/node_modules/@typescript-eslint/utils/dist/index.js");
    const innerVariable = { name: "value" };
    const outerScope = {
      block: { range: [0, 100] },
      childScopes: [] as unknown[],
      set: new Map<string, unknown>([["outer", { name: "outer" }]]),
      upper: null,
    };
    const innerScope = {
      block: { range: [5, 20] },
      childScopes: [],
      set: new Map<string, unknown>([["value", innerVariable]]),
      upper: outerScope,
    };
    outerScope.childScopes = [innerScope];
    const identifier = { type: "Identifier", name: "value", range: [10, 15] };

    expect(astUtilsEntry.getInnermostScope(outerScope, identifier)).toBe(
      upstream.ASTUtils.getInnermostScope(outerScope, identifier),
    );
    expect(astUtilsEntry.findVariable(outerScope, identifier)).toBe(
      upstream.ASTUtils.findVariable(outerScope, identifier),
    );

    const functionNode = {
      type: "ArrowFunctionExpression",
      async: true,
      generator: false,
      body: { type: "Identifier" },
    };
    const functionParent = {
      type: "VariableDeclarator",
      id: { type: "Identifier", name: "task" },
      init: functionNode,
    };
    Object.assign(functionNode, { parent: functionParent });
    const arrowToken = {
      type: "Punctuator",
      value: "=>",
      loc: { start: { line: 1, column: 10 }, end: { line: 1, column: 12 } },
    };
    const sourceCode = {
      getTokenBefore: () => arrowToken,
    };

    expect(astUtilsEntry.getFunctionNameWithKind(functionNode)).toBe(
      upstream.ASTUtils.getFunctionNameWithKind(functionNode),
    );
    expect(astUtilsEntry.getFunctionHeadLocation(functionNode, sourceCode)).toEqual(
      upstream.ASTUtils.getFunctionHeadLocation(functionNode, sourceCode),
    );
  });

  it("matches PatternMatcher and side-effect helper behavior", async () => {
    const upstream =
      await import("../../../../../bench/cli_compare/node_modules/@typescript-eslint/utils/dist/index.js");
    const input = "foo \\foo foo";
    const localMatcher = new astUtilsEntry.PatternMatcher(/foo/g);
    const upstreamMatcher = new upstream.ASTUtils.PatternMatcher(/foo/g);

    expect([...localMatcher.execAll(input)].map((match) => match.index)).toEqual(
      [...upstreamMatcher.execAll(input)].map((match) => match.index),
    );
    expect(localMatcher.test("\\foo")).toBe(upstreamMatcher.test("\\foo"));
    expect(input.replace(localMatcher, "bar")).toBe(input.replace(upstreamMatcher, "bar"));

    const sourceCode = { visitorKeys: {} };
    expect(astUtilsEntry.hasSideEffect({ type: "CallExpression" }, sourceCode)).toBe(
      upstream.ASTUtils.hasSideEffect({ type: "CallExpression" }, sourceCode),
    );
    expect(
      astUtilsEntry.hasSideEffect(
        {
          type: "MemberExpression",
          computed: false,
          object: { type: "Identifier", name: "item" },
          property: { type: "Identifier", name: "value" },
        },
        sourceCode,
        { considerGetters: true },
      ),
    ).toBe(
      upstream.ASTUtils.hasSideEffect(
        {
          type: "MemberExpression",
          computed: false,
          object: { type: "Identifier", name: "item" },
          property: { type: "Identifier", name: "value" },
        },
        sourceCode,
        { considerGetters: true },
      ),
    );
    expect(
      astUtilsEntry.hasSideEffect(
        {
          type: "ArrowFunctionExpression",
          body: { type: "CallExpression" },
        },
        sourceCode,
      ),
    ).toBe(
      upstream.ASTUtils.hasSideEffect(
        {
          type: "ArrowFunctionExpression",
          body: { type: "CallExpression" },
        },
        sourceCode,
      ),
    );
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
