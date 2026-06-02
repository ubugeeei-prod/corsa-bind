import { createRustNativeRule } from "./native_bridge";

export const noUnsafeCallRule = createRustNativeRule(
  "no-unsafe-call",
  {},
  { shouldRun: shouldRunNoUnsafeCall },
);

function shouldRunNoUnsafeCall(node: any): boolean {
  if (node.type === "CallExpression") {
    return node.callee?.type !== "Import";
  }
  return true;
}
