import { createRustNativeRule } from "./native_bridge";

export const preferStringStartsEndsWithRule = createRustNativeRule(
  "prefer-string-starts-ends-with",
);
