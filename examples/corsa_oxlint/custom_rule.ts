import { OxlintUtils } from "corsa-oxlint";

const createRule = OxlintUtils.RuleCreator(
  (name) => `https://github.com/ubugeeei/corsa-bind/tree/main/examples/corsa_oxlint/${name}.ts`,
);

export const noStringPlusNumberRule = createRule({
  name: "no-string-plus-number",
  meta: {
    type: "problem",
    docs: {
      description: "Forbid string + number combinations in application code.",
      requiresTypeChecking: true,
    },
    messages: {
      unexpected: "string + number is forbidden; convert explicitly instead.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context: any) {
    const services = OxlintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      BinaryExpression(node: any) {
        if (node.operator !== "+") {
          return;
        }

        const left = checker.getTypeAtLocation(node.left);
        const right = checker.getTypeAtLocation(node.right);
        if (!left || !right) {
          return;
        }

        const leftText = checker.typeToString(checker.getBaseTypeOfLiteralType(left) ?? left);
        const rightText = checker.typeToString(checker.getBaseTypeOfLiteralType(right) ?? right);
        if (leftText === "string" && rightText === "number") {
          context.report({ node, messageId: "unexpected" });
        }
      },
    };
  },
});

export default noStringPlusNumberRule;
