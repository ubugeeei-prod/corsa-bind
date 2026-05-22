import { createRustNativeRule } from "./native_bridge";

export const noUnsafeTypeAssertionRule = createRustNativeRule(
  "no-unsafe-type-assertion",
  {
    schema: { type: "array" },
  },
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
    shouldRun: shouldRunNoUnsafeTypeAssertion,
  },
);

function shouldRunNoUnsafeTypeAssertion(node: any): boolean {
  return node.type === "TSAsExpression" || node.type === "TSTypeAssertion";
}
