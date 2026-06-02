import { createRustNativeRule } from "./native_bridge";

export const onlyThrowErrorRule = createRustNativeRule(
  "only-throw-error",
  {},
  { shouldRun: shouldRunOnlyThrowError },
);

function shouldRunOnlyThrowError(node: any): boolean {
  return node.type !== "ThrowStatement" || Boolean(node.argument);
}
