import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultCorsaExecutable } from "./context";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realCorsaBinary = defaultCorsaExecutable(workspaceRoot);
const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;

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
            corsaOxlint: {
              parserOptions: {
                corsa: {
                  executable: realCorsaBinary,
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

  integrationCase("returns type arguments for mapped type references", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "mapped-type-arguments",
      meta: {
        type: "problem",
        docs: {
          description: "exercise mapped type argument lookups",
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
          VariableDeclarator(node: any) {
            const name = node.id?.name;
            if (!name) {
              return;
            }
            const type = checker.getTypeAtLocation(node.id);
            seen[name] = type
              ? checker.getTypeArguments(type).map((argument) => checker.typeToString(argument))
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("mapped-type-arguments", rule as any, {
      valid: [
        {
          code: [
            "interface Box<T> {",
            "  value: T;",
            "}",
            "type MyReadonly<T> = { readonly [K in keyof T]: T[K] };",
            "const wrap: Box<{ a: number }> = { value: { a: 1 } };",
            'const readonlyFoo: Readonly<{ a: number; b: string }> = { a: 1, b: "x" };',
            "const partialFoo: Partial<{ a: number; b: string }> = {};",
            "const wrap2: MyReadonly<{ a: number }> = { a: 1 };",
          ].join("\n"),
          settings: {
            corsaOxlint: {
              parserOptions: {
                corsa: {
                  executable: realCorsaBinary,
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    expect(seen.wrap).toEqual(["{ a: number; }"]);
    expect(seen.readonlyFoo).toEqual(["{ a: number; b: string; }"]);
    expect(seen.partialFoo).toEqual(["{ a: number; b: string; }"]);
    expect(seen.wrap2).toEqual(["{ a: number; }"]);
  });

  integrationCase("returns structural handles for mapped utility type arguments", () => {
    const seen: Record<
      string,
      | {
          readonly argument: string;
          readonly bases: readonly string[];
          readonly implemented: readonly string[];
        }
      | undefined
    > = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "mapped-utility-type-argument-structure",
      meta: {
        type: "problem",
        docs: {
          description: "exercise mapped utility type argument handles",
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
            const type = checker.getTypeAtLocation(node);
            const argument = type ? checker.getTypeArguments(type)[0] : undefined;
            seen[keyName] = argument
              ? {
                  argument: checker.typeToString(argument),
                  bases: checker.getBaseTypes(argument).map((base) => checker.typeToString(base)),
                  implemented: checker
                    .getImplementedTypesOfType(argument)
                    .map((implemented) => checker.typeToString(implemented)),
                }
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("mapped-utility-type-argument-structure", rule as any, {
      valid: [
        {
          code: [
            "class Animal {}",
            "interface IDog {",
            "  name: string;",
            "}",
            "class Dog extends Animal implements IDog {",
            '  readonly name = "Rex";',
            "}",
            "interface Box<T> {",
            "  value: T;",
            "}",
            "interface Props {",
            "  boxed: Box<Dog>;",
            "  readonlyDog: Readonly<Dog>;",
            "  partialDog: Partial<Dog>;",
            "  requiredDog: Required<Dog>;",
            "}",
          ].join("\n"),
          settings: {
            corsaOxlint: {
              parserOptions: {
                corsa: {
                  executable: realCorsaBinary,
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    const expected = {
      argument: "Dog",
      bases: ["Animal"],
      implemented: ["IDog"],
    };
    expect(seen.boxed).toEqual(expected);
    expect(seen.readonlyDog).toEqual(expected);
    expect(seen.partialDog).toEqual(expected);
    expect(seen.requiredDog).toEqual(expected);
  });
});
