import { createRustNativeRule } from "./native_bridge";

export const noForInArrayRule = createRustNativeRule(
  "no-for-in-array",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
  },
);
