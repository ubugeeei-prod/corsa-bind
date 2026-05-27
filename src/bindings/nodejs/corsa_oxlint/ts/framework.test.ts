import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultCorsaExecutable } from "./context";
import { OxlintUtils } from "./oxlint_utils";
import { getParserServices } from "./parser_services";
import { decorateRule, definePlugin } from "./plugin";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realCorsaBinary = defaultCorsaExecutable(workspaceRoot);

describe("corsa oxlint", () => {
  it("creates docs URLs through the Oxlint RuleCreator", () => {
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "no-demo",
      meta: {
        type: "problem",
        docs: {
          description: "demo rule",
        },
        messages: {
          demo: "demo",
        },
        schema: [],
      },
      defaultOptions: [],
      create() {
        return {};
      },
    });

    expect(((rule as any).meta as { docs: { url: string } }).docs.url).toBe(
      "https://example.com/rules/no-demo",
    );
  });

  it("wraps plugin rules with parserServices access", () => {
    const plugin = definePlugin({
      meta: { name: "oxlint-plugin-corsa-demo" },
      rules: {
        demo: {
          create(context) {
            expect(typeof (context as any).parserServices?.getTypeAtLocation).toBe("function");
            return {};
          },
        },
      },
    });

    expect(plugin.rules?.demo).toBeDefined();
  });

  it("hydrates parserOptions from settings.corsaOxlint", () => {
    let seen: Record<string, unknown> | undefined;
    const rule = decorateRule({
      meta: {
        messages: {
          demo: "demo",
        },
        schema: [],
      },
      create(context: any) {
        seen = {
          executable: context.parserOptions.corsa?.executable,
          project: context.languageOptions?.parserOptions?.project,
          hasParserServices: "parserServices" in (context as object),
        };
        return {};
      },
    } as any);

    expect(rule.create).toBeDefined();
    rule.create!({
      cwd: workspaceRoot,
      filename: resolve(workspaceRoot, "fixture.ts"),
      languageOptions: {
        parserOptions: {},
      },
      report() {},
      settings: {
        corsaOxlint: {
          parserOptions: {
            project: ["tsconfig.json"],
            corsa: {
              executable: realCorsaBinary,
            },
          },
        },
      },
      sourceCode: {
        text: "const fixture = 1;",
      },
    } as any);

    expect(seen).toEqual({
      executable: realCorsaBinary,
      project: ["tsconfig.json"],
      hasParserServices: true,
    });
  });

  it("reuses existing parserServices when ESLint already provides type information", () => {
    const program = {
      getTypeChecker() {
        return {
          getTypeAtLocation() {
            return { kind: "type" };
          },
          getSymbolAtLocation() {
            return { kind: "symbol" };
          },
        };
      },
    };
    const tsNode = { kind: "ts-node" };
    const parserServices = {
      program,
      esTreeNodeToTSNodeMap: {
        get() {
          return tsNode;
        },
        has() {
          return true;
        },
      },
      tsNodeToESTreeNodeMap: {
        get() {
          return { type: "Identifier" };
        },
        has() {
          return true;
        },
      },
    };

    const services = getParserServices({
      cwd: workspaceRoot,
      filename: resolve(workspaceRoot, "fixture.ts"),
      languageOptions: {
        parserOptions: {},
      },
      parserServices: parserServices as never,
      report() {},
      settings: {},
      sourceCode: {
        text: "const fixture = 1;",
      },
    } as never);

    expect(Object.getPrototypeOf(services.program)).toBe(program);
    expect(services.hasFullTypeInformation).toBe(true);
    expect(typeof services.program.getTypeChecker().isUnionType).toBe("function");
    expect(services.getTypeAtLocation({ type: "Identifier" } as never)).toEqual({
      kind: "type",
    });
    expect(services.getSymbolAtLocation({ type: "Identifier" } as never)).toEqual({
      kind: "symbol",
    });
  });

  it("reuses existing parserServices from sourceCode when ESLint provides type information there", () => {
    const program = {
      getTypeChecker() {
        return {
          getTypeAtLocation() {
            return { kind: "type" };
          },
          getSymbolAtLocation() {
            return { kind: "symbol" };
          },
        };
      },
    };
    const tsNode = { kind: "ts-node" };
    const parserServices = {
      program,
      esTreeNodeToTSNodeMap: {
        get() {
          return tsNode;
        },
        has() {
          return true;
        },
      },
      tsNodeToESTreeNodeMap: {
        get() {
          return { type: "Identifier" };
        },
        has() {
          return true;
        },
      },
    };

    const services = getParserServices({
      cwd: workspaceRoot,
      filename: resolve(workspaceRoot, "fixture.ts"),
      languageOptions: {
        parserOptions: {},
      },
      report() {},
      settings: {},
      sourceCode: {
        text: "const fixture = 1;",
        parserServices: parserServices as never,
      },
    } as never);

    expect(Object.getPrototypeOf(services.program)).toBe(program);
    expect(services.hasFullTypeInformation).toBe(true);
    expect(typeof services.program.getTypeChecker().isUnionType).toBe("function");
    expect(services.getTypeAtLocation({ type: "Identifier" } as never)).toEqual({
      kind: "type",
    });
    expect(services.getSymbolAtLocation({ type: "Identifier" } as never)).toEqual({
      kind: "symbol",
    });
  });

  it("exposes the corsa checker shape when using sourceCode parserServices", () => {
    const unionType = {
      isUnion() {
        return true;
      },
      types: [{ name: "string" }, { name: "number" }],
    };
    const implementedType = { name: "Implemented" };
    const implementationExpression = { kind: "implementation-expression" };
    const implementedClause = {
      getText() {
        return "implements Implemented";
      },
      types: [
        {
          expression: implementationExpression,
        },
      ],
    };
    const classDeclaration = {
      heritageClauses: [implementedClause],
    };
    const classType = {
      symbol: {
        declarations: [classDeclaration],
      },
    };
    const classNode = { type: "ClassDeclaration" };
    const typeArgument = { name: "T" };
    const checker = {
      getTypeAtLocation(node: unknown) {
        return node === implementationExpression ? implementedType : unionType;
      },
      getSymbolAtLocation() {
        return { kind: "symbol" };
      },
      getTypeArguments() {
        return [typeArgument];
      },
    };
    const program = {
      getTypeChecker() {
        return checker;
      },
    };
    const tsNode = { kind: "ts-node" };
    const parserServices = {
      program,
      esTreeNodeToTSNodeMap: {
        get(node: unknown) {
          if (node === classNode) {
            return classDeclaration;
          }
          return tsNode;
        },
        has() {
          return true;
        },
      },
      tsNodeToESTreeNodeMap: {
        get(node: unknown) {
          if (node === classDeclaration) {
            return classNode;
          }
          return { type: "Identifier" };
        },
        has() {
          return true;
        },
      },
    };

    const services = getParserServices({
      cwd: workspaceRoot,
      filename: resolve(workspaceRoot, "fixture.ts"),
      languageOptions: {
        parserOptions: {},
      },
      report() {},
      settings: {},
      sourceCode: {
        text: "type Fixture = string | number;",
        parserServices: parserServices as never,
      },
    } as never);
    const corsaChecker = services.program.getTypeChecker();
    const type = services.getTypeAtLocation({ type: "Identifier" } as never);

    expect(type).toBe(unionType);
    expect(corsaChecker.getTypeAtLocation({ type: "Identifier" } as never)).toBe(unionType);
    expect(corsaChecker.isUnionType(type as never)).toBe(true);
    expect(corsaChecker.getTypesOfType(type as never)).toEqual(unionType.types);
    expect(corsaChecker.getBaseTypes(type as never)).toEqual([]);
    expect(corsaChecker.getImplementedTypes(classNode as never)).toEqual([implementedType]);
    expect(corsaChecker.getImplementedTypesOfType(classType as never)).toEqual([implementedType]);
    expect(corsaChecker.getTypeArguments(type as never)).toEqual([typeArgument]);
    expect(corsaChecker.getSymbolById("missing")).toBeUndefined();
    expect(corsaChecker.getNodeById("missing")).toBeUndefined();
  });

  it("propagates corsaOxlint settings through RuleTester", () => {
    let seen: Record<string, unknown> | undefined;
    const tester = new RuleTester();
    tester.run(
      "settings-roundtrip",
      {
        meta: {
          messages: {
            demo: "demo",
          },
          schema: [],
        },
        create(context: any) {
          seen = {
            languageExecutable: context.languageOptions?.parserOptions?.corsa?.executable,
            parserExecutable: context.parserOptions?.corsa?.executable,
            settingsExecutable: context.settings?.corsaOxlint?.parserOptions?.corsa?.executable,
          };
          return {};
        },
      } as any,
      {
        valid: [
          {
            code: "const value = 1;",
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

    expect(seen).toEqual({
      languageExecutable: realCorsaBinary,
      parserExecutable: realCorsaBinary,
      settingsExecutable: realCorsaBinary,
    });
  });

  const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;

  integrationCase("runs a type-aware custom rule through oxlint RuleTester", () => {
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "no-string-plus-number",
      meta: {
        type: "problem",
        docs: {
          description: "reject string plus number",
          recommended: "recommended",
          requiresTypeChecking: true,
        },
        messages: {
          unexpected: "string plus number is forbidden",
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
            const left = normalize(checker.getTypeAtLocation(node.left));
            const right = normalize(checker.getTypeAtLocation(node.right));
            if (!left || !right) {
              return;
            }
            if (left === "string" && right === "number") {
              context.report({ node, messageId: "unexpected" });
            }
          },
        };

        function normalize(type: any): string | undefined {
          if (!type) {
            return undefined;
          }
          const normalized = checker.getBaseTypeOfLiteralType(type) ?? type;
          return checker.typeToString(normalized);
        }
      },
    });

    const tester = new RuleTester();
    tester.run("no-string-plus-number", rule as any, {
      valid: [
        {
          code: "const result = 1 + 2;",
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
      invalid: [
        {
          code: 'const lhs = "value"; const rhs = 1; const result = lhs + rhs;',
          errors: [{ messageId: "unexpected" }],
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
    });
  });
});
