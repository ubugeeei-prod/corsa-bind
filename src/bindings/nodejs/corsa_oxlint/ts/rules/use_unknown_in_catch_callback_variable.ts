import { createRustNativeRule } from "./native_bridge";

export const useUnknownInCatchCallbackVariableRule = createRustNativeRule(
  "use-unknown-in-catch-callback-variable",
);
