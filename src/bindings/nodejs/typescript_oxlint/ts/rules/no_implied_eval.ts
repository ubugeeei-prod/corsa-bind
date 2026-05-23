import {
  calleePropertyName,
  isIdentifierNamed,
  memberPropertyName,
  stripChainExpression,
} from "./ast";
import { createRustNativeRule } from "./native_bridge";

export const noImpliedEvalRule = createRustNativeRule(
  "no-implied-eval",
  {},
  {
    includePropertyNames: false,
    includeTypeTexts: (_node, depth) => depth === 1,
    maxDepth: 2,
    shouldRun: shouldRunNoImpliedEval,
  },
);

function shouldRunNoImpliedEval(node: any): boolean {
  switch (node.type) {
    case "CallExpression":
      return (
        node.arguments?.length > 0 &&
        ["execScript", "setInterval", "setTimeout"].includes(calleeName(node) ?? "")
      );
    case "NewExpression":
      return node.arguments?.length > 0 && isIdentifierNamed(node.callee, "Function");
    default:
      return true;
  }
}

function calleeName(node: any): string | undefined {
  const callee = stripChainExpression(node.callee) as any;
  if (callee?.type === "Identifier") {
    return callee.name;
  }
  return calleePropertyName(node) ?? memberPropertyName(callee);
}
