import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createTypeChecker } from "./checker";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";
import { resolvedRealCorsaBinary } from "./test_support";

const realCorsaBinary = resolvedRealCorsaBinary() ?? "";
const stableTypeScript7Binary = optionalStableTypeScript7Executable() ?? "";
const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;
const stableTypeScript7Case = existsSync(stableTypeScript7Binary) ? it : it.skip;

/**
 * Resolves the `tsc` shipped by the installed stable `typescript` package, so
 * the regression test below runs against a released TypeScript 7 runtime rather
 * than the Corsa build this repository pins.
 */
function optionalStableTypeScript7Executable(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const typeScriptPackage = require.resolve("typescript/package.json");
    const requireFromTypeScript = createRequire(typeScriptPackage);
    const platformPackage = requireFromTypeScript.resolve(
      `@typescript/typescript-${process.platform}-${process.arch}/package.json`,
    );
    return resolve(
      dirname(platformPackage),
      "lib",
      process.platform === "win32" ? "tsc.exe" : "tsc",
    );
  } catch {
    return undefined;
  }
}

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

  integrationCase("returns implemented interfaces from same-file class declaration types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "implemented-types-of-same-file-class-declarations",
      meta: {
        type: "problem",
        docs: {
          description: "exercise implemented types resolved from same-file class declaration types",
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
            const type = checker.getTypeAtLocation(node);
            if (!className || !type) {
              return;
            }
            seen[className] = checker
              .getImplementedTypesOfType(type)
              .map((implemented) => checker.typeToString(implemented));
          },
        };
      },
    });

    new RuleTester({ languageOptions: { sourceType: "module" } }).run(
      "implemented-types-of-same-file-class-declarations",
      rule as any,
      {
        valid: [
          {
            code: [
              "interface IContainer { name: string; }",
              "class Plain implements IContainer {",
              '  name = "x";',
              "}",
              "abstract class ContainerBase implements IContainer {",
              "  abstract readonly name: string;",
              "}",
              "class Container extends ContainerBase {",
              '  readonly name: string = "x";',
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
      },
    );

    expect(seen.Plain).toEqual(["IContainer"]);
    expect(seen.ContainerBase).toEqual(["IContainer"]);
    expect(seen.Container).toEqual(["IContainer"]);
  });

  integrationCase("resolves namespace-qualified implemented interfaces from class types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "qualified-implemented-types-of-type",
      meta: {
        type: "problem",
        docs: {
          description: "exercise qualified implemented types resolved from a class type",
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
            const type = checker.getTypeAtLocation(node);
            seen[className] = type
              ? checker
                  .getImplementedTypesOfType(type)
                  .map((implemented) => checker.typeToString(implemented))
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("qualified-implemented-types-of-type", rule as any, {
      valid: [
        {
          code: [
            "interface IFoo {",
            "  foo: string;",
            "}",
            "class A implements IFoo {",
            '  foo = "";',
            "}",
            "namespace ns {",
            "  export interface IBar {",
            "    bar: number;",
            "  }",
            "}",
            "class B implements ns.IBar {",
            "  bar = 1;",
            "}",
            "namespace outer {",
            "  export namespace inner {",
            "    export interface IBaz {",
            "      baz: boolean;",
            "    }",
            "  }",
            "}",
            "class C implements outer.inner.IBaz {",
            "  baz = true;",
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

    expect(seen.A).toEqual(["IFoo"]);
    expect(seen.B).toEqual(["IBar"]);
    expect(seen.C).toEqual(["IBaz"]);
  });

  integrationCase(
    "resolves implemented interfaces after getBaseTypes has been called on the same type",
    () => {
      const seen: Record<string, readonly string[] | undefined> = {};
      const errors: Record<string, string | undefined> = {};
      const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
      const rule = createRule({
        name: "implemented-types-after-get-base-types",
        meta: {
          type: "problem",
          docs: {
            description: "exercise getImplementedTypesOfType after getBaseTypes on the same handle",
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
              const name = checker.typeToString(type);
              // Drain the bases first to invalidate the type handle before we
              // ask for implemented interfaces - regressing GH#206.
              checker.getBaseTypes(type);
              try {
                seen[name] = checker
                  .getImplementedTypesOfType(type)
                  .map((implemented) => checker.typeToString(implemented));
              } catch (error) {
                errors[name] = error instanceof Error ? error.message : String(error);
              }
            },
          };
        },
      });

      const tester = new RuleTester();
      tester.run("implemented-types-after-get-base-types", rule as any, {
        valid: [
          {
            code: [
              "interface IA {",
              "  readonly a: string;",
              "}",
              "class Base implements IA {",
              '  readonly a = "x";',
              "}",
              "class Derived extends Base {",
              '  readonly b = "y";',
              "}",
              "new Base();",
              "new Derived();",
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

      expect(errors).toEqual({});
      expect(seen.Base).toEqual(["IA"]);
      expect(seen.Derived).toEqual(["IA"]);
    },
  );

  integrationCase(
    "resolves implemented interfaces for generic property arguments after a hierarchy walk",
    () => {
      const seen: Record<string, readonly string[] | undefined> = {};
      const errors: string[] = [];
      const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
      const rule = createRule({
        name: "implemented-types-after-hierarchy-walk",
        meta: {
          type: "problem",
          docs: {
            description: "exercise property type arguments after symbol and base traversal",
            requiresTypeChecking: true,
          },
          messages: { unexpected: "unexpected" },
          schema: [],
        },
        defaultOptions: [],
        create(context: any) {
          const services = OxlintUtils.getParserServices(context);
          const checker = services.program.getTypeChecker();
          const walk = (type: any, depth = 0) => {
            if (!type || depth > 8) {
              return;
            }
            checker.getSymbolOfType(type);
            for (const base of checker.getBaseTypes(type)) {
              walk(base, depth + 1);
            }
          };
          return {
            ClassDeclaration(node: any) {
              const type = services.getTypeAtLocation(node);
              walk(type);
              if (node.id?.name && type) {
                seen[node.id.name] = checker
                  .getImplementedTypesOfType(type)
                  .map((implemented) => checker.typeToString(implemented));
              }
            },
            PropertyDefinition(node: any) {
              try {
                const type = services.getTypeAtLocation(node);
                if (type) {
                  checker.getImplementedTypesOfType(type);
                  for (const argument of checker.getTypeArguments(type)) {
                    seen.argument = checker
                      .getImplementedTypesOfType(argument)
                      .map((implemented) => checker.typeToString(implemented));
                  }
                }
              } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
              }
            },
          };
        },
      });

      new RuleTester({ languageOptions: { sourceType: "module" } }).run(
        "implemented-types-after-hierarchy-walk",
        rule as any,
        {
          valid: [
            {
              code: [
                "interface IContainer { name: string; }",
                "abstract class ContainerBase implements IContainer {",
                "  abstract readonly name: string;",
                "}",
                "class Container extends ContainerBase {",
                '  readonly name: string = "x";',
                "}",
                "interface Wrapper<T> { value: T; }",
                "class Holder {",
                "  public field: Wrapper<Container>;",
                "}",
              ].join("\n"),
              settings: {
                corsaOxlint: {
                  parserOptions: {
                    corsa: { executable: realCorsaBinary },
                  },
                },
              },
            },
          ],
          invalid: [],
        },
      );

      expect(errors).toEqual([]);
      expect(seen.ContainerBase).toEqual(["IContainer"]);
      expect(seen.Container).toEqual(["IContainer"]);
      expect(seen.argument).toEqual(["IContainer"]);
    },
  );

  integrationCase("returns inherited implemented interfaces from class types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "inherited-implemented-types-of-type",
      meta: {
        type: "problem",
        docs: {
          description: "exercise inherited implemented types resolved from a class type",
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
    tester.run("inherited-implemented-types-of-type", rule as any, {
      valid: [
        {
          code: [
            "interface IA {",
            "  readonly a: string;",
            "}",
            "class Base implements IA {",
            '  readonly a = "x";',
            "}",
            "class Derived extends Base {",
            '  readonly b = "y";',
            "}",
            "new Base();",
            "new Derived();",
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

    expect(seen.Base).toEqual(["IA"]);
    expect(seen.Derived).toEqual(["IA"]);
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

  stableTypeScript7Case("preserves symbols and implemented types on immediate base types", () => {
    const seen: Record<
      string,
      {
        readonly symbol: string | null;
        readonly implemented: readonly string[];
        readonly bases: readonly {
          readonly text: string;
          readonly symbol: string | null;
          readonly implemented: readonly string[];
        }[];
      }
    > = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "base-type-identity",
      meta: {
        type: "problem",
        docs: {
          description: "exercise symbol and implements lookups on base type handles",
          requiresTypeChecking: true,
        },
        messages: { unexpected: "unexpected" },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          TSPropertySignature(node: any) {
            const name = node.key?.name;
            if (!name) {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            if (!type || checker.typeToString(type) === "string") {
              return;
            }
            seen[name] = {
              symbol: checker.getSymbolOfType(type)?.name ?? null,
              implemented: checker
                .getImplementedTypesOfType(type)
                .map((implemented: any) => checker.typeToString(implemented)),
              bases: checker.getBaseTypes(type).map((base: any) => ({
                text: checker.typeToString(base),
                symbol: checker.getSymbolOfType(base)?.name ?? null,
                implemented: checker
                  .getImplementedTypesOfType(base)
                  .map((implemented: any) => checker.typeToString(implemented)),
              })),
            };
          },
        };
      },
    });

    new RuleTester({ languageOptions: { sourceType: "module" } }).run(
      "base-type-identity",
      rule as any,
      {
        valid: [
          {
            code: [
              "interface I { name: string; }",
              'class A_Base implements I { name = "x"; }',
              "class A_Leaf extends A_Base {}",
              "class B_Root {}",
              'class B_Base extends B_Root implements I { name = "x"; }',
              "class B_Leaf extends B_Base {}",
              "interface Props { a: A_Leaf; b: B_Leaf; }",
            ].join("\n"),
            settings: {
              corsaOxlint: {
                parserOptions: {
                  corsa: {
                    executable: stableTypeScript7Binary,
                  },
                },
              },
            },
          },
        ],
        invalid: [],
      },
    );

    expect(seen).toEqual({
      a: {
        symbol: "A_Leaf",
        implemented: ["I"],
        bases: [{ text: "A_Base", symbol: "A_Base", implemented: ["I"] }],
      },
      b: {
        symbol: "B_Leaf",
        implemented: ["I"],
        bases: [{ text: "B_Base", symbol: "B_Base", implemented: ["I"] }],
      },
    });
  });

  stableTypeScript7Case("does not confuse base types that share a simple name", () => {
    const seen: Record<
      string,
      readonly {
        readonly symbol: string | null;
        readonly implemented: readonly string[];
      }[]
    > = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "duplicate-base-names",
      meta: {
        type: "problem",
        docs: {
          description: "exercise base type recovery when two declarations share a simple name",
          requiresTypeChecking: true,
        },
        messages: { unexpected: "unexpected" },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          TSPropertySignature(node: any) {
            const name = node.key?.name;
            if (!name) {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            if (!type) {
              return;
            }
            seen[name] = checker.getBaseTypes(type).map((base: any) => ({
              symbol: checker.getSymbolOfType(base)?.name ?? null,
              implemented: checker
                .getImplementedTypesOfType(base)
                .map((implemented: any) => checker.typeToString(implemented)),
            }));
          },
        };
      },
    });

    new RuleTester({ languageOptions: { sourceType: "module" } }).run(
      "duplicate-base-names",
      rule as any,
      {
        valid: [
          {
            code: [
              "interface I { name: string; }",
              'namespace First { export class Base implements I { name = "x"; } }',
              "namespace Second { export class Base { size = 1; } }",
              "class FirstLeaf extends First.Base {}",
              "class SecondLeaf extends Second.Base {}",
              "interface Props { a: FirstLeaf; b: SecondLeaf; }",
            ].join("\n"),
            settings: {
              corsaOxlint: {
                parserOptions: {
                  corsa: {
                    executable: stableTypeScript7Binary,
                  },
                },
              },
            },
          },
        ],
        invalid: [],
      },
    );

    // `Second.Base` must never inherit `First.Base`'s implemented interfaces,
    // even though both declarations are named `Base`. Recovery is allowed to
    // report no symbol for an ambiguous name, but never the wrong one.
    expect(seen.a?.map((base) => base.implemented)).toEqual([["I"]]);
    expect(seen.b?.map((base) => base.implemented)).toEqual([[]]);
  });

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
