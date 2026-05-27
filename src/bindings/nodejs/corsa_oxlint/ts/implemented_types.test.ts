import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createTypeChecker } from "./checker";
import { defaultCorsaExecutable } from "./context";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realCorsaBinary = defaultCorsaExecutable(workspaceRoot);
const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;

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

    expect(seen.ChildClass).toEqual(["SuperClass", "Other"]);
    expect(seen.PlainClass).toEqual([]);
  });

  integrationCase("returns implemented interfaces from class types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "implemented-types-of-type",
      meta: {
        type: "problem",
        docs: {
          description: "exercise implemented types resolved from a class type",
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
            if (node.id?.name !== "ChildClass") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.byNode = checker
              .getImplementedTypes(node)
              .map((implemented) => checker.typeToString(implemented));
            seen.byType = type
              ? checker
                  .getImplementedTypesOfType(type)
                  .map((implemented) => checker.typeToString(implemented))
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("implemented-types-of-type", rule as any, {
      valid: [
        {
          code: [
            "interface IChild {",
            "  x: string;",
            "}",
            "class Parent {}",
            "class ChildClass extends Parent implements IChild {",
            "  x = '';",
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

    expect(seen.byNode).toEqual(["IChild"]);
    expect(seen.byType).toEqual(["IChild"]);
  });

  integrationCase("ignores braces in leading comments when resolving implemented types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "implemented-types-leading-comment",
      meta: {
        type: "problem",
        docs: {
          description: "exercise implemented type lookup for classes with leading comments",
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
          NewExpression(node: any) {
            const type = checker.getTypeAtLocation(node);
            if (!type) {
              return;
            }
            seen[checker.typeToString(type)] = checker
              .getImplementedTypesOfType(type)
              .map((implemented) => checker.typeToString(implemented));
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("implemented-types-leading-comment", rule as any, {
      valid: [
        {
          code: [
            "interface IFoo {",
            "  x: string;",
            "}",
            "/** No brace in this doc. */",
            "class NoBrace implements IFoo {",
            "  x = '';",
            "}",
            "/**",
            " * Example usage:",
            " *   new WithBrace({ a: 1 });",
            " */",
            "class WithBrace implements IFoo {",
            "  x = '';",
            "}",
            "new NoBrace();",
            "new WithBrace();",
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

    expect(seen.NoBrace).toEqual(["IFoo"]);
    expect(seen.WithBrace).toEqual(["IFoo"]);
  });

  integrationCase(
    "resolves implemented types from a declaration node recovered from type metadata",
    () => {
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
                ? checker
                    .getImplementedTypes(declarationNode)
                    .map((implemented) => checker.typeToString(implemented))
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

      expect(seen.foo).toEqual(["IFoo"]);
    },
  );

  integrationCase("returns implemented interfaces from external declaration class types", () => {
    const workspace = mkdtempSync(resolve(tmpdir(), "corsa-oxlint-external-implements-"));
    const depDir = resolve(workspace, "node_modules", "external-dep");
    const srcDir = resolve(workspace, "src");
    mkdirSync(depDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      resolve(depDir, "package.json"),
      JSON.stringify({ name: "external-dep", version: "1.0.0", types: "index.d.ts" }),
    );
    writeFileSync(
      resolve(depDir, "index.d.ts"),
      [
        "export interface IFoo {",
        "  readonly foo: string;",
        "}",
        "export declare class Base implements IFoo {",
        "  readonly foo: string;",
        "}",
        "export declare class Foo extends Base {}",
      ].join("\n"),
    );
    writeFileSync(
      resolve(workspace, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            module: "esnext",
            moduleResolution: "node",
            target: "es2022",
            strict: true,
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
    );
    const filename = resolve(srcDir, "index.ts");
    const sourceText = ['import { Foo } from "external-dep";', "new Foo();"].join("\n");
    writeFileSync(filename, sourceText);
    const checker = createTypeChecker({
      cwd: workspace,
      filename,
      sourceCode: { text: sourceText },
      settings: {
        corsaOxlint: {
          parserOptions: {
            project: "tsconfig.json",
            corsa: {
              executable: realCorsaBinary,
              cwd: workspace,
              mode: "jsonrpc",
            },
          },
        },
      },
    } as any);
    const newExpressionIndex = sourceText.indexOf("new Foo()");
    const calleeIndex = sourceText.indexOf("Foo()", newExpressionIndex);
    const instanceType = checker.getTypeAtLocation({
      type: "NewExpression",
      range: [newExpressionIndex, newExpressionIndex + "new Foo()".length] as const,
      callee: {
        type: "Identifier",
        name: "Foo",
        range: [calleeIndex, calleeIndex + "Foo".length] as const,
      },
    } as any);
    const baseType = instanceType ? checker.getBaseTypes(instanceType)[0] : undefined;

    expect(baseType ? checker.typeToString(baseType) : undefined).toBe("Base");
    expect(
      baseType
        ? checker.getImplementedTypesOfType(baseType).map((type) => checker.typeToString(type))
        : undefined,
    ).toEqual(["IFoo"]);
  });
});
