import { createRustNativeRule } from "./native_bridge";

export const noUnsafeReturnRule = createRustNativeRule(
  "no-unsafe-return",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
    shouldRun: shouldRunNoUnsafeReturn,
  },
);

function shouldRunNoUnsafeReturn(node: any): boolean {
  switch (node.type) {
    case "ArrowFunctionExpression":
      return Boolean(node.body) && node.body.type !== "BlockStatement";
    case "ReturnStatement":
      return Boolean(node.argument);
    default:
      return true;
  }
}
