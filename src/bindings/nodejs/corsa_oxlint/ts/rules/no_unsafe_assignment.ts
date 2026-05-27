import { createRustNativeRule } from "./native_bridge";

export const noUnsafeAssignmentRule = createRustNativeRule(
  "no-unsafe-assignment",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 2,
    shouldRun: shouldRunNoUnsafeAssignment,
  },
);

function shouldRunNoUnsafeAssignment(node: any): boolean {
  switch (node.type) {
    case "AssignmentExpression":
      return node.operator === "=" && Boolean(node.right);
    case "PropertyDefinition":
      return Boolean(node.value);
    case "VariableDeclarator":
      return Boolean(node.init);
    default:
      return true;
  }
}
