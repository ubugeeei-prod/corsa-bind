import { stripChainExpression } from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const noFloatingPromisesRule = createRustNativeRule(
  "no-floating-promises",
  {},
  {
    includePropertyNames: includeFloatingPromiseTypeMetadata,
    includeTypeTexts: includeFloatingPromiseTypeMetadata,
    shouldRun: shouldRunNoFloatingPromises,
  },
);

function includeFloatingPromiseTypeMetadata(_node: any, depth: number): boolean {
  return depth === 1 || depth === 2;
}

function shouldRunNoFloatingPromises(node: any): boolean {
  const expression = stripChainExpression(node.expression);
  return !(expression?.type === "UnaryExpression" && expression.operator === "void");
}
