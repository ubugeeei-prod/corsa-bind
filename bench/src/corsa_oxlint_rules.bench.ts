import { bench, describe } from "vitest";

import type { ApiMode } from "@corsa-bind/napi";

import { corsaOxlintRules } from "corsa-oxlint/rules";

import {
  ensureBenchInputs,
  corsaPath,
  corsaOxlintConfigPath,
  corsaOxlintFixtureDir,
  corsaOxlintFilePath,
  corsaOxlintSourceText,
  workspaceRoot,
} from "./support";

ensureBenchInputs();

const plusExpression = "lhs + rhs";
const sortExpression = "values.sort()";
const rejectExpression = 'Promise.reject(new Error("boom"))';
const unsafeAssignmentExpression = "assigned: Set<string> = unsafeSet";
const unsafeReturnExpression = "return promiseValue;";
const baseToStringExpression = "String({ value: 1 })";
const startsWithExpression = "text.slice(0, prefix.length) === prefix";
const unsafeAssignmentNode = createUnsafeAssignmentNode();
const unsafeReturnOwner = createUnsafeReturnOwner();
const unsafeReturnNode = createUnsafeReturnNode();
const baseToStringNode = createBaseToStringNode();
const startsWithNode = createStartsWithNode();

for (const mode of ["msgpack", "jsonrpc"] as const) {
  describe(`corsa-oxlint/rules ${mode}`, () => {
    const restrictContext = createContext(mode, [{ allowNumberAndString: false }]);
    const restrictVisitors = (corsaOxlintRules["restrict-plus-operands"] as any).create(
      restrictContext,
    );
    const sortContext = createContext(mode);
    const sortVisitors = (corsaOxlintRules["require-array-sort-compare"] as any).create(
      sortContext,
    );
    const rejectContext = createContext(mode);
    const rejectVisitors = (corsaOxlintRules["prefer-promise-reject-errors"] as any).create(
      rejectContext,
    );
    const unsafeAssignmentContext = createContext(mode);
    const unsafeAssignmentVisitors = (corsaOxlintRules["no-unsafe-assignment"] as any).create(
      unsafeAssignmentContext,
    );
    const unsafeReturnContext = createContext(
      mode,
      [],
      new Map([[unsafeReturnNode, [unsafeReturnOwner]]]),
    );
    const unsafeReturnVisitors = (corsaOxlintRules["no-unsafe-return"] as any).create(
      unsafeReturnContext,
    );
    const baseToStringContext = createContext(mode);
    const baseToStringVisitors = (corsaOxlintRules["no-base-to-string"] as any).create(
      baseToStringContext,
    );
    const startsWithContext = createContext(mode);
    const startsWithVisitors = (corsaOxlintRules["prefer-string-starts-ends-with"] as any).create(
      startsWithContext,
    );

    bench("restrict-plus-operands visitor", () => {
      restrictVisitors.BinaryExpression(createPlusNode());
    });

    bench("require-array-sort-compare visitor", () => {
      sortVisitors.CallExpression(createSortNode());
    });

    bench("prefer-promise-reject-errors visitor", () => {
      rejectVisitors.CallExpression(createRejectNode());
    });

    bench("no-unsafe-assignment visitor", () => {
      unsafeAssignmentVisitors.VariableDeclarator(unsafeAssignmentNode);
    });

    bench("no-unsafe-return visitor", () => {
      unsafeReturnVisitors.ReturnStatement(unsafeReturnNode);
    });

    bench("no-base-to-string visitor", () => {
      baseToStringVisitors.CallExpression(baseToStringNode);
    });

    bench("prefer-string-starts-ends-with visitor", () => {
      startsWithVisitors.BinaryExpression(startsWithNode);
    });
  });
}

function createContext(
  mode: ApiMode,
  options: readonly unknown[] = [],
  ancestors = new Map<object, readonly unknown[]>(),
) {
  return {
    cwd: corsaOxlintFixtureDir,
    filename: corsaOxlintFilePath,
    options,
    report() {},
    settings: {
      corsaOxlint: {
        parserOptions: {
          project: [corsaOxlintConfigPath],
          tsconfigRootDir: corsaOxlintFixtureDir,
          corsa: {
            executable: corsaPath,
            cwd: workspaceRoot,
            cacheLifetimeMs: 60_000,
            mode,
          },
        },
      },
    },
    sourceCode: {
      text: corsaOxlintSourceText,
      getAncestors(node: object) {
        return (ancestors.get(node) ?? []) as any[];
      },
      getText(node?: { range?: readonly [number, number] }) {
        if (!node?.range) {
          return corsaOxlintSourceText;
        }
        return corsaOxlintSourceText.slice(node.range[0], node.range[1]);
      },
    },
  };
}

function createPlusNode() {
  const offset = corsaOxlintSourceText.indexOf(plusExpression);
  return {
    type: "BinaryExpression",
    operator: "+",
    left: createIdentifier("lhs", offset, offset + 3),
    right: createIdentifier("rhs", offset + 6, offset + 9),
    range: [offset, offset + plusExpression.length] as const,
  };
}

function createSortNode() {
  const offset = corsaOxlintSourceText.indexOf(sortExpression);
  const valuesStart = offset;
  const valuesEnd = valuesStart + "values".length;
  const sortStart = corsaOxlintSourceText.indexOf("sort", valuesEnd);
  const sortEnd = sortStart + "sort".length;
  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      computed: false,
      object: createIdentifier("values", valuesStart, valuesEnd),
      property: createIdentifier("sort", sortStart, sortEnd),
      range: [valuesStart, sortEnd] as const,
    },
    arguments: [],
    range: [offset, offset + sortExpression.length] as const,
  };
}

function createRejectNode() {
  const offset = corsaOxlintSourceText.indexOf(rejectExpression);
  const promiseStart = offset;
  const promiseEnd = promiseStart + "Promise".length;
  const rejectStart = corsaOxlintSourceText.indexOf("reject", promiseEnd);
  const rejectEnd = rejectStart + "reject".length;
  const errorStart = corsaOxlintSourceText.indexOf("new Error", rejectEnd);
  const errorEnd = errorStart + 'new Error("boom")'.length;
  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      computed: false,
      object: createIdentifier("Promise", promiseStart, promiseEnd),
      property: createIdentifier("reject", rejectStart, rejectEnd),
      range: [promiseStart, rejectEnd] as const,
    },
    arguments: [
      {
        type: "NewExpression",
        callee: createIdentifier("Error", errorStart + 4, errorStart + 9),
        arguments: [
          {
            type: "Literal",
            value: "boom",
            range: [errorStart + 10, errorEnd - 1] as const,
          },
        ],
        range: [errorStart, errorEnd] as const,
      },
    ],
    range: [offset, offset + rejectExpression.length] as const,
  };
}

function createUnsafeAssignmentNode() {
  const offset = corsaOxlintSourceText.indexOf(unsafeAssignmentExpression);
  const idStart = offset;
  const idEnd = idStart + "assigned".length;
  const annotationStart = corsaOxlintSourceText.indexOf("Set<string>", idEnd);
  const annotationEnd = annotationStart + "Set<string>".length;
  const initStart = corsaOxlintSourceText.indexOf("unsafeSet", annotationEnd);
  const initEnd = initStart + "unsafeSet".length;

  return {
    type: "VariableDeclarator",
    id: {
      type: "Identifier",
      name: "assigned",
      range: [idStart, idEnd] as const,
      typeAnnotation: {
        type: "TSTypeAnnotation",
        range: [annotationStart - 2, annotationEnd] as const,
        typeAnnotation: {
          type: "TSTypeReference",
          range: [annotationStart, annotationEnd] as const,
        },
      },
    },
    init: createIdentifier("unsafeSet", initStart, initEnd),
    range: [idStart, initEnd] as const,
  };
}

function createUnsafeReturnOwner() {
  const signature = "unsafeReturnBench(): Promise<string>";
  const signatureStart = corsaOxlintSourceText.indexOf(signature);
  const annotationStart = corsaOxlintSourceText.indexOf("Promise<string>", signatureStart);
  const annotationEnd = annotationStart + "Promise<string>".length;
  return {
    type: "FunctionDeclaration",
    range: [signatureStart, annotationEnd] as const,
    returnType: {
      type: "TSTypeAnnotation",
      range: [annotationStart - 2, annotationEnd] as const,
      typeAnnotation: {
        type: "TSTypeReference",
        range: [annotationStart, annotationEnd] as const,
      },
    },
  };
}

function createUnsafeReturnNode() {
  const offset = corsaOxlintSourceText.indexOf(unsafeReturnExpression);
  const argumentStart = corsaOxlintSourceText.indexOf("promiseValue", offset);
  const argumentEnd = argumentStart + "promiseValue".length;
  return {
    type: "ReturnStatement",
    argument: createIdentifier("promiseValue", argumentStart, argumentEnd),
    range: [offset, offset + unsafeReturnExpression.length] as const,
  };
}

function createBaseToStringNode() {
  const offset = corsaOxlintSourceText.indexOf(baseToStringExpression);
  const calleeStart = offset;
  const calleeEnd = calleeStart + "String".length;
  const objectStart = corsaOxlintSourceText.indexOf("{ value: 1 }", calleeEnd);
  const objectEnd = objectStart + "{ value: 1 }".length;
  return {
    type: "CallExpression",
    callee: createIdentifier("String", calleeStart, calleeEnd),
    arguments: [
      {
        type: "ObjectExpression",
        range: [objectStart, objectEnd] as const,
      },
    ],
    range: [offset, offset + baseToStringExpression.length] as const,
  };
}

function createStartsWithNode() {
  const offset = corsaOxlintSourceText.indexOf(startsWithExpression);
  const textStart = offset;
  const textEnd = textStart + "text".length;
  const sliceStart = corsaOxlintSourceText.indexOf("slice", textEnd);
  const sliceEnd = sliceStart + "slice".length;
  const prefixLengthStart = corsaOxlintSourceText.indexOf("prefix.length", sliceEnd);
  const prefixLengthEnd = prefixLengthStart + "prefix.length".length;
  const prefixStart = corsaOxlintSourceText.lastIndexOf(
    "prefix",
    offset + startsWithExpression.length,
  );
  const prefixEnd = prefixStart + "prefix".length;

  return {
    type: "BinaryExpression",
    operator: "===",
    left: {
      type: "CallExpression",
      callee: {
        type: "MemberExpression",
        computed: false,
        object: createIdentifier("text", textStart, textEnd),
        property: createIdentifier("slice", sliceStart, sliceEnd),
        range: [textStart, sliceEnd] as const,
      },
      arguments: [
        {
          type: "Literal",
          value: 0,
          range: [
            corsaOxlintSourceText.indexOf("0", sliceEnd),
            corsaOxlintSourceText.indexOf("0", sliceEnd) + 1,
          ] as const,
        },
        {
          type: "MemberExpression",
          computed: false,
          object: createIdentifier(
            "prefix",
            prefixLengthStart,
            prefixLengthStart + "prefix".length,
          ),
          property: createIdentifier("length", prefixLengthEnd - "length".length, prefixLengthEnd),
          range: [prefixLengthStart, prefixLengthEnd] as const,
        },
      ],
      range: [textStart, prefixLengthEnd + 1] as const,
    },
    right: createIdentifier("prefix", prefixStart, prefixEnd),
    range: [offset, offset + startsWithExpression.length] as const,
  };
}

function createIdentifier(name: string, pos: number, end: number) {
  return {
    type: "Identifier",
    name,
    range: [pos, end] as const,
  };
}
