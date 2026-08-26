import { stripChainExpression } from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const noFloatingPromisesRule = createRustNativeRule(
  "no-floating-promises",
  {},
  { shouldRun: shouldRunNoFloatingPromises },
);

function shouldRunNoFloatingPromises(node: any, context: unknown): boolean {
  const expression = stripChainExpression(node.expression);
  if (expression?.type !== "UnaryExpression" || expression.operator !== "void") {
    return true;
  }
  // `void promise;` is only a finding under `ignoreVoid: false`; skipping the
  // native call otherwise keeps the default path free of type queries.
  const options = (context as { options?: readonly unknown[] }).options?.[0];
  return typeof options === "object" && options !== null
    ? (options as { ignoreVoid?: boolean }).ignoreVoid === false
    : false;
}
