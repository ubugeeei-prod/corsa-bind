import { describe, expect, it } from "vitest";

import { nativeLintRuleMetas, runNativeLintRule } from "@corsa-bind/napi";
import type { NativeLintDiagnostic, NativeLintNode } from "@corsa-bind/napi";

import { implementedNativeRuleNames } from "./rules";

type IdRest = Omit<NativeLintNode, "kind" | "range" | "text" | "typeTexts">;
type NodeRest = Omit<NativeLintNode, "kind" | "range">;
type Suggestion = NonNullable<NativeLintDiagnostic["suggestions"]>[number];

describe("native diagnostic snapshots", () => {
  it("executes every implemented native rule through the Rust bridge", () => {
    const metas = nativeLintRuleMetas();
    const names = metas.map((meta) => meta.name).sort();

    expect(names).toEqual([...implementedNativeRuleNames].sort());
    for (const meta of metas) {
      expect(() =>
        runNativeLintRule(meta.name, node(meta.listeners[0] ?? "Program", [0, 0])),
      ).not.toThrow();
    }
  });

  it("has at least one diagnostic fixture for every implemented native rule", () => {
    const coveredRuleNames = new Set(diagnosticCases.map(({ ruleName }) => ruleName));

    expect([...coveredRuleNames].sort()).toEqual([...implementedNativeRuleNames].sort());
  });

  it("reports the native rule cases that should be errors", () => {
    const snapshots = diagnosticCases.map(({ ruleName, scenario, node }) => ({
      caseName: `${ruleName}: ${scenario}`,
      diagnostics: runNativeLintRule(ruleName, node).map(summarizeDiagnostic),
    }));

    expect(snapshots.filter(({ diagnostics }) => diagnostics.length === 0)).toEqual([]);
    expect(snapshots).toMatchInlineSnapshot(`
      [
        {
          "caseName": "await-thenable: awaiting a number",
          "diagnostics": [
            "await-thenable/unexpected@0..12: Unexpected await of a non-thenable value.",
          ],
        },
        {
          "caseName": "no-array-delete: deleting from an array-like value",
          "diagnostics": [
            "no-array-delete/unexpected@0..20: Do not delete elements from an array-like value. | suggestions useSplice@0..7=><empty>,13..14=>.splice(,19..20=>, 1): Use array.splice(index, 1) instead.",
          ],
        },
        {
          "caseName": "no-floating-promises: unhandled Promise.resolve expression",
          "diagnostics": [
            "no-floating-promises/unexpected@0..19: Promises must be awaited, returned, or explicitly ignored with void. | suggestions floatingVoid@0..0=>void : Prefix the expression with void. | floatingAwait@0..0=>await : Await the promise.",
          ],
        },
        {
          "caseName": "no-for-in-array: for-in over readonly array",
          "diagnostics": [
            "no-for-in-array/unexpected@0..42: Do not iterate over an array with a for-in loop.",
          ],
        },
        {
          "caseName": "no-implied-eval: setTimeout with a string-like callback",
          "diagnostics": [
            "no-implied-eval/unexpected@0..23: Do not pass a string to an implied eval API.",
          ],
        },
        {
          "caseName": "no-meaningless-void-operator: void around void-like call",
          "diagnostics": [
            "no-meaningless-void-operator/meaninglessVoidOperator@0..13: void operator should only be used to ignore a non-void return value. | suggestions removeVoid@0..5=><empty>: Remove 'void'.",
          ],
        },
        {
          "caseName": "no-mixed-enums: numeric enum member mixed with string-typed initializer",
          "diagnostics": [
            "no-mixed-enums/mixed@24..31: Mixing number and string enums can be confusing.",
          ],
        },
        {
          "caseName": "no-unsafe-call: calling an any-typed callee",
          "diagnostics": [
            "no-unsafe-call/unsafeCall@0..4: Unsafe call of a(n) \`any\` typed value.",
          ],
        },
        {
          "caseName": "no-unsafe-member-access: accessing a member through any",
          "diagnostics": [
            "no-unsafe-member-access/unsafeMemberExpression@6..10: Unsafe member access on an \`any\` value.",
          ],
        },
        {
          "caseName": "no-unsafe-unary-minus: unary minus on string union",
          "diagnostics": [
            "no-unsafe-unary-minus/unaryMinus@0..6: Argument of unary negation should be assignable to number | bigint.",
          ],
        },
        {
          "caseName": "no-unsafe-return: returning any to string",
          "diagnostics": [
            "no-unsafe-return/unsafe@18..23: Unsafe return of an any-typed value.",
          ],
        },
        {
          "caseName": "no-unsafe-type-assertion: narrowing string or number to string",
          "diagnostics": [
            "no-unsafe-type-assertion/unsafeTypeAssertion@0..15: Unsafe type assertion: the asserted type is more narrow than the original type.",
          ],
        },
        {
          "caseName": "only-throw-error: throwing a string",
          "diagnostics": [
            "only-throw-error/unexpected@0..13: Only Error-like values should be thrown.",
          ],
        },
        {
          "caseName": "prefer-find: filter result indexed at zero",
          "diagnostics": [
            "prefer-find/unexpected@0..39: Use .find() instead of filtering and taking the first match.",
          ],
        },
        {
          "caseName": "prefer-includes: indexOf compared with -1",
          "diagnostics": [
            "prefer-includes/unexpected@0..27: Use .includes() instead of comparing an index result.",
          ],
        },
        {
          "caseName": "prefer-promise-reject-errors: rejecting with a string",
          "diagnostics": [
            "prefer-promise-reject-errors/rejectAnError@0..23: Expected the Promise rejection reason to be an Error.",
          ],
        },
        {
          "caseName": "prefer-reduce-type-parameter: reduce initial value asserted as array",
          "diagnostics": [
            "prefer-reduce-type-parameter/preferTypeParameter@42..56: Unnecessary assertion: Array#reduce accepts a type parameter for the default value. | suggestions moveTypeParameter@44..56=><empty>,13..13=><number[]>: Move the assertion type to the Array#reduce type parameter.",
          ],
        },
        {
          "caseName": "prefer-regexp-exec: string match with non-global regexp",
          "diagnostics": [
            "prefer-regexp-exec/unexpected@0..15: Use a RegExp exec() call instead of String match().",
          ],
        },
        {
          "caseName": "prefer-string-starts-ends-with: indexOf compared with zero",
          "diagnostics": [
            "prefer-string-starts-ends-with/startsWith@0..26: Use startsWith() instead of comparing a prefix manually.",
          ],
        },
        {
          "caseName": "require-array-sort-compare: numeric array sort without compare",
          "diagnostics": [
            "require-array-sort-compare/requireCompare@0..13: Require a compare argument for array sorting.",
          ],
        },
        {
          "caseName": "restrict-plus-operands: string plus number with option disabled",
          "diagnostics": [
            "restrict-plus-operands/mismatched@0..12: Operands of + operations must be of the same type.",
          ],
        },
        {
          "caseName": "restrict-template-expressions: object in template literal",
          "diagnostics": [
            "restrict-template-expressions/invalidType@17..29: Invalid type used in template literal expression.",
          ],
        },
        {
          "caseName": "use-unknown-in-catch-callback-variable: catch parameter typed as Error",
          "diagnostics": [
            "use-unknown-in-catch-callback-variable/unexpected@23..35: Catch callback variables should be explicitly typed as unknown.",
          ],
        },
        {
          "caseName": "consistent-return: value return followed by bare return",
          "diagnostics": [
            "consistent-return/missingReturnValue@34..41: Function expected a return value.",
          ],
        },
        {
          "caseName": "consistent-type-exports: named export contains only type-based specifiers",
          "diagnostics": [
            "consistent-type-exports/typeOverValue@0..22: All exports in the declaration are only used as types. Use \`export type\`.",
          ],
        },
        {
          "caseName": "dot-notation: computed access can be dot access",
          "diagnostics": [
            "dot-notation/useDot@7..14: [{{key}}] is better written in dot notation. | suggestions useDot@6..15=>.value: ["value"] is better written in dot notation.",
          ],
        },
        {
          "caseName": "no-base-to-string: object stringified by string concatenation",
          "diagnostics": [
            "no-base-to-string/unexpected@5..18: This value is stringified through its base Object#toString() representation.",
          ],
        },
        {
          "caseName": "no-confusing-void-expression: void call in a variable initializer",
          "diagnostics": [
            "no-confusing-void-expression/invalidVoidExpr@14..28: Placing a void expression inside another expression is forbidden.",
          ],
        },
        {
          "caseName": "no-deprecated: deprecated identifier use",
          "diagnostics": [
            "no-deprecated/deprecated@0..8: This declaration is deprecated.",
          ],
        },
        {
          "caseName": "no-duplicate-type-constituents: duplicate string union constituent",
          "diagnostics": [
            "no-duplicate-type-constituents/duplicate@9..15: Union type constituent is duplicated with a previous constituent. | suggestions duplicate@9..15=><empty>: Remove the duplicated type constituent.",
          ],
        },
        {
          "caseName": "no-misused-promises: promise used as an if condition",
          "diagnostics": [
            "no-misused-promises/conditional@4..11: Expected non-Promise value in a boolean conditional.",
          ],
        },
        {
          "caseName": "no-misused-spread: string spread into an array",
          "diagnostics": [
            "no-misused-spread/noStringSpread@1..8: Using the spread operator on a string can mishandle special characters, because it produces Unicode code points, which will break complex characters (like emojis) into multiple parts.",
          ],
        },
        {
          "caseName": "no-redundant-type-constituents: string literal overridden by string primitive",
          "diagnostics": [
            "no-redundant-type-constituents/literalOverridden@9..12: Literal constituent is overridden by a primitive in this union type.",
          ],
        },
        {
          "caseName": "no-unnecessary-boolean-literal-compare: boolean compared to true",
          "diagnostics": [
            "no-unnecessary-boolean-literal-compare/direct@0..13: This expression unnecessarily compares a boolean value to a boolean instead of using it directly. | suggestions direct@0..13=>flag: This expression unnecessarily compares a boolean value to a boolean instead of using it directly.",
          ],
        },
        {
          "caseName": "no-unnecessary-condition: always truthy string literal condition",
          "diagnostics": [
            "no-unnecessary-condition/alwaysTruthy@4..9: Unnecessary conditional, value is always truthy.",
          ],
        },
        {
          "caseName": "no-unnecessary-qualifier: namespace qualifier is already in scope",
          "diagnostics": [
            "no-unnecessary-qualifier/unnecessaryQualifier@0..1: Qualifier is unnecessary since the referenced name is in scope. | suggestions unnecessaryQualifier@0..2=><empty>: Remove the unnecessary qualifier.",
          ],
        },
        {
          "caseName": "no-unnecessary-template-expression: number literal interpolation",
          "diagnostics": [
            "no-unnecessary-template-expression/noUnnecessaryTemplateExpression@1..5: Template literal expression is unnecessary and can be simplified.",
          ],
        },
        {
          "caseName": "no-unnecessary-type-arguments: explicit type argument equals the default",
          "diagnostics": [
            "no-unnecessary-type-arguments/unnecessaryTypeParameter@5..11: This is the default value for this type parameter, so it can be omitted. | suggestions unnecessaryTypeParameter@4..12=><empty>: This is the default value for this type parameter, so it can be omitted.",
          ],
        },
        {
          "caseName": "no-unnecessary-type-assertion: assertion does not change the type",
          "diagnostics": [
            "no-unnecessary-type-assertion/unnecessaryAssertion@0..15: This assertion is unnecessary since it does not change the type of the expression. | suggestions unnecessaryAssertion@0..15=><empty>: This assertion is unnecessary since it does not change the type of the expression.",
          ],
        },
        {
          "caseName": "no-unnecessary-type-conversion: String called on a string value",
          "diagnostics": [
            "no-unnecessary-type-conversion/unnecessaryTypeConversion@0..6: This type conversion does not change the type or value of the expression. | suggestions suggestRemove@0..13=>value: Remove the type conversion. | suggestSatisfies@0..13=>value satisfies string: Instead, assert that the value satisfies the primitive type.",
          ],
        },
        {
          "caseName": "no-unnecessary-type-parameters: type parameter used only once",
          "diagnostics": [
            "no-unnecessary-type-parameters/sole@1..2: Type parameter is used only once in the signature. | suggestions replaceUsagesWithConstraint@1..2=><empty>: Replace all usages of type parameter with its constraint.",
          ],
        },
        {
          "caseName": "no-unsafe-argument: any argument passed to a string parameter",
          "diagnostics": [
            "no-unsafe-argument/unsafeArgument@5..10: Unsafe argument of an any typed value assigned to a non-any parameter.",
          ],
        },
        {
          "caseName": "no-unsafe-assignment: any initializer assigned to a string variable",
          "diagnostics": [
            "no-unsafe-assignment/unsafe@0..22: Unsafe assignment of an any-typed value.",
          ],
        },
        {
          "caseName": "no-unsafe-enum-comparison: enum value compared to number",
          "diagnostics": [
            "no-unsafe-enum-comparison/mismatchedCondition@0..15: The two values in this comparison do not have a shared enum type.",
          ],
        },
        {
          "caseName": "no-useless-default-assignment: default parameter on non-nullish target",
          "diagnostics": [
            "no-useless-default-assignment/uselessDefaultAssignment@8..16: Default value is useless because the value is not nullish. This default assignment will never be used. | suggestions uselessDefaultAssignment@5..16=><empty>: Remove the default assignment",
          ],
        },
        {
          "caseName": "non-nullable-type-assertion-style: nullable value asserted as non-nullable",
          "diagnostics": [
            "non-nullable-type-assertion-style/preferNonNullAssertion@0..15: Use a ! assertion to more succinctly remove null and undefined from the type. | suggestions preferNonNullAssertion@5..15=><empty>,5..5=>!: Use a ! assertion to more succinctly remove null and undefined from the type.",
          ],
        },
        {
          "caseName": "prefer-nullish-coalescing: nullable value with logical or fallback",
          "diagnostics": [
            "prefer-nullish-coalescing/preferNullishOverOr@0..18: Prefer using nullish coalescing operator (\`??\`) instead of a logical or (\`||\`), as it is a safer operator.",
          ],
        },
        {
          "caseName": "prefer-optional-chain: and-chain member access",
          "diagnostics": [
            "prefer-optional-chain/preferOptionalChain@0..15: Prefer using an optional chain expression instead, as it's more concise and easier to read.",
          ],
        },
        {
          "caseName": "prefer-readonly: private member is never reassigned",
          "diagnostics": [
            "prefer-readonly/preferReadonly@0..13: Member is never reassigned; mark it as \`readonly\`.",
          ],
        },
        {
          "caseName": "prefer-readonly-parameter-types: mutable typed parameter",
          "diagnostics": [
            "prefer-readonly-parameter-types/shouldBeReadonly@9..25: Parameter should be a readonly type.",
          ],
        },
        {
          "caseName": "prefer-return-this-type: method returns this while annotated with class type",
          "diagnostics": [
            "prefer-return-this-type/useThisType@15..21: Use \`this\` type instead. | suggestions useThisType@15..21=>this: Use \`this\` type instead.",
          ],
        },
        {
          "caseName": "promise-function-async: non-async function returns a promise",
          "diagnostics": [
            "promise-function-async/missingAsync@0..42: Functions that return promises must be async. | suggestions missingAsync@0..0=>async : Functions that return promises must be async.",
          ],
        },
        {
          "caseName": "related-getter-setter-pairs: getter return type is not assignable to setter parameter",
          "diagnostics": [
            "related-getter-setter-pairs/mismatch@25..31: \`get()\` type should be assignable to its equivalent \`set()\` type.",
          ],
        },
        {
          "caseName": "require-await: async function has no await",
          "diagnostics": [
            "require-await/missingAwait@0..30: Function has no 'await' expression.",
          ],
        },
        {
          "caseName": "return-await: async return of promise requires await in try block",
          "diagnostics": [
            "return-await/requiredPromiseAwait@7..23: Returning an awaited promise is required in this context. | suggestions requiredPromiseAwaitSuggestion@7..7=>await (,23..23=>): Add \`await\` before the expression. Use caution as this may impact control flow.",
          ],
        },
        {
          "caseName": "strict-boolean-expressions: nullable string condition",
          "diagnostics": [
            "strict-boolean-expressions/conditionErrorNullableString@4..9: Unexpected nullable string value in conditional. Please handle the nullish and empty string cases explicitly.",
          ],
        },
        {
          "caseName": "strict-void-return: concise arrow returns value in void context",
          "diagnostics": [
            "strict-void-return/nonVoidReturn@13..14: Value returned in a context where a void return is expected.",
          ],
        },
        {
          "caseName": "switch-exhaustiveness-check: union switch misses a branch",
          "diagnostics": [
            "switch-exhaustiveness-check/switchIsNotExhaustive@8..13: Switch is not exhaustive. Cases not matched: {{missingBranches}} | suggestions addMissingCases@28..28=>
      case 'b': { throw new Error('Not implemented yet: \\'b\\' case') }: Add branches for missing cases.",
          ],
        },
        {
          "caseName": "unbound-method: method reference loses this binding",
          "diagnostics": [
            "unbound-method/unboundWithoutThisAnnotation@0..14: Avoid referencing unbound methods which may cause unintentional scoping of \`this\`.",
          ],
        },
      ]
    `);
  });
});

const diagnosticCases = [
  {
    ruleName: "await-thenable",
    scenario: "awaiting a number",
    node: node("AwaitExpression", [0, 12], {
      children: { argument: id("value", [6, 12], ["number"]) },
    }),
  },
  {
    ruleName: "no-array-delete",
    scenario: "deleting from an array-like value",
    node: node("UnaryExpression", [0, 20], {
      fields: { operator: "delete" },
      children: {
        argument: node("MemberExpression", [7, 20], {
          fields: { computed: true },
          children: {
            object: id("values", [7, 13], ["string[]"]),
            property: id("index", [14, 19]),
          },
        }),
      },
    }),
  },
  {
    ruleName: "no-floating-promises",
    scenario: "unhandled Promise.resolve expression",
    node: node("ExpressionStatement", [0, 19], {
      fields: { __nearestFunctionAsync: true },
      children: { expression: promiseCall("resolve", [0, 18]) },
    }),
  },
  {
    ruleName: "no-for-in-array",
    scenario: "for-in over readonly array",
    node: node("ForInStatement", [0, 42], {
      children: { right: id("values", [18, 24], ["readonly string[]"]) },
    }),
  },
  {
    ruleName: "no-implied-eval",
    scenario: "setTimeout with a string-like callback",
    node: call("setTimeout", [0, 23], [id("code", [11, 15], ["string"])]),
  },
  {
    ruleName: "no-meaningless-void-operator",
    scenario: "void around void-like call",
    node: node("UnaryExpression", [0, 13], {
      fields: { operator: "void" },
      children: {
        argument: node("CallExpression", [5, 13], { typeTexts: ["void"] }),
      },
    }),
  },
  {
    ruleName: "no-mixed-enums",
    scenario: "numeric enum member mixed with string-typed initializer",
    node: node("TSEnumDeclaration", [0, 32], {
      childLists: {
        members: [
          node("TSEnumMember", [13, 18], {
            children: { initializer: node("Literal", [17, 18], { fields: { value: 1 } }) },
          }),
          node("TSEnumMember", [20, 31], {
            children: { initializer: id("value", [24, 31], ["string"]) },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "no-unsafe-call",
    scenario: "calling an any-typed callee",
    node: node("CallExpression", [0, 7], {
      children: { callee: id("call", [0, 4], ["any"]) },
      childLists: { arguments: [] },
    }),
  },
  {
    ruleName: "no-unsafe-member-access",
    scenario: "accessing a member through any",
    node: node("MemberExpression", [0, 10], {
      fields: { computed: false, optional: false },
      children: {
        object: id("value", [0, 5], ["any"]),
        property: id("prop", [6, 10]),
      },
    }),
  },
  {
    ruleName: "no-unsafe-unary-minus",
    scenario: "unary minus on string union",
    node: node("UnaryExpression", [0, 6], {
      fields: { operator: "-" },
      children: { argument: id("value", [1, 6], ["string | number"]) },
    }),
  },
  {
    ruleName: "no-unsafe-return",
    scenario: "returning any to string",
    node: node("ReturnStatement", [11, 24], {
      fields: { __returnTypeTexts: ["string"] },
      children: { argument: id("value", [18, 23], ["any"]) },
    }),
  },
  {
    ruleName: "no-unsafe-type-assertion",
    scenario: "narrowing string or number to string",
    node: node("TSAsExpression", [0, 15], {
      fields: { __typeAnnotationText: "string" },
      children: { expression: id("value", [0, 5], ["string | number"]) },
    }),
  },
  {
    ruleName: "only-throw-error",
    scenario: "throwing a string",
    node: node("ThrowStatement", [0, 13], {
      children: { argument: id("message", [6, 13], ["string"]) },
    }),
  },
  {
    ruleName: "prefer-find",
    scenario: "filter result indexed at zero",
    node: node("MemberExpression", [0, 39], {
      fields: { computed: true },
      children: {
        object: call("filter", [0, 35]),
        property: node("Literal", [36, 37], { fields: { value: 0 } }),
      },
    }),
  },
  {
    ruleName: "prefer-includes",
    scenario: "indexOf compared with -1",
    node: node("BinaryExpression", [0, 27], {
      children: {
        left: call("indexOf", [0, 20], [id("value", [14, 19])]),
        right: node("UnaryExpression", [24, 26], {
          fields: { operator: "-" },
          children: { argument: node("Literal", [25, 26], { fields: { value: 1 } }) },
        }),
      },
    }),
  },
  {
    ruleName: "prefer-promise-reject-errors",
    scenario: "rejecting with a string",
    node: promiseCall(
      "reject",
      [0, 23],
      [node("Literal", [15, 21], { fields: { value: "boom" } })],
    ),
  },
  {
    ruleName: "prefer-reduce-type-parameter",
    scenario: "reduce initial value asserted as array",
    node: memberCall(
      id("values", [0, 6], ["number[]"]),
      "reduce",
      [0, 57],
      [
        node("ArrowFunctionExpression", [14, 38]),
        node("TSAsExpression", [42, 56], {
          fields: { __typeAnnotationText: "number[]" },
          children: { expression: node("ArrayExpression", [42, 44]) },
        }),
      ],
    ),
  },
  {
    ruleName: "prefer-regexp-exec",
    scenario: "string match with non-global regexp",
    node: call("match", [0, 15], [node("Literal", [11, 14], { fields: { regex: { flags: "" } } })]),
  },
  {
    ruleName: "prefer-string-starts-ends-with",
    scenario: "indexOf compared with zero",
    node: node("BinaryExpression", [0, 26], {
      fields: { operator: "===" },
      children: {
        left: memberCall(id("text", [0, 4]), "indexOf", [0, 20], [id("prefix", [13, 19])]),
        right: node("Literal", [25, 26], { fields: { value: 0 } }),
      },
    }),
  },
  {
    ruleName: "require-array-sort-compare",
    scenario: "numeric array sort without compare",
    node: memberCall(id("values", [0, 6], ["number[]"]), "sort", [0, 13]),
  },
  {
    ruleName: "restrict-plus-operands",
    scenario: "string plus number with option disabled",
    node: node("BinaryExpression", [0, 12], {
      fields: { operator: "+", __ruleOptions: [{ allowNumberAndString: false }] },
      children: {
        left: id("left", [0, 4], ["string"]),
        right: id("right", [7, 12], ["number"]),
      },
    }),
  },
  {
    ruleName: "restrict-template-expressions",
    scenario: "object in template literal",
    node: node("TemplateLiteral", [0, 32], {
      childLists: {
        expressions: [id("value", [17, 29], ["{ value: number }"])],
      },
    }),
  },
  {
    ruleName: "use-unknown-in-catch-callback-variable",
    scenario: "catch parameter typed as Error",
    node: call(
      "catch",
      [0, 40],
      [
        node("ArrowFunctionExpression", [22, 39], {
          childLists: {
            params: [
              id("error", [23, 35], [], {
                children: {
                  typeAnnotation: node("TSTypeAnnotation", [28, 35], {
                    children: { typeAnnotation: node("TSTypeReference", [30, 35]) },
                  }),
                },
              }),
            ],
          },
        }),
      ],
    ),
  },
  {
    ruleName: "consistent-return",
    scenario: "value return followed by bare return",
    node: node("FunctionDeclaration", [0, 42], {
      children: {
        body: node("BlockStatement", [20, 42], {
          childLists: {
            body: [
              node("ReturnStatement", [22, 31], {
                children: { argument: node("Literal", [29, 30], { fields: { value: 1 } }) },
              }),
              node("ReturnStatement", [34, 41]),
            ],
          },
        }),
      },
    }),
  },
  {
    ruleName: "consistent-type-exports",
    scenario: "named export contains only type-based specifiers",
    node: node("ExportNamedDeclaration", [0, 22], {
      fields: { exportKind: "value" },
      childLists: {
        specifiers: [
          node("ExportSpecifier", [9, 12], {
            fields: { exportKind: "value", __isTypeBasedSymbol: true },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "dot-notation",
    scenario: "computed access can be dot access",
    node: node("MemberExpression", [0, 15], {
      fields: { computed: true },
      children: {
        object: id("record", [0, 6]),
        property: node("Literal", [7, 14], { fields: { value: "value" } }),
      },
    }),
  },
  {
    ruleName: "no-base-to-string",
    scenario: "object stringified by string concatenation",
    node: node("BinaryExpression", [0, 18], {
      fields: { operator: "+" },
      children: {
        left: node("Literal", [0, 2], { fields: { value: "" } }),
        right: node("ObjectExpression", [5, 18]),
      },
    }),
  },
  {
    ruleName: "no-confusing-void-expression",
    scenario: "void call in a variable initializer",
    node: node("CallExpression", [14, 28], {
      fields: {
        __ancestorChain: [{ kind: "VariableDeclarator", start: 0, end: 28 }],
      },
      typeTexts: ["void"],
    }),
  },
  {
    ruleName: "no-deprecated",
    scenario: "deprecated identifier use",
    node: id("oldValue", [0, 8], [], {
      fields: {
        name: "oldValue",
        __deprecated: true,
        __parentKind: "CallExpression",
      },
    }),
  },
  {
    ruleName: "no-duplicate-type-constituents",
    scenario: "duplicate string union constituent",
    node: node("TSUnionType", [0, 15], {
      childLists: {
        types: [node("TSStringKeyword", [0, 6]), node("TSStringKeyword", [9, 15])],
      },
    }),
  },
  {
    ruleName: "no-misused-promises",
    scenario: "promise used as an if condition",
    node: node("IfStatement", [0, 32], {
      children: { test: id("promise", [4, 11], ["Promise<boolean>"]) },
    }),
  },
  {
    ruleName: "no-misused-spread",
    scenario: "string spread into an array",
    node: node("SpreadElement", [1, 8], {
      fields: { __parentKind: "ArrayExpression" },
      children: { argument: id("text", [4, 8], ["string"]) },
    }),
  },
  {
    ruleName: "no-redundant-type-constituents",
    scenario: "string literal overridden by string primitive",
    node: node("TSUnionType", [0, 12], {
      childLists: {
        types: [
          node("TSStringKeyword", [0, 6]),
          node("TSLiteralType", [9, 12], {
            children: { literal: node("Literal", [10, 11], { fields: { value: "a" } }) },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "no-unnecessary-boolean-literal-compare",
    scenario: "boolean compared to true",
    node: node("BinaryExpression", [0, 13], {
      fields: { operator: "===" },
      children: {
        left: id("flag", [0, 4], ["boolean"]),
        right: node("Literal", [9, 13], { fields: { value: true } }),
      },
    }),
  },
  {
    ruleName: "no-unnecessary-condition",
    scenario: "always truthy string literal condition",
    node: node("IfStatement", [0, 18], {
      children: { test: id("value", [4, 9], ['"value"']) },
    }),
  },
  {
    ruleName: "no-unnecessary-qualifier",
    scenario: "namespace qualifier is already in scope",
    node: node("TSQualifiedName", [0, 3], {
      fields: {
        __qualifierNamespaceInScope: true,
        __accessedNameAlreadyInScope: true,
      },
      children: {
        left: id("A", [0, 1]),
        right: id("B", [2, 3]),
      },
    }),
  },
  {
    ruleName: "no-unnecessary-template-expression",
    scenario: "number literal interpolation",
    node: node("TemplateLiteral", [0, 6], {
      childLists: {
        quasis: [
          node("TemplateElement", [0, 2], { fields: { value: { raw: "", cooked: "" } } }),
          node("TemplateElement", [5, 6], { fields: { value: { raw: "", cooked: "" } } }),
        ],
        expressions: [node("Literal", [3, 4], { fields: { value: 1 } })],
      },
    }),
  },
  {
    ruleName: "no-unnecessary-type-arguments",
    scenario: "explicit type argument equals the default",
    node: node("CallExpression", [0, 18], {
      fields: {
        __typeArgumentRanges: [{ start: 5, end: 11 }],
        __typeArgumentListRange: { start: 4, end: 12 },
        __typeParameterCount: 1,
        __lastTypeParameterHasDefault: true,
        __lastTypeArgumentEqualsDefault: true,
      },
    }),
  },
  {
    ruleName: "no-unnecessary-type-assertion",
    scenario: "assertion does not change the type",
    node: node("TSAsExpression", [0, 15], {
      fields: {
        __typeAnnotationText: "string",
        __typeIsUnchanged: true,
      },
      children: {
        expression: id("value", [0, 5], ["string"]),
        typeAnnotation: node("TSStringKeyword", [9, 15]),
      },
    }),
  },
  {
    ruleName: "no-unnecessary-type-conversion",
    scenario: "String called on a string value",
    node: node("CallExpression", [0, 13], {
      children: {
        callee: id("String", [0, 6]),
      },
      childLists: {
        arguments: [id("value", [7, 12], ["string"])],
      },
    }),
  },
  {
    ruleName: "no-unnecessary-type-parameters",
    scenario: "type parameter used only once",
    node: node("TSTypeParameterDeclaration", [0, 11], {
      childLists: {
        params: [
          node("TSTypeParameter", [1, 2], {
            fields: {
              __typeParameterName: "T",
              __typeParameterUsageCount: 1,
            },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "no-unsafe-argument",
    scenario: "any argument passed to a string parameter",
    node: node("CallExpression", [0, 11], {
      fields: { __expectedArgumentTypeTexts: [["string"]] },
      children: { callee: id("take", [0, 4], ["(value: string) => void"]) },
      childLists: { arguments: [id("value", [5, 10], ["any"])] },
    }),
  },
  {
    ruleName: "no-unsafe-assignment",
    scenario: "any initializer assigned to a string variable",
    node: node("VariableDeclarator", [0, 22], {
      children: {
        id: id("value", [6, 11], ["string"], {
          children: { typeAnnotation: node("TSTypeAnnotation", [11, 19]) },
        }),
        init: id("source", [20, 22], ["any"]),
      },
    }),
  },
  {
    ruleName: "no-unsafe-enum-comparison",
    scenario: "enum value compared to number",
    node: node("BinaryExpression", [0, 15], {
      fields: { operator: "===" },
      children: {
        left: id("Color.Red", [0, 9], [], {
          fields: {
            __enumTypeIds: ["Color"],
            __unionPartEnumValueKinds: ["number"],
          },
        }),
        right: node("Literal", [14, 15], {
          fields: { value: 1, __isNumberLike: true },
        }),
      },
    }),
  },
  {
    ruleName: "no-useless-default-assignment",
    scenario: "default parameter on non-nullish target",
    node: node("AssignmentPattern", [0, 16], {
      fields: {
        __parentKind: "FunctionDeclaration",
        __targetTypeTexts: ["string"],
      },
      children: {
        left: id("value", [0, 5]),
        right: node("Literal", [8, 16], { fields: { value: "fallback" } }),
      },
    }),
  },
  {
    ruleName: "non-nullable-type-assertion-style",
    scenario: "nullable value asserted as non-nullable",
    node: node("TSAsExpression", [0, 15], {
      fields: {
        __expressionUnionTypeTexts: ["string", "undefined"],
        __assertedUnionTypeTexts: ["string"],
        __higherPrecedenceThanUnary: true,
      },
      children: { expression: id("value", [0, 5], ["string | undefined"]) },
    }),
  },
  {
    ruleName: "prefer-nullish-coalescing",
    scenario: "nullable value with logical or fallback",
    node: node("LogicalExpression", [0, 18], {
      fields: { operator: "||" },
      children: {
        left: id("value", [0, 5], ["string | undefined"]),
        right: node("Literal", [9, 18], { fields: { value: "fallback" } }),
      },
    }),
  },
  {
    ruleName: "prefer-optional-chain",
    scenario: "and-chain member access",
    node: node("LogicalExpression", [0, 15], {
      fields: { operator: "&&" },
      children: {
        left: id("foo", [0, 3]),
        right: node("MemberExpression", [7, 14], {
          fields: { computed: false, optional: false },
          children: {
            object: id("foo", [7, 10]),
            property: id("bar", [11, 14]),
          },
        }),
      },
    }),
  },
  {
    ruleName: "prefer-readonly",
    scenario: "private member is never reassigned",
    node: node("PropertyDefinition", [0, 18], {
      fields: { accessibility: "private", computed: false },
      children: { key: id("value", [8, 13]) },
    }),
  },
  {
    ruleName: "prefer-readonly-parameter-types",
    scenario: "mutable typed parameter",
    node: node("FunctionDeclaration", [0, 36], {
      childLists: {
        params: [
          id("values", [9, 25], ["string[]"], {
            children: { typeAnnotation: node("TSTypeAnnotation", [15, 25]) },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "prefer-return-this-type",
    scenario: "method returns this while annotated with class type",
    node: node("FunctionExpression", [0, 40], {
      fields: { __nearestClassName: "Fluent" },
      children: {
        returnType: node("TSTypeAnnotation", [13, 21], {
          children: {
            typeAnnotation: node("TSTypeReference", [15, 21], {
              children: { typeName: id("Fluent", [15, 21]) },
            }),
          },
        }),
        body: node("BlockStatement", [22, 40], {
          childLists: {
            body: [
              node("ReturnStatement", [25, 37], {
                children: { argument: node("ThisExpression", [32, 36]) },
              }),
            ],
          },
        }),
      },
    }),
  },
  {
    ruleName: "promise-function-async",
    scenario: "non-async function returns a promise",
    node: node("FunctionDeclaration", [0, 42], {
      fields: { __signatureReturnTypeTexts: [["Promise<string>"]] },
      children: { body: node("BlockStatement", [31, 42]) },
    }),
  },
  {
    ruleName: "related-getter-setter-pairs",
    scenario: "getter return type is not assignable to setter parameter",
    node: node("ClassDeclaration", [0, 80], {
      children: {
        body: node("ClassBody", [10, 80], {
          childLists: {
            body: [
              node("MethodDefinition", [12, 35], {
                fields: { kind: "get", __getterTypeAssignableToSetter: false },
                children: {
                  key: id("value", [16, 21]),
                  value: node("FunctionExpression", [21, 35], {
                    children: {
                      returnType: node("TSTypeAnnotation", [23, 31], {
                        children: {
                          typeAnnotation: node("TSStringKeyword", [25, 31], {
                            typeTexts: ["string"],
                          }),
                        },
                      }),
                    },
                  }),
                },
              }),
              node("MethodDefinition", [37, 70], {
                fields: { kind: "set" },
                children: {
                  key: id("value", [41, 46]),
                  value: node("FunctionExpression", [46, 70], {
                    childLists: {
                      params: [id("next", [51, 63], ["number"])],
                    },
                  }),
                },
              }),
            ],
          },
        }),
      },
    }),
  },
  {
    ruleName: "require-await",
    scenario: "async function has no await",
    node: node("FunctionDeclaration", [0, 30], {
      fields: { async: true },
      children: {
        body: node("BlockStatement", [20, 30], {
          childLists: {
            body: [
              node("ReturnStatement", [22, 28], {
                children: { argument: node("Literal", [29, 30], { fields: { value: 1 } }) },
              }),
            ],
          },
        }),
      },
    }),
  },
  {
    ruleName: "return-await",
    scenario: "async return of promise requires await in try block",
    node: node("ReturnStatement", [0, 23], {
      fields: { __inAsyncScope: true, __returnAwaitRequiresAwait: true },
      children: {
        argument: promiseCall("resolve", [7, 23]),
      },
    }),
  },
  {
    ruleName: "strict-boolean-expressions",
    scenario: "nullable string condition",
    node: node("IfStatement", [0, 18], {
      children: { test: id("value", [4, 9], ["string | undefined"]) },
    }),
  },
  {
    ruleName: "strict-void-return",
    scenario: "concise arrow returns value in void context",
    node: node("CallExpression", [0, 20], {
      childLists: {
        arguments: [
          node("ArrowFunctionExpression", [4, 18], {
            fields: {
              __voidReturnExpected: true,
              __functionApparentReturnTypeTexts: ["number"],
            },
            children: {
              body: node("Literal", [13, 14], { fields: { value: 1 }, typeTexts: ["number"] }),
            },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "switch-exhaustiveness-check",
    scenario: "union switch misses a branch",
    node: node("SwitchStatement", [0, 40], {
      fields: {
        __missingBranchTexts: ["'b'"],
        __missingBranchCaseTests: ["'b'"],
      },
      children: { discriminant: id("value", [8, 13]) },
      childLists: {
        cases: [
          node("SwitchCase", [16, 28], {
            children: { test: node("Literal", [21, 24], { fields: { value: "a" } }) },
          }),
        ],
      },
    }),
  },
  {
    ruleName: "unbound-method",
    scenario: "method reference loses this binding",
    node: node("MemberExpression", [0, 14], {
      fields: {
        computed: false,
        __safeUse: false,
        __unboundMethodInfo: {
          isMethod: true,
          firstParamIsThis: false,
          thisArgIsVoid: false,
          isStatic: false,
        },
      },
      children: {
        object: id("instance", [0, 8]),
        property: id("method", [9, 15]),
      },
    }),
  },
];

function call(name: string, range: [number, number], args: NativeLintNode[] = []): NativeLintNode {
  return node("CallExpression", range, {
    children: {
      callee: node("MemberExpression", [0, name.length], {
        children: { property: id(name, [0, name.length]) },
      }),
    },
    childLists: { arguments: args },
  });
}

function memberCall(
  object: NativeLintNode,
  name: string,
  range: [number, number],
  args: NativeLintNode[] = [],
): NativeLintNode {
  return node("CallExpression", range, {
    children: {
      callee: node("MemberExpression", [object.range.start, object.range.end + name.length + 1], {
        children: {
          object,
          property: id(name, [object.range.end + 1, object.range.end + name.length + 1]),
        },
      }),
    },
    childLists: { arguments: args },
  });
}

function promiseCall(
  name: string,
  range: [number, number],
  args: NativeLintNode[] = [],
): NativeLintNode {
  return memberCall(id("Promise", [0, 7]), name, range, args);
}

function id(
  name: string,
  range: [number, number],
  typeTexts: string[] = [],
  rest: IdRest = {},
): NativeLintNode {
  return node("Identifier", range, { text: name, typeTexts, fields: { name }, ...rest });
}

function node(kind: string, range: [number, number], rest: NodeRest = {}): NativeLintNode {
  return { kind, range: { start: range[0], end: range[1] }, ...rest };
}

function summarizeDiagnostic(diagnostic: NativeLintDiagnostic) {
  const message = `${diagnostic.ruleName}/${diagnostic.messageId}@${formatRange(diagnostic.range)}: ${diagnostic.message}`;
  const suggestionText = diagnostic.suggestions?.map(summarizeSuggestion).join(" | ");
  return suggestionText ? `${message} | suggestions ${suggestionText}` : message;
}

function summarizeSuggestion({ messageId, message, fixes }: Suggestion) {
  const fixText = fixes
    .map(({ range, replacementText }) => `${formatRange(range)}=>${replacementText || "<empty>"}`)
    .join(",");
  return `${messageId}@${fixText}: ${message}`;
}

function formatRange(range: { start: number; end: number }) {
  return `${range.start}..${range.end}`;
}
