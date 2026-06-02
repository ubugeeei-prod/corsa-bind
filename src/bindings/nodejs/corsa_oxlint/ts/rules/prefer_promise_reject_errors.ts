import { isIdentifierNamed, memberPropertyName, stripChainExpression } from "./ast";
import { createRustNativeRule } from "./native_bridge";
import type { ContextWithParserOptions } from "../types";

export const preferPromiseRejectErrorsRule = createRustNativeRule(
  "prefer-promise-reject-errors",
  {
    schema: { type: "array" },
  },
  { shouldRun: shouldRunPreferPromiseRejectErrors },
);

function shouldRunPreferPromiseRejectErrors(node: any, context: ContextWithParserOptions): boolean {
  const callee = stripChainExpression(node.callee) as any;
  if (memberPropertyName(callee) === "reject") {
    return true;
  }
  return (
    callee?.type === "Identifier" && isPromiseExecutorRejectCandidate(context, node, callee.name)
  );
}

function isPromiseExecutorRejectCandidate(
  context: ContextWithParserOptions,
  node: any,
  name: string,
): boolean {
  const nearestFunction = ((context.sourceCode as any)?.getAncestors?.(node) ?? [])
    .toReversed()
    .find((ancestor: any) => ancestor.type?.includes("Function"));
  const rejectParam = nearestFunction?.params?.[1];
  if (!rejectParam || rejectParam.type !== "Identifier" || rejectParam.name !== name) {
    return false;
  }
  const promiseConstructor = stripChainExpression(nearestFunction.parent?.parent) as any;
  const owner =
    nearestFunction.parent?.type === "NewExpression" ? nearestFunction.parent : promiseConstructor;
  return owner?.type === "NewExpression" && isIdentifierNamed(owner.callee, "Promise");
}
