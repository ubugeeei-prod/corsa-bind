import { createRustNativeRule } from "./native_bridge";

export const onlyThrowErrorRule = createRustNativeRule(
  "only-throw-error",
  {},
  {
    includePropertyNames: includeThrowTypeMetadata,
    includeTypeTexts: includeThrowTypeMetadata,
    maxDepth: 2,
    shouldRun: shouldRunOnlyThrowError,
  },
);

function includeThrowTypeMetadata(_node: any, depth: number): boolean {
  return depth === 1 || depth === 2;
}

function shouldRunOnlyThrowError(node: any): boolean {
  return node.type !== "ThrowStatement" || Boolean(node.argument);
}
