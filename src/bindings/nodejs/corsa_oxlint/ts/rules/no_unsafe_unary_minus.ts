import { createRustNativeRule } from "./native_bridge";

export const noUnsafeUnaryMinusRule = createRustNativeRule(
  "no-unsafe-unary-minus",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
    shouldRun: shouldRunNoUnsafeUnaryMinus,
  },
);

function shouldRunNoUnsafeUnaryMinus(node: any): boolean {
  return node.type !== "UnaryExpression" || node.operator === "-";
}
