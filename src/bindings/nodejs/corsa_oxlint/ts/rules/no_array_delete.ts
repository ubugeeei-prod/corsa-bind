import { createRustNativeRule } from "./native_bridge";

export const noArrayDeleteRule = createRustNativeRule(
  "no-array-delete",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 2,
    maxDepth: 2,
    shouldRun: shouldRunNoArrayDelete,
  },
);

function shouldRunNoArrayDelete(node: any): boolean {
  return node.type !== "UnaryExpression" || node.operator === "delete";
}
