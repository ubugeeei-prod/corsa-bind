import { isIdentifierNamed, memberPropertyName } from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const noBaseToStringRule = createRustNativeRule(
  "no-base-to-string",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1 || depth === 2,
    maxDepth: 2,
    shouldRun: shouldRunNoBaseToString,
  },
);

function shouldRunNoBaseToString(node: any): boolean {
  switch (node.type) {
    case "BinaryExpression":
      return node.operator === "+";
    case "CallExpression":
      if (!node.arguments?.[0]) {
        return false;
      }
      return (
        isIdentifierNamed(node.callee, "String") || memberPropertyName(node.callee) === "toString"
      );
    case "TemplateLiteral":
      return true;
    default:
      return true;
  }
}
