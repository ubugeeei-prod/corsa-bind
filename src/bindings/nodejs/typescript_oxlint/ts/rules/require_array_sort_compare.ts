import { createRustNativeRule } from "./native_bridge";

export const requireArraySortCompareRule = createRustNativeRule("require-array-sort-compare", {
  schema: { type: "array" },
});
