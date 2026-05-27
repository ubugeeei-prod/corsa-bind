import { createRustNativeRule } from "./native_bridge";

export const noMeaninglessVoidOperatorRule = createRustNativeRule(
  "no-meaningless-void-operator",
  {
    hasSuggestions: true,
    schema: { type: "array" },
  },
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
    shouldRun: shouldRunNoMeaninglessVoidOperator,
  },
);

function shouldRunNoMeaninglessVoidOperator(node: any): boolean {
  return node.type === "UnaryExpression" && node.operator === "void";
}
