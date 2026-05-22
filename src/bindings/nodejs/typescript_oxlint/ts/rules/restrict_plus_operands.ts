import { createRustNativeRule } from "./native_bridge";

export const restrictPlusOperandsRule = createRustNativeRule("restrict-plus-operands", {
  schema: { type: "array" },
});
