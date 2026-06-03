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

  integrationCase("resolves declared types for type reference nodes", () => {
    const seen: {
      readonly name: string;
      readonly whole?: string;
      readonly inner?: string;
      readonly declared?: string;
    }[] = [];
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "type-reference-node-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise type reference type lookup",
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
          TSTypeReference(node: any) {
            if (node.typeName?.type !== "Identifier") {
              return;
            }
            const whole = checker.getTypeAtLocation(node);
            const inner = checker.getTypeAtLocation(node.typeName);
            const symbol = checker.getSymbolAtLocation(node.typeName);
            const declared = symbol
              ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
              : undefined;
            seen.push({
              name: node.typeName.name,
              whole: whole ? checker.typeToString(whole) : undefined,
              inner: inner ? checker.typeToString(inner) : undefined,
              declared: declared ? checker.typeToString(declared) : undefined,
            });
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("type-reference-node-types", rule as any, {
      valid: [
        {
          code: [
            "class Foo {",
            '  readonly name: string = "";',
            "}",
            "interface IBar {",
            "  id: number;",
            "}",
            "interface Props {",
            "  foo: Foo;",
            "  bar: IBar;",
            "}",
            "function takesFoo(value: Foo): Foo {",
            "  return value;",
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

    expect(seen).toEqual([
      { name: "Foo", whole: "Foo", inner: "Foo", declared: "Foo" },
      { name: "IBar", whole: "IBar", inner: "IBar", declared: "IBar" },
      { name: "Foo", whole: "Foo", inner: "Foo", declared: "Foo" },
      { name: "Foo", whole: "Foo", inner: "Foo", declared: "Foo" },
    ]);
  });

  integrationCase("returns constraints for bounded type parameters", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "bounded-type-parameter-constraints",
      meta: {
        type: "problem",
        docs: {
          description: "exercise type parameter constraint lookup",
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
          TSTypeParameter(node: any) {
            const name = node.name?.name ?? node.name;
            if (name !== "TBound") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            const constraint = type ? checker.getConstraintOfType(type) : undefined;
            seen.declaration = constraint ? checker.typeToString(constraint) : undefined;
          },
          Identifier(node: any) {
            if (node.name !== "boundParam") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            const constraint = type ? checker.getConstraintOfType(type) : undefined;
            seen.usage = constraint ? checker.typeToString(constraint) : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("bounded-type-parameter-constraints", rule as any, {
      valid: [
        {
          code: [
            "class Foo {}",
            "function withBound<TBound extends Foo>(boundParam: TBound): TBound {",
            "  return boundParam;",
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

    expect(seen.declaration).toBe("Foo");
    expect(seen.usage).toBe("Foo");
  });

  integrationCase("resolves types from wrapper-like AST nodes", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "wrapper-like-node-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise wrapper-like node type lookup",
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
          ClassBody(node: any) {
            const header = context.sourceCode.text.slice(0, node.range[0]);
            const className = header.match(/\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{]*$/)?.[1];
            if (className !== "Foo") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.classBody = type ? checker.typeToString(type) : undefined;
          },
          PropertyDefinition(node: any) {
            if (node.key?.name !== "classField") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.classField = type ? checker.typeToString(type) : undefined;
          },
          TSParameterProperty(node: any) {
            if (node.parameter?.name !== "paramProp") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.paramProp = type ? checker.typeToString(type) : undefined;
          },
          MethodDefinition(node: any) {
            if (node.kind !== "constructor") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.constructorType = type ? checker.typeToString(type) : undefined;
          },
          TSAbstractMethodDefinition(node: any) {
            if (node.key?.name !== "sound") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.abstractMethod = type ? checker.typeToString(type) : undefined;
          },
          TSAsExpression(node: any) {
            if (node.typeAnnotation?.typeName?.name !== "Bar") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.asCast = type ? checker.typeToString(type) : undefined;
          },
          TSTypeAssertion(node: any) {
            const type = checker.getTypeAtLocation(node);
            seen.oldCast = type ? checker.typeToString(type) : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("wrapper-like-node-types", rule as any, {
      valid: [
        {
          code: [
            "abstract class Animal {",
            "  abstract sound(): string;",
            "}",
            "class Foo {",
            "  readonly classField: number = 0;",
            "  constructor(public readonly paramProp: boolean) {}",
            "  method(arg: string): void {}",
            "}",
            "class Bar {}",
            "const asCast = {} as Bar;",
            "const oldCast = <Bar>({} as any);",
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

    expect(seen.classBody).toBe("Foo");
    expect(seen.classField).toBe("number");
    expect(seen.paramProp).toBe("boolean");
    expect(seen.constructorType).toBeDefined();
    expect(seen.constructorType).not.toBe("any");
    expect(seen.abstractMethod).toBe("() => string");
    expect(seen.asCast).toBe("Bar");
    expect(seen.oldCast).toBe("Bar");
  });

  integrationCase("resolves static member expression types from the property", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "static-member-expression-type",
      meta: {
        type: "problem",
        docs: {
          description: "exercise static member expression type lookup",
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
          MemberExpression(node: any) {
            if (node.property?.name !== "STATIC_FIELD") {
              return;
            }
            const whole = checker.getTypeAtLocation(node);
            const property = checker.getTypeAtLocation(node.property);
            const object = checker.getTypeAtLocation(node.object);
            seen.whole = whole ? checker.typeToString(whole) : undefined;
            seen.property = property ? checker.typeToString(property) : undefined;
            seen.object = object ? checker.typeToString(object) : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("static-member-expression-type", rule as any, {
      valid: [
        {
          code: [
            "class Foo {",
            '  static STATIC_FIELD: string = "x";',
            "}",
            "const sUse = Foo.STATIC_FIELD;",
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

    expect(seen.whole).toBe("string");
    expect(seen.property).toBe("string");
    expect(seen.object).toBe("typeof Foo");
  });

  integrationCase("falls back for instantiated generic base types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "generic-base-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise generic base type fallback lookups",
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
            if (node.key?.name !== "pet") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.pet = type
              ? checker.getBaseTypes(type).map((base) => checker.typeToString(base))
              : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("generic-base-types", rule as any, {
      valid: [
        {
          code: [
            "class Animal {}",
            "class Dog<T extends string> extends Animal {",
            "  readonly breed!: T;",
            "}",
            "interface Container {",
            '  pet: Dog<"corgi">;',
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

    expect(seen.pet).toEqual(["Animal"]);
  });

  integrationCase("falls back for constructor and intersection base types", () => {
    const seen: Record<string, readonly string[] | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "non-instance-base-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise non-instance base type fallback lookups",
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
            if (node.id?.name !== "ctor") {
              return;
            }
            const type = checker.getTypeAtLocation(node.id);
            seen.constructorBases = type
              ? checker.getBaseTypes(type).map((base) => checker.typeToString(base))
              : undefined;
          },
          ClassDeclaration(node: any) {
            if (node.id?.name !== "MixedFoo") {
              return;
            }
            const type = checker.getTypeAtLocation(node.id);
            const directBases = type ? checker.getBaseTypes(type) : [];
            seen.mixedBases = directBases.map((base) => checker.typeToString(base));
            seen.intersectionBases = directBases.flatMap((base) =>
              checker.getBaseTypes(base).map((nestedBase) => checker.typeToString(nestedBase)),
            );
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("non-instance-base-types", rule as any, {
      valid: [
        {
          code: [
            "class Animal {}",
            "class Dog extends Animal {}",
            "const ctor = Dog;",
            "function Mixin<T extends new (...args: any[]) => {}>(Base: T) {",
            "  return class extends Base {",
            "    readonly mixed = true;",
            "  };",
            "}",
            "class MixedFoo extends Mixin(Animal) {}",
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

    expect(seen.constructorBases).toContain("Animal");
    expect(seen.mixedBases?.[0]).toContain("Animal");
    expect(seen.intersectionBases).toContain("Animal");
  });

  integrationCase("returns immediate instance type for superclass constructor types", () => {
    const seen: Record<string, { readonly name: string; readonly bases: readonly string[] }> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "superclass-constructor-base-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise superclass constructor type fallback lookups",
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
            if (!className || !node.superClass) {
              return;
            }
            const superType = checker.getTypeAtLocation(node.superClass);
            if (!superType) {
              return;
            }
            seen[className] = {
              name: checker.typeToString(superType),
              bases: checker.getBaseTypes(superType).map((base) => checker.typeToString(base)),
            };
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("superclass-constructor-base-types", rule as any, {
      valid: [
        {
          code: [
            "class Animal {}",
            "class Dog extends Animal {}",
            "class GoldenRetriever extends Dog {}",
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

    expect(seen.Dog?.name).toBe("typeof Animal");
    expect(seen.Dog?.bases).toContain("Animal");
    expect(seen.GoldenRetriever?.name).toBe("typeof Dog");
    expect(seen.GoldenRetriever?.bases[0]).toBe("Dog");
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

  integrationCase("resolves constructor parameter type texts from dependency declarations", () => {
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
        "   * Uses non-ASCII punctuation before the constructor: “ ”",
        "   */",
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

    expect(signature?.parameters).toHaveLength(3);
    expect(signature?.parameterTypeTexts).toEqual([
      ["Construct | undefined"],
      ["string | undefined"],
      ["StackProps | undefined"],
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

  integrationCase("exposes symbols from type handles", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "type-symbol-accessor",
      meta: {
        type: "problem",
        docs: {
          description: "exercise type to symbol lookup",
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
            if (node.key?.name !== "animal") {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            seen.animal = type ? checker.getSymbolOfType(type)?.name : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("type-symbol-accessor", rule as any, {
      valid: [
        {
          code: ["class Animal {}", "interface Bag {", "  animal: Animal;", "}"].join("\n"),
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

    expect(seen.animal).toBe("Animal");
  });

  integrationCase("does not expose corrupted mapped utility type symbols", () => {
    const seen: Record<
      string,
      | {
          readonly name: string | undefined;
          readonly codepoints: readonly number[] | null;
        }
      | undefined
    > = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "mapped-utility-type-symbols",
      meta: {
        type: "problem",
        docs: {
          description: "exercise mapped utility type symbols",
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
          PropertyDefinition(node: any) {
            const keyName = node.key?.name;
            if (!keyName) {
              return;
            }
            const type = checker.getTypeAtLocation(node);
            const symbol = type ? checker.getSymbolOfType(type) : undefined;
            seen[keyName] = {
              name: symbol?.name,
              codepoints: symbol ? [...symbol.name].map((char) => char.codePointAt(0) ?? 0) : null,
            };
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("mapped-utility-type-symbols", rule as any, {
      valid: [
        {
          code: [
            "class Animal {}",
            "interface IDog {",
            "  name: string;",
            "}",
            "class Dog extends Animal implements IDog {",
            '  readonly name: string = "Rex";',
            "}",
            "interface Box<T> {",
            "  value: T;",
            "}",
            "class Holder {",
            "  readonly readonlyDog: Readonly<Dog> = {} as Readonly<Dog>;",
            "  readonly partialDog: Partial<Dog> = {} as Partial<Dog>;",
            "  readonly requiredDog: Required<Dog> = {} as Required<Dog>;",
            "  readonly boxedDog: Box<Dog> = { value: {} as Dog };",
            "  readonly dogList: Dog[] = [];",
            "  readonly bareDog: Dog = {} as Dog;",
            '  readonly text: string = "";',
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

    for (const key of ["readonlyDog", "partialDog", "requiredDog"] as const) {
      expect(seen[key]?.codepoints ?? []).not.toContain(0xfffd);
    }
    expect([undefined, "Readonly"]).toContain(seen.readonlyDog?.name);
    expect([undefined, "Partial"]).toContain(seen.partialDog?.name);
    expect([undefined, "Required"]).toContain(seen.requiredDog?.name);
    expect(seen.boxedDog?.name).toBe("Box");
    expect(seen.dogList?.name).toBe("Array");
    expect(seen.bareDog?.name).toBe("Dog");
    expect(seen.text?.name).toBeUndefined();
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
