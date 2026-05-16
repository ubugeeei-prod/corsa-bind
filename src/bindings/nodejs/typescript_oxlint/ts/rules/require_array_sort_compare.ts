import { memberObject, memberPropertyName } from "./ast";
import { createNativeRule } from "./rule_creator";
import { isArrayLikeNode, typeTextsAtNode } from "./type_utils";
import { isStringArrayLikeTypeTexts } from "../utils";

type Options = {
  ignoreStringArrays?: boolean;
};

const defaults: Required<Options> = {
  ignoreStringArrays: true,
};

export const requireArraySortCompareRule = createNativeRule(
  "require-array-sort-compare",
  {
    docs: {
      description: "Require compare callbacks for array sorting calls.",
    },
    messages: {
      requireCompare: "Require a compare argument for array sorting.",
    },
    schema: { type: "array" },
  },
  (context) => ({
    CallExpression(node: any) {
      if (node.arguments.length !== 0) {
        return;
      }
      const methodName = memberPropertyName(node.callee);
      if (methodName !== "sort" && methodName !== "toSorted") {
        return;
      }
      const object = memberObject(node.callee) as any;
      if (!object || !isArrayLikeNode(context, object)) {
        return;
      }
      if (
        resolveOptions(context.options).ignoreStringArrays &&
        isStringArrayLike(context, object)
      ) {
        return;
      }
      context.report({ node, messageId: "requireCompare" });
    },
  }),
);

function isStringArrayLike(context: any, node: any): boolean {
  return isStringArrayLikeTypeTexts(typeTextsAtNode(context, node));
}

function resolveOptions(options: readonly unknown[]): Required<Options> {
  return { ...defaults, ...(options[0] as Options | undefined) };
}
