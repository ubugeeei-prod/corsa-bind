import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { OxlintUtils } from "./oxlint_utils";
import { getParserServices } from "./parser_services";
import { decorateRule, definePlugin } from "./plugin";
import { RuleTester } from "./rule_tester";
import { integrationCase as resolveIntegrationCase, resolvedRealCorsaBinary } from "./test_support";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realCorsaBinary = resolvedRealCorsaBinary() ?? "";
const cleanupDirs = new Set<string>();

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  cleanupDirs.clear();
});

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

  it("defaults projectService for type-aware rules", () => {
    const previousExecutable = process.env.CORSA_EXECUTABLE;
    process.env.CORSA_EXECUTABLE = resolve(workspaceRoot, "target/test-corsa");
    let seen: Record<string, unknown> | undefined;
    const rule = decorateRule({
      meta: {
        docs: {
          requiresTypeChecking: true,
        },
        messages: {
          demo: "demo",
        },
        schema: [],
      },
      create(context: any) {
        seen = {
          parserProjectService: context.parserOptions.projectService,
          languageProjectService: context.languageOptions?.parserOptions?.projectService,
        };
        return {};
      },
    } as any);

    try {
      rule.create!({
        cwd: workspaceRoot,
        filename: resolve(workspaceRoot, "fixture.ts"),
        languageOptions: {
          parserOptions: {},
        },
        report() {},
        settings: {},
        sourceCode: {
          text: "const fixture = 1;",
        },
      } as any);

      expect(seen).toEqual({
        parserProjectService: true,
        languageProjectService: true,
      });
    } finally {
      if (previousExecutable == null) {
        delete process.env.CORSA_EXECUTABLE;
      } else {
        process.env.CORSA_EXECUTABLE = previousExecutable;
      }
    }
  });

  it("uses plugin resolveFrom to fill the default corsa executable", () => {
    const previousExecutable = process.env.CORSA_EXECUTABLE;
    delete process.env.CORSA_EXECUTABLE;
    const consumerRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-consumer-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-plugin-"));
    cleanupDirs.add(consumerRoot);
    cleanupDirs.add(pluginRoot);

    const expectedExecutable = writeTypeScriptInstall(pluginRoot);

    const pluginEntry = resolve(pluginRoot, "dist/plugin.js");
    mkdirSync(dirname(pluginEntry), { recursive: true });
    writeFileSync(pluginEntry, "export default {};\n");

    let seen: string | undefined;
    const plugin = definePlugin({
      meta: { name: "oxlint-plugin-corsa-demo" },
      resolveFrom: pathToFileURL(pluginEntry).href,
      rules: {
        demo: {
          meta: {
            docs: {
              requiresTypeChecking: true,
            },
            messages: {
              demo: "demo",
            },
            schema: [],
          },
          create(context: any) {
            seen = context.parserOptions.corsa?.executable;
            return {};
          },
        },
      },
    });

    try {
      plugin.rules.demo.create!({
        cwd: consumerRoot,
        filename: resolve(consumerRoot, "fixture.ts"),
        languageOptions: {
          parserOptions: {},
        },
        report() {},
        settings: {},
        sourceCode: {
          text: "const fixture = 1;",
        },
      } as any);

      expect(seen).toBe(expectedExecutable);
    } finally {
      if (previousExecutable == null) {
        delete process.env.CORSA_EXECUTABLE;
      } else {
        process.env.CORSA_EXECUTABLE = previousExecutable;
      }
    }
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
    const unionSymbol = { name: "UnionAlias" };
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
      getSymbolOfType() {
        return unionSymbol;
      },
      getBaseTypes() {
        return [];
      },
      getImplementedTypes(node: unknown) {
        return node === classDeclaration ? [implementedType] : [];
      },
      getImplementedTypesOfType(type: unknown) {
        return type === classType ? [implementedType] : [];
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
    expect(corsaChecker.getSymbolOfType(type as never)).toBe(unionSymbol);
    expect(corsaChecker.getImplementedTypes(classNode as never)).toEqual([implementedType]);
    expect(corsaChecker.getImplementedTypesOfType(classType as never)).toEqual([implementedType]);
    expect(corsaChecker.getTypeArguments(type as never)).toEqual([typeArgument]);
    expect(corsaChecker.getSymbolById("missing")).toBeUndefined();
    expect(corsaChecker.getNodeById("missing")).toBeUndefined();
  });

  it("does not synthesize inherited implemented interfaces in the eslint fallback checker", () => {
    const interfaceType = { name: "IA" };
    const baseType = { name: "Base" };
    const derivedType = { name: "Derived" };

    const checker = {
      getSymbolAtLocation() {
        return { kind: "symbol" };
      },
      getBaseTypes(type: unknown) {
        return type === derivedType ? [baseType] : [];
      },
      getImplementedTypesOfType(type: unknown) {
        return type === baseType ? [interfaceType] : [];
      },
    };
    const program = {
      getTypeChecker() {
        return checker;
      },
    };
    const parserServices = {
      program,
      esTreeNodeToTSNodeMap: {
        get() {
          return undefined;
        },
        has() {
          return false;
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
        text: "",
        parserServices: parserServices as never,
      },
    } as never);
    const corsaChecker = services.program.getTypeChecker();

    expect(corsaChecker.getBaseTypes(derivedType as never)).toEqual([baseType]);
    expect(corsaChecker.getImplementedTypesOfType(baseType as never)).toEqual([interfaceType]);
    expect(corsaChecker.getImplementedTypesOfType(derivedType as never)).toEqual([]);
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

  it("accepts corsaOxlint settings on the RuleTester constructor config", () => {
    let seen: Record<string, unknown> | undefined;
    const tester = new RuleTester({
      settings: {
        corsaOxlint: {
          parserOptions: {
            corsa: {
              executable: realCorsaBinary,
            },
          },
        },
      },
    });
    tester.run(
      "settings-config-roundtrip",
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
        valid: [{ code: "const value = 1;" }],
        invalid: [],
      },
    );

    expect(seen).toEqual({
      languageExecutable: realCorsaBinary,
      parserExecutable: realCorsaBinary,
      settingsExecutable: realCorsaBinary,
    });
  });

  it("defaults RuleTester corsa executable from the configured cwd", () => {
    const previousExecutable = process.env.CORSA_EXECUTABLE;
    delete process.env.CORSA_EXECUTABLE;
    let seen: Record<string, unknown> | undefined;
    try {
      const { packageRoot, executable: expectedExecutable } = createTypeScriptPackage();
      const tester = new RuleTester({
        cwd: packageRoot,
      });
      tester.run(
        "default-executable-roundtrip",
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
              tsconfigRootDir: context.parserOptions?.tsconfigRootDir,
            };
            return {};
          },
        } as any,
        {
          valid: [{ code: "const value = 1;" }],
          invalid: [],
        },
      );

      expect(seen).toEqual({
        languageExecutable: expectedExecutable,
        parserExecutable: expectedExecutable,
        settingsExecutable: expectedExecutable,
        tsconfigRootDir: expect.not.stringContaining(packageRoot),
      });
    } finally {
      if (previousExecutable === undefined) {
        delete process.env.CORSA_EXECUTABLE;
      } else {
        process.env.CORSA_EXECUTABLE = previousExecutable;
      }
    }
  });

  it("defaults RuleTester corsa executable from the calling test file directory", async () => {
    const previousExecutable = process.env.CORSA_EXECUTABLE;
    const previousCwd = process.cwd();
    const previousDescribe = RuleTester.describe;
    const previousIt = RuleTester.it;
    delete process.env.CORSA_EXECUTABLE;
    try {
      const { packageRoot, executable: expectedExecutable } = createTypeScriptPackage();
      const launchRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-launch-"));
      cleanupDirs.add(launchRoot);
      const probeDir = resolve(packageRoot, "__tests__");
      const probePath = resolve(probeDir, `rule_tester_probe_${Date.now()}.ts`);
      mkdirSync(probeDir, { recursive: true });
      writeFileSync(
        probePath,
        [
          `import { RuleTester } from ${JSON.stringify(pathToFileURL(resolve(import.meta.dirname, "rule_tester.ts")).href)};`,
          "",
          "export let seen;",
          "RuleTester.describe = (_name, fn) => fn?.();",
          "RuleTester.it = (_name, fn) => fn?.();",
          "",
          'new RuleTester({ languageOptions: { sourceType: "module" } }).run("default-executable-callsite", {',
          "  meta: {",
          '    messages: { demo: "demo" },',
          "    schema: [],",
          "  },",
          "  create(context) {",
          "    seen = {",
          "      languageExecutable: context.languageOptions?.parserOptions?.corsa?.executable,",
          "      parserExecutable: context.parserOptions?.corsa?.executable,",
          "      settingsExecutable: context.settings?.corsaOxlint?.parserOptions?.corsa?.executable,",
          "    };",
          "    return {};",
          "  },",
          "}, {",
          '  valid: [{ code: "const value = 1;" }],',
          "  invalid: [],",
          "});",
          "",
        ].join("\n"),
      );

      process.chdir(launchRoot);
      const probe = (await import(`${pathToFileURL(probePath).href}?case=${Date.now()}`)) as {
        seen: Record<string, unknown> | undefined;
      };

      expect(probe.seen).toEqual({
        languageExecutable: expectedExecutable,
        parserExecutable: expectedExecutable,
        settingsExecutable: expectedExecutable,
      });
    } finally {
      process.chdir(previousCwd);
      RuleTester.describe = previousDescribe;
      RuleTester.it = previousIt;
      if (previousExecutable === undefined) {
        delete process.env.CORSA_EXECUTABLE;
      } else {
        process.env.CORSA_EXECUTABLE = previousExecutable;
      }
    }
  });

  it("defaults decorated type-aware rules to the corsa executable", () => {
    const previousExecutable = process.env.CORSA_EXECUTABLE;
    delete process.env.CORSA_EXECUTABLE;
    let seen: Record<string, unknown> | undefined;
    try {
      const { packageRoot, executable: expectedExecutable } = createTypeScriptPackage();
      const rule = decorateRule({
        meta: {
          docs: {
            requiresTypeChecking: true,
          },
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
            projectService: context.parserOptions?.projectService,
          };
          return {};
        },
      } as any);

      rule.create!({
        cwd: packageRoot,
        filename: resolve(packageRoot, "fixture.ts"),
        languageOptions: {
          parserOptions: {},
        },
        report() {},
        settings: {},
        sourceCode: {
          text: "const fixture = 1;",
        },
      } as any);

      expect(seen).toEqual({
        languageExecutable: expectedExecutable,
        parserExecutable: expectedExecutable,
        settingsExecutable: undefined,
        projectService: true,
      });
    } finally {
      if (previousExecutable === undefined) {
        delete process.env.CORSA_EXECUTABLE;
      } else {
        process.env.CORSA_EXECUTABLE = previousExecutable;
      }
    }
  });

  const integrationCase = resolveIntegrationCase();

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

  integrationCase("exposes type-aware node maps and symbols to custom RuleTester rules", () => {
    const seen: Record<string, unknown>[] = [];
    const rule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`)({
      name: "type-service-probe",
      meta: {
        type: "problem",
        docs: {
          description: "exercise parser service maps and symbols inside RuleTester",
          recommended: "recommended",
          requiresTypeChecking: true,
        },
        messages: {
          fired: "type service probe fired",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          Identifier(node: any) {
            if (node.name !== "value") {
              return;
            }
            const tsNode = services.esTreeNodeToTSNodeMap.get(node);
            const type = services.getTypeAtLocation(node);
            const normalized = type ? (checker.getBaseTypeOfLiteralType(type) ?? type) : undefined;
            seen.push({
              hasFullTypeInformation: services.hasFullTypeInformation,
              hasEstreeToTsNode: services.esTreeNodeToTSNodeMap.has(node),
              hasTsNodeToEstree: services.tsNodeToESTreeNodeMap.has(tsNode),
              roundTripsToEstree: services.tsNodeToESTreeNodeMap.get(tsNode) === node,
              typeText: normalized ? checker.typeToString(normalized) : undefined,
              symbolName: services.getSymbolAtLocation(node)?.name,
            });
            context.report({ node, messageId: "fired" });
          },
        };
      },
    });

    const tester = new RuleTester({
      settings: {
        corsaOxlint: {
          parserOptions: {
            corsa: {
              executable: realCorsaBinary,
            },
          },
        },
      },
    });

    tester.run("type-service-probe", rule as any, {
      valid: [],
      invalid: [
        {
          code: 'const value = "text"; value;',
          errors: [{ messageId: "fired" }, { messageId: "fired" }],
        },
      ],
    });

    expect(seen).toHaveLength(2);
    for (const observation of seen) {
      expect(observation).toEqual({
        hasFullTypeInformation: true,
        hasEstreeToTsNode: true,
        hasTsNodeToEstree: true,
        roundTripsToEstree: true,
        typeText: "string",
        symbolName: "value",
      });
    }
  });

  integrationCase("exposes using declarations to custom type-aware RuleTester rules", () => {
    const seen: Record<string, unknown>[] = [];
    const rule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`)({
      name: "using-type-service-probe",
      meta: {
        type: "problem",
        docs: {
          description: "exercise parser services on explicit resource management declarations",
          recommended: "recommended",
          requiresTypeChecking: true,
        },
        messages: {
          fired: "using type service probe fired",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          VariableDeclaration(node: any) {
            if (node.kind !== "using") {
              return;
            }
            const identifier = node.declarations[0]?.id;
            if (identifier?.type !== "Identifier") {
              return;
            }
            const tsNode = services.esTreeNodeToTSNodeMap.get(identifier);
            const type = services.getTypeAtLocation(identifier);
            const normalized = type ? (checker.getBaseTypeOfLiteralType(type) ?? type) : undefined;
            seen.push({
              declarationKind: node.kind,
              hasFullTypeInformation: services.hasFullTypeInformation,
              hasEstreeToTsNode: services.esTreeNodeToTSNodeMap.has(identifier),
              hasTsNodeToEstree: services.tsNodeToESTreeNodeMap.has(tsNode),
              roundTripsToEstree: services.tsNodeToESTreeNodeMap.get(tsNode) === identifier,
              typeText: normalized ? checker.typeToString(normalized) : undefined,
              symbolName: services.getSymbolAtLocation(identifier)?.name,
            });
            context.report({ node: identifier, messageId: "fired" });
          },
        };
      },
    });

    const tester = new RuleTester({
      settings: {
        corsaOxlint: {
          parserOptions: {
            corsa: {
              executable: realCorsaBinary,
            },
          },
        },
      },
    });

    tester.run("using-type-service-probe", rule as any, {
      valid: [],
      invalid: [
        {
          code: [
            "interface SymbolConstructor { readonly dispose: unique symbol; }",
            "type DisposableResource = {",
            "  readonly label: string;",
            "  [Symbol.dispose](): void;",
            "};",
            "declare const resource: DisposableResource;",
            "function inspect() {",
            "  using value = resource;",
            "  value.label;",
            "}",
          ].join("\n"),
          errors: [{ messageId: "fired" }],
        },
      ],
    });

    expect(seen).toEqual([
      {
        declarationKind: "using",
        hasFullTypeInformation: true,
        hasEstreeToTsNode: true,
        hasTsNodeToEstree: true,
        roundTripsToEstree: true,
        typeText: "DisposableResource",
        symbolName: "value",
      },
    ]);
  });

  integrationCase("keeps type-aware RuleTester cases in the shared default project", () => {
    const rule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`)({
      name: "class-type-probe",
      meta: {
        type: "problem",
        docs: {
          description: "exercise getTypeAtLocation inside RuleTester",
          recommended: "recommended",
          requiresTypeChecking: true,
        },
        messages: {
          fired: "type-aware probe fired",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        return {
          ClassDeclaration(node: any) {
            services.getTypeAtLocation(node);
            context.report({ node, messageId: "fired" });
          },
        };
      },
    });

    const tester = new RuleTester({
      settings: {
        corsaOxlint: {
          parserOptions: {
            corsa: {
              executable: realCorsaBinary,
            },
          },
        },
      },
    });

    tester.run("class-type-probe", rule as any, {
      valid: ["const x = 1;"],
      invalid: [
        {
          code: "class C {}",
          errors: [{ messageId: "fired" }],
        },
      ],
    });
  });

  integrationCase("isolates type-aware RuleTester cases from sibling declarations", () => {
    const seen = new Map<string, string[]>();
    const rule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`)({
      name: "constructor-parameter-probe",
      meta: {
        type: "problem",
        docs: {
          description: "record constructor parameter symbols per case",
          recommended: "recommended",
          requiresTypeChecking: true,
        },
        messages: {
          fired: "type-aware probe fired",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          NewExpression(node: any) {
            const constructType = services.getTypeAtLocation(node.callee);
            const signature = constructType
              ? checker.getSignaturesOfType(constructType, 1)[0]
              : undefined;
            seen.set(
              context.filename,
              (signature?.parameterSymbols ?? []).map((symbol: any) => symbol.name),
            );
          },
        };
      },
    });

    const tester = new RuleTester({
      settings: {
        corsaOxlint: {
          parserOptions: {
            corsa: {
              executable: realCorsaBinary,
            },
          },
        },
      },
    });

    tester.run("constructor-parameter-probe", rule as any, {
      valid: [
        {
          code: [
            "class Base {}",
            "class Foo extends Base {",
            "  constructor(first: any, siblingParam: string) {",
            "    super();",
            "  }",
            "}",
            'new Foo("a", "b");',
          ].join("\n"),
        },
        {
          code: [
            "class Base {}",
            "class Foo extends Base {",
            "  constructor(first: any, actualParam: string) {",
            "    super();",
            "  }",
            "}",
            'new Foo("a", "b");',
          ].join("\n"),
        },
      ],
      invalid: [],
    });

    expect(Array.from(seen.values())).toEqual([
      ["first", "siblingParam"],
      ["first", "actualParam"],
    ]);
  });
});

function createTypeScriptPackage(): { packageRoot: string; executable: string } {
  const packageRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-runtime-"));
  cleanupDirs.add(packageRoot);
  return { packageRoot, executable: writeTypeScriptInstall(packageRoot) };
}

/**
 * Writes a `typescript` 7 install under `root` — the meta package plus the
 * platform package npm pulls in as an optional dependency — and returns the
 * executable resolution is expected to pick.
 *
 * These tests exercise the host platform, so the platform package has to be
 * there: it is the native runtime, and the meta package on its own carries
 * only the Node entrypoints.
 */
function writeTypeScriptInstall(root: string): string {
  const packageDir = resolve(root, "node_modules/typescript");
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    resolve(packageDir, "package.json"),
    JSON.stringify({ name: "typescript", version: "7.0.2" }),
  );

  const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`;
  const platformDir = resolve(root, "node_modules", platformPackage);
  const platformBin = resolve(platformDir, "lib", process.platform === "win32" ? "tsc.exe" : "tsc");
  mkdirSync(dirname(platformBin), { recursive: true });
  writeFileSync(
    resolve(platformDir, "package.json"),
    JSON.stringify({ name: platformPackage, version: "7.0.2" }),
  );
  writeFileSync(platformBin, "");
  return realpathSync(platformBin);
}
