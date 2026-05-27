import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultCorsaExecutable } from "./context";
import { createTypeChecker } from "./checker";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realCorsaBinary = defaultCorsaExecutable(workspaceRoot);
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const mockBinary = resolve(workspaceRoot, `target/debug/mock_corsa${executableSuffix}`);
const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;

describe("corsa oxlint type locations", () => {
  integrationCase("resolves types from declaration wrapper nodes", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "wrapper-node-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise wrapper node type lookup",
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
            if (node.key?.name !== "label") {
              return;
            }
            const fromNode = checker.getTypeAtLocation(node);
            const fromKey = checker.getTypeAtLocation(node.key);
            seen.propertyFromNode = fromNode ? checker.typeToString(fromNode) : undefined;
            seen.propertyFromKey = fromKey ? checker.typeToString(fromKey) : undefined;
          },
          ClassDeclaration(node: any) {
            if (node.id?.name !== "ChildClass") {
              return;
            }
            const fromNode = checker.getTypeAtLocation(node);
            const fromId = checker.getTypeAtLocation(node.id);
            seen.classFromNode = fromNode ? checker.typeToString(fromNode) : undefined;
            seen.classFromId = fromId ? checker.typeToString(fromId) : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("wrapper-node-types", rule as any, {
      valid: [
        {
          code: ["interface Demo {", "  readonly label: string;", "}", "class ChildClass {}"].join(
            "\n",
          ),
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

    expect(seen.propertyFromNode).toBe("string");
    expect(seen.propertyFromNode).toBe(seen.propertyFromKey);
    expect(seen.classFromNode).toBeDefined();
    expect(seen.classFromNode).not.toBe("any");
    expect(seen.classFromNode).toBe(seen.classFromId);
  });

  integrationCase("resolves symbol and node handles exposed by signatures and types", () => {
    const seen: Record<string, unknown> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "symbol-handle-resolution",
      meta: {
        type: "problem",
        docs: {
          description: "exercise symbol and node handle resolution",
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
            if (node.callee?.name !== "Construct") {
              return;
            }
            const onNode = checker.getTypeAtLocation(node);
            const type = checker.getTypeAtLocation(node.callee);
            if (!type) {
              return;
            }
            seen.newExpressionType = onNode ? checker.typeToString(onNode) : undefined;
            const signature = checker.getSignaturesOfType(type, 1)[0];
            seen.parameterNames = signature?.parameters.map(
              (id) => checker.getSymbolById(id)?.name,
            );
            const symbol = type.symbol ? checker.getSymbol(type.symbol) : undefined;
            seen.typeSymbolName = symbol?.name;
            const declarationNode = symbol?.valueDeclaration
              ? checker.getNode(symbol.valueDeclaration)
              : undefined;
            seen.declarationText = declarationNode
              ? context.sourceCode.text.slice(declarationNode.pos, declarationNode.end)
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("symbol-handle-resolution", rule as any, {
      valid: [
        {
          code: [
            "type IDependable = { __d?: 1 };",
            "type IMixin = { __x?: 1 };",
            "/**",
            " * Represents a construct.",
            " */",
            "interface IConstruct extends IDependable {",
            "  /**",
            "   * The tree node.",
            "   */",
            "  readonly node: Node;",
            "  /**",
            "   * Applies one or more mixins to this construct.",
            "   *",
            "   * Mixins are applied in order. The list of constructs is captured at the",
            "   * start of the call, so constructs added by a mixin will not be visited.",
            "   *",
            "   * @param mixins The mixins to apply",
            "   * @returns This construct for chaining",
            "   */",
            "  with(...mixins: IMixin[]): IConstruct;",
            "}",
            "/**",
            " * Represents the construct node in the scope tree.",
            " */",
            "declare class Node {",
            "  private readonly host;",
            "  /**",
            "   * Separator used to delimit construct path components.",
            "   */",
            '  static readonly PATH_SEP = "/";',
            "  /**",
            "   * Returns the node associated with a construct.",
            "   * @param construct the construct",
            "   *",
            "   * @deprecated use `construct.node` instead",
            "   */",
            "  static of(construct: IConstruct): Node;",
            "  /**",
            "   * Returns the scope in which this construct is defined.",
            "   *",
            "   * The value is `undefined` at the root of the construct scope tree.",
            "   */",
            "  readonly scope?: IConstruct;",
            "  /**",
            "   * The id of this construct within the current scope.",
            "   *",
            "   * This is a scope-unique id. To obtain an app-unique id for this construct, use `addr`.",
            "   */",
            "  readonly id: string;",
            "  constructor(host: Construct, scope: IConstruct, id: string);",
            "}",
            "/**",
            " * Represents the building block of the construct graph.",
            " *",
            " * All constructs besides the root construct must be created within the scope of",
            " * another construct.",
            " */",
            "declare class Construct implements IConstruct {",
            "  /**",
            "   * Checks if `x` is a construct.",
            "   *",
            "   * Use this method instead of `instanceof` to properly detect `Construct`",
            "   * instances, even when the construct library is symlinked.",
            "   */",
            "  static isConstruct(x: any): x is Construct;",
            "  /**",
            "   * The tree node.",
            "   */",
            "  readonly node: Node;",
            "  /**",
            "   * Creates a new construct node.",
            "   *",
            "   * @param scope The scope in which to define this construct",
            "   * @param id The scoped construct ID. Must be unique amongst siblings. If",
            "   * the ID includes a path separator (`/`), then it will be replaced by double",
            "   * dash `--`.",
            "   */",
            "  constructor(scope: Construct, id: string);",
            "  /**",
            "   * Applies one or more mixins to this construct.",
            "   */",
            "  with(...mixins: IMixin[]): IConstruct;",
            "  /**",
            "   * Returns a string representation of this construct.",
            "   */",
            "  toString(): string;",
            "}",
            "declare const scope: Construct;",
            'new Construct(scope, "x");',
          ].join("\n"),
          settings: {
            corsaOxlint: {
              parserOptions: {
                corsa: {
                  executable: realCorsaBinary,
                  mode: "jsonrpc",
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    expect(seen.parameterNames).toEqual(["scope", "id"]);
    expect(seen.newExpressionType).toBe("Construct");
    expect(seen.typeSymbolName).toBe("Construct");
    expect(seen.declarationText).toContain("class Construct");
  });

  integrationCase("resolves constructor parameter symbols from dependency declarations", () => {
    const workspace = mkdtempSync(resolve(tmpdir(), "corsa-oxlint-external-symbols-"));
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
        "export interface IConstruct {",
        "  readonly node: unknown;",
        "}",
        "export interface StackProps {",
        "  readonly stackName?: string;",
        "}",
        "export interface ITaggable {",
        "  readonly tags: unknown;",
        "}",
        "/**",
        " * Represents the building block of the construct graph.",
        " *",
        " * All constructs besides the root construct must be created within the scope of",
        " * another construct.",
        " */",
        "export declare class Construct implements IConstruct {",
        "  readonly node: unknown;",
        "  constructor(scope: Construct, id: string);",
        "}",
        "/**",
        " * A root construct which represents a single CloudFormation stack.",
        " */",
        "export declare class Stack extends Construct implements ITaggable {",
        "  /**",
        "   * Tags to be applied to the stack.",
        "   */",
        "  readonly tags: unknown;",
        "  private readonly _logicalIds;",
        "  private readonly _stackDependencies;",
        "  private readonly _missingContext;",
        "  private readonly _stackName;",
        "  /**",
        "   * Creates a new stack.",
        "   *",
        "   * @param scope Parent of this stack, usually an `App` or a `Stage`, but could be any construct.",
        "   * @param id The construct ID of this stack. If `stackName` is not explicitly",
        "   * defined, this id (and any parent IDs) will be used to determine the",
        "   * physical ID of the stack.",
        "   * @param props Stack properties.",
        "   */",
        "  constructor(scope?: Construct, id?: string, props?: StackProps);",
        "}",
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
    const sourceText = [
      'import { Construct, Stack } from "external-dep";',
      "declare const scope: Construct;",
      'new Stack(scope, "x", { stackName: "demo" });',
    ].join("\n");
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
    const constructIndex = sourceText.indexOf("Stack(scope");
    const callee = {
      fileName: filename,
      pos: constructIndex,
      end: constructIndex + "Stack".length,
      range: [constructIndex, constructIndex + "Stack".length] as const,
    };
    const constructType = checker.getTypeAtLocation(callee);
    expect(constructType ? checker.typeToString(constructType) : undefined).toBe("typeof Stack");
    const signature = constructType ? checker.getSignaturesOfType(constructType, 1)[0] : undefined;

    expect(signature?.parameters.map((id) => checker.getSymbolById(id)?.name)).toEqual([
      "scope",
      "id",
      "props",
    ]);
  });

  integrationCase("resolves the symbol type at a location instead of the node type", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "symbol-type-at-location",
      meta: {
        type: "problem",
        docs: {
          description: "exercise getTypeOfSymbolAtLocation",
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
            const type = checker.getTypeAtLocation(node);
            if (!type) {
              return;
            }
            const property = checker
              .getPropertiesOfType(type)
              .find((symbol) => symbol.name === "myProp");
            if (!property) {
              return;
            }
            const atLocation = checker.getTypeOfSymbolAtLocation(property, node);
            const ofSymbol = checker.getTypeOfSymbol(property);
            if (!atLocation || !ofSymbol) {
              return;
            }
            seen.atLocation = checker.typeToString(atLocation);
            seen.ofSymbol = checker.typeToString(ofSymbol);
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("symbol-type-at-location", rule as any, {
      valid: [
        {
          code: [
            "interface MyPropType {",
            "  x: string;",
            "}",
            "class SomeClass {",
            '  myProp: MyPropType = { x: "" };',
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

    expect(seen.atLocation).toBe("MyPropType");
    expect(seen.ofSymbol).toBe("MyPropType");
  });

  integrationCase("exposes constituent and mapped type traversal helpers", () => {
    const seen: Record<
      string,
      {
        args: readonly string[];
        parts: readonly string[];
        baseTypes: readonly string[];
        target?: string;
        isUnion: boolean;
        isIntersection: boolean;
      }
    > = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "type-relation-accessors",
      meta: {
        type: "problem",
        docs: {
          description: "exercise type relation accessors",
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
            if (!type) {
              return;
            }
            const baseTypes = checker.getBaseTypes(type).map((part) => checker.typeToString(part));
            const target = checker.getTargetOfType(type);
            seen[keyName] = {
              args: checker
                .getTypeArguments(type)
                .map((argument) => checker.typeToString(argument)),
              baseTypes,
              parts: checker.getTypesOfType(type).map((part) => checker.typeToString(part)),
              target: target ? checker.typeToString(target) : undefined,
              isUnion: checker.isUnionType(type),
              isIntersection: checker.isIntersectionType(type),
            };
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("type-relation-accessors", rule as any, {
      valid: [
        {
          code: [
            "interface Wrapper<T> {",
            "  value: T;",
            "}",
            "class Foo { value = 1; }",
            "interface Bag {",
            "  arr: Foo[];",
            "  tup: [Foo, number];",
            "  wrapped: Wrapper<string>;",
            "  union: Foo | string;",
            "  intersection: Foo & { x: number };",
            "  mapped: Readonly<Foo>;",
            "}",
          ].join("\n"),
          settings: {
            corsaOxlint: {
              parserOptions: {
                corsa: {
                  executable: realCorsaBinary,
                  mode: "jsonrpc",
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    expect(seen.arr.args).toEqual(["Foo"]);
    expect(seen.arr.baseTypes).toEqual([]);
    expect(seen.tup.baseTypes).toEqual([]);
    expect(seen.wrapped.baseTypes).toEqual([]);
    expect(seen.union.isUnion).toBe(true);
    expect(seen.union.parts).toEqual(expect.arrayContaining(["Foo", "string"]));
    expect(seen.intersection.isIntersection).toBe(true);
    expect(seen.intersection.parts).toEqual(expect.arrayContaining(["Foo", "{ x: number; }"]));
    expect(seen.mapped.args).toEqual(["Foo"]);
    expect(seen.mapped.target).toBe("Readonly<T>");
  });

  it("sends linted source text overlay changes when it differs from disk", () => {
    const workspace = mkdtempSync(resolve(tmpdir(), "corsa-oxlint-overlay-"));
    const srcDir = resolve(workspace, "src");
    mkdirSync(srcDir, { recursive: true });
    const filename = resolve(srcDir, "fixture.ts");
    const diskText = "const value: number = 1;\n";
    writeFileSync(filename, diskText);
    writeFileSync(
      resolve(workspace, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
    );
    const paramsDir = resolve(workspace, "params");
    const previousParamsDir = process.env.CORSA_MOCK_PARAMS_DIR;
    process.env.CORSA_MOCK_PARAMS_DIR = paramsDir;
    try {
      const text = "const value: string = 'memory';\n";
      const checker = createTypeChecker({
        cwd: workspace,
        filename,
        settings: {
          corsaOxlint: {
            parserOptions: {
              project: ["tsconfig.json"],
              corsa: {
                executable: mockBinary,
                cwd: workspace,
                mode: "jsonrpc",
              },
            },
          },
        },
        sourceCode: {
          text,
        },
      } as any);

      checker.getTypeAtLocation({ type: "Identifier", range: [6, 11] } as any);

      const diskChecker = createTypeChecker({
        cwd: workspace,
        filename,
        settings: {
          corsaOxlint: {
            parserOptions: {
              project: ["tsconfig.json"],
              corsa: {
                executable: mockBinary,
                cwd: workspace,
                mode: "jsonrpc",
              },
            },
          },
        },
        sourceCode: {
          text: diskText,
        },
      } as any);

      diskChecker.getTypeAtLocation({ type: "Identifier", range: [6, 11] } as any);

      const updates = readFileSync(resolve(paramsDir, "updateSnapshot.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(updates.at(-2)?.overlayChanges?.upsert?.[0]).toMatchObject({
        document: filename,
        text,
        languageId: "typescript",
      });
      expect(updates.at(-1)?.overlayChanges?.delete).toEqual([filename]);
    } finally {
      if (previousParamsDir === undefined) {
        delete process.env.CORSA_MOCK_PARAMS_DIR;
      } else {
        process.env.CORSA_MOCK_PARAMS_DIR = previousParamsDir;
      }
    }
  });
});
