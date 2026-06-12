import { describe, expect, expectTypeOf, it } from "vitest";

import { AST_NODE_TYPES, defineRule, OxlintUtils, type ESTree, type RuleDocs } from "./index";

describe("corsa oxlint public types", () => {
  it("surfaces requiresTypeChecking on rule docs", () => {
    const docs = {
      description: "typed docs",
      requiresTypeChecking: true,
    } satisfies RuleDocs;

    defineRule({
      meta: {
        type: "problem",
        docs,
        messages: {
          demo: "demo",
        },
        schema: [],
      },
      create() {
        return {};
      },
    });

    defineRule({
      meta: {
        docs: {
          // @ts-expect-error requiresTypeChecking is intentionally misspelled.
          requiresTypeCheckng: true,
        },
        messages: {
          demo: "demo",
        },
      },
      create() {
        return {};
      },
    });

    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/${name}`);
    const created = createRule({
      name: "typed-docs",
      meta: {
        docs: {
          requiresTypeChecking: true,
        },
        messages: {
          demo: "demo",
        },
      },
      create() {
        return {};
      },
    });

    const requiresTypeChecking: boolean | undefined = created.meta.docs.requiresTypeChecking;
    expect(requiresTypeChecking).toBe(true);
    expect(created.meta.docs.url).toBe("https://example.com/typed-docs");
  });

  it("narrows ESTree.Node through AST_NODE_TYPES checks", () => {
    function narrow(node: ESTree.Node): void {
      if (node.type === AST_NODE_TYPES.PropertyDefinition) {
        expectTypeOf(node).toMatchTypeOf<ESTree.PropertyDefinition>();
      }
      if (node.type === AST_NODE_TYPES.ClassDeclaration) {
        expectTypeOf(node).toMatchTypeOf<ESTree.ClassDeclaration>();
      }
    }

    expect(narrow).toBeTypeOf("function");
  });

  it("keeps tree-walking fields on public ESTree nodes", () => {
    function acceptNode(node: ESTree.Node): void {
      void node;
    }

    function acceptClassBody(node: ESTree.ClassBody): void {
      void node;
    }

    function visit(node: ESTree.Node): void {
      if (node.parent) {
        acceptNode(node.parent);
      }
      if (node.type === AST_NODE_TYPES.ClassDeclaration) {
        acceptNode(node.body);
        acceptNode(node.body.parent);
        acceptClassBody(node.body);
        const member = node.body.body[0];
        if (member) {
          acceptNode(member);
          acceptNode(member.parent);
        }
      }
    }

    expect(visit).toBeTypeOf("function");
  });

  it("exports common ESTree union aliases", () => {
    function visitStatement<T extends ESTree.Statement>(statement: T): T {
      return statement;
    }
    function visitExpression<T extends ESTree.Expression>(expression: T): T {
      return expression;
    }
    function visitClassElement<T extends ESTree.ClassElement>(element: T): T {
      return element;
    }

    expectTypeOf<ESTree.Class>().toMatchTypeOf<ESTree.ClassDeclaration | ESTree.ClassExpression>();
    expectTypeOf<ESTree.Function>().toMatchTypeOf<
      | ESTree.FunctionDeclaration
      | ESTree.FunctionExpression
      | ESTree.TSDeclareFunction
      | ESTree.TSEmptyBodyFunctionExpression
    >();
    expectTypeOf<ESTree.ParamPattern>().toMatchTypeOf<
      ESTree.FormalParameter | ESTree.TSParameterProperty | ESTree.FormalParameterRest
    >();
    expect(visitStatement).toBeTypeOf("function");
    expect(visitExpression).toBeTypeOf("function");
    expect(visitClassElement).toBeTypeOf("function");
  });
});
