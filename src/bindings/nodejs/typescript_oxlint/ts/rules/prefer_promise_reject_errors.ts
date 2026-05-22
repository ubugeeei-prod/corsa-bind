import { createRustNativeRule } from "./native_bridge";

export const preferPromiseRejectErrorsRule = createRustNativeRule("prefer-promise-reject-errors", {
  schema: { type: "array" },
});
