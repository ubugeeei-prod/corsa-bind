import { calleePropertyName } from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const preferReduceTypeParameterRule = createRustNativeRule(
  "prefer-reduce-type-parameter",
  {
    hasSuggestions: true,
    schema: { type: "array" },
  },
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 2,
    maxDepth: 3,
    shouldRun: shouldRunPreferReduceTypeParameter,
  },
);

function shouldRunPreferReduceTypeParameter(node: any): boolean {
  const initialValue = node.arguments?.[1];
  return (
    calleePropertyName(node) === "reduce" &&
    (initialValue?.type === "TSAsExpression" || initialValue?.type === "TSTypeAssertion")
  );
}
