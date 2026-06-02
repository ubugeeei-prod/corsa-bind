import { createRustNativeRule } from "./native_bridge";

export const noArrayDeleteRule = createRustNativeRule(
  "no-array-delete",
  {},
  { shouldRun: shouldRunNoArrayDelete },
);

function shouldRunNoArrayDelete(node: any): boolean {
  return node.type !== "UnaryExpression" || node.operator === "delete";
}
