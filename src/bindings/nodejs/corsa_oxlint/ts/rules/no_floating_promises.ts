import { stripChainExpression } from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const noFloatingPromisesRule = createRustNativeRule(
  "no-floating-promises",
  {},
  { shouldRun: shouldRunNoFloatingPromises },
);

function shouldRunNoFloatingPromises(node: any): boolean {
  const expression = stripChainExpression(node.expression);
  return !(expression?.type === "UnaryExpression" && expression.operator === "void");
}
