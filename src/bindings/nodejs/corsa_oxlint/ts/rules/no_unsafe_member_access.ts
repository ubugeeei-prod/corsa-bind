import { createRustNativeRule } from "./native_bridge";

export const noUnsafeMemberAccessRule = createRustNativeRule(
  "no-unsafe-member-access",
  {
    schema: { type: "array" },
  },
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
    shouldRun: shouldRunNoUnsafeMemberAccess,
  },
);

function shouldRunNoUnsafeMemberAccess(node: any): boolean {
  return node.type === "MemberExpression" && Boolean(node.object);
}
