import { createRustNativeRule } from "./native_bridge";

export const noMeaninglessVoidOperatorRule = createRustNativeRule(
  "no-meaningless-void-operator",
  {
    hasSuggestions: true,
    schema: { type: "array" },
  },
  { shouldRun: shouldRunNoMeaninglessVoidOperator },
);

function shouldRunNoMeaninglessVoidOperator(node: any): boolean {
  return node.type === "UnaryExpression" && node.operator === "void";
}
