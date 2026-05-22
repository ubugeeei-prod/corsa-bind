import { calleePropertyName } from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const requireArraySortCompareRule = createRustNativeRule(
  "require-array-sort-compare",
  {
    schema: { type: "array" },
  },
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 2,
    maxDepth: 2,
    shouldRun: shouldRunRequireArraySortCompare,
  },
);

function shouldRunRequireArraySortCompare(node: any): boolean {
  return (
    node.arguments?.length === 0 &&
    ["sort", "toSorted"].includes(calleePropertyName(node) ?? "")
  );
}
