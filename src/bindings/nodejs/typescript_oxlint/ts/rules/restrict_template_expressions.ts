import { createRustNativeRule } from "./native_bridge";

export const restrictTemplateExpressionsRule = createRustNativeRule(
  "restrict-template-expressions",
);
