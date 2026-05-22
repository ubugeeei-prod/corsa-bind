import { describe, expect, it } from "vitest";

import { runNativeLintRule } from "@corsa-bind/napi";
import type { NativeLintDiagnostic, NativeLintNode } from "@corsa-bind/napi";

type IdRest = Omit<NativeLintNode, "kind" | "range" | "text" | "typeTexts">;
type NodeRest = Omit<NativeLintNode, "kind" | "range">;
type Suggestion = NonNullable<NativeLintDiagnostic["suggestions"]>[number];

describe("native diagnostic snapshots", () => {
  it("reports the native rule cases that should be errors", () => {
    const snapshots = diagnosticCases.map(({ ruleName, scenario, node }) => ({
      caseName: `${ruleName}: ${scenario}`,
      diagnostics: runNativeLintRule(ruleName, node).map(summarizeDiagnostic),
    }));

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
          "caseName": "no-mixed-enums: numeric enum member mixed with string-typed initializer",
          "diagnostics": [
            "no-mixed-enums/mixed@24..31: Mixing number and string enums can be confusing.",
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
          "caseName": "use-unknown-in-catch-callback-variable: catch parameter typed as Error",
          "diagnostics": [
            "use-unknown-in-catch-callback-variable/unexpected@23..35: Catch callback variables should be explicitly typed as unknown.",
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
