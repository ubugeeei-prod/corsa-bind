import { createRustNativeRule } from "./native_bridge";

export const restrictPlusOperandsRule = createRustNativeRule(
  "restrict-plus-operands",
  {
    schema: { type: "array" },
  },
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 1,
    shouldRun: shouldRunRestrictPlusOperands,
  },
);

function shouldRunRestrictPlusOperands(node: any): boolean {
  switch (node.type) {
    case "AssignmentExpression":
      return node.operator === "+=";
    case "BinaryExpression":
      return node.operator === "+";
    default:
      return true;
  }
}
