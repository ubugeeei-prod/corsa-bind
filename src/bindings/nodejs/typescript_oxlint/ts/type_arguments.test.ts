import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultTsgoExecutable } from "./context";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realTsgoBinary = defaultTsgoExecutable(workspaceRoot);
const integrationCase = existsSync(realTsgoBinary) ? it : it.skip;

describe("corsa oxlint type arguments", () => {
  integrationCase("returns empty type arguments for non-generic types", () => {
    const seen: Record<string, readonly string[]> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "safe-type-arguments",
      meta: {
        type: "problem",
        docs: {
          description: "exercise type argument lookups",
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
            const keyName = node.key?.name;
            if (!keyName) {
              return;
            }
            const type = checker.getTypeAtLocation(node.key);
            seen[keyName] = type
              ? checker.getTypeArguments(type).map((argument) => checker.typeToString(argument))
              : [];
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("safe-type-arguments", rule as any, {
      valid: [
        {
          code: [
            "interface Demo {",
            "  text: string;",
            "  count: number;",
            "  flag: boolean;",
            "  mixed: string | number;",
            "  object: { value: string };",
            "  list: Array<string>;",
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

    expect(seen.text).toEqual([]);
    expect(seen.count).toEqual([]);
    expect(seen.flag).toEqual([]);
    expect(seen.mixed).toEqual([]);
    expect(seen.object).toEqual([]);
    expect(seen.list).toEqual(["string"]);
  });
});
