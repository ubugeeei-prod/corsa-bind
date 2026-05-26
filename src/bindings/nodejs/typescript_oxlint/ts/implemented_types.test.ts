import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultTsgoExecutable } from "./context";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realTsgoBinary = defaultTsgoExecutable(workspaceRoot);
const integrationCase = existsSync(realTsgoBinary) ? it : it.skip;

describe("corsa oxlint implemented types", () => {
  integrationCase("exposes class implements clause types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "implemented-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise class implements type lookup",
          requiresTypeChecking: true,
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          ClassDeclaration(node: any) {
            const className = node.id?.name;
            if (!className) {
              return;
            }
            seen[className] = checker
              .getImplementedTypes(node)
              .map((type) => checker.typeToString(type));
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("implemented-types", rule as any, {
      valid: [
        {
          code: [
            "interface SuperClass { value: string }",
            "interface Other { item: number }",
            "class ChildClass implements SuperClass, Other {",
            "  value = '';",
            "  item = 1;",
            "}",
            "class PlainClass {}",
          ].join("\n"),
          settings: {
            typescriptOxlint: {
              parserOptions: {
                tsgo: {
                  executable: realTsgoBinary,
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    expect(seen.ChildClass).toEqual(["SuperClass", "Other"]);
    expect(seen.PlainClass).toEqual([]);
  });

  integrationCase("resolves implemented types from a declaration node recovered from type metadata", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "implemented-types-from-node-id",
      meta: {
        type: "problem",
        docs: {
          description: "exercise implemented types from a recovered declaration node",
          requiresTypeChecking: true,
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          TSPropertySignature(node: any) {
            if (node.key?.name !== "foo") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            const symbol = type?.symbol ? checker.getSymbol(type.symbol) : undefined;
            const declaration = symbol?.declarations?.[0];
            const declarationNode = declaration ? checker.getNodeById(declaration) : undefined;
            seen.foo = declarationNode
              ? checker.getImplementedTypes(declarationNode).map((implemented) =>
                  checker.typeToString(implemented),
                )
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("implemented-types-from-node-id", rule as any, {
      valid: [
        {
          code: [
            "interface IFoo {",
            "  name: string;",
            "}",
            "declare class Foo implements IFoo {",
            "  name: string;",
            "}",
            "interface Bag {",
            "  foo: Foo;",
            "}",
          ].join("\n"),
          settings: {
            typescriptOxlint: {
              parserOptions: {
                tsgo: {
                  executable: realTsgoBinary,
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    expect(seen.foo).toEqual(["IFoo"]);
  });
});
