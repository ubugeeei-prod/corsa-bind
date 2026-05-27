import { createRustNativeRule } from "./native_bridge";

export const awaitThenableRule = createRustNativeRule(
  "await-thenable",
  {},
  {
    includePropertyNames: includeAwaitTypeMetadata,
    includeTypeTexts: includeAwaitTypeMetadata,
    maxDepth: 3,
  },
);

function includeAwaitTypeMetadata(_node: any, depth: number): boolean {
  return depth === 1 || depth === 2;
}
