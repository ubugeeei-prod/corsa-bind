import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CorsaType } from "./types";

const mocks = vi.hoisted(() => {
  const typeParameterFlag = 1 << 19;
  const knownType = {
    __corsaOxlintKind: "type",
    id: "known-type",
    flags: 0,
    texts: ["Known"],
  } as CorsaType;
  const fallbackType = {
    __corsaOxlintKind: "type",
    id: "fallback-type",
    flags: 0,
    texts: ["boolean"],
  } as CorsaType;
  const callableType = {
    __corsaOxlintKind: "type",
    id: "callable-type",
    flags: 0,
    texts: ['(value: "a") => Target'],
  } as CorsaType;
  const literalArgumentType = {
    __corsaOxlintKind: "type",
    id: "literal-argument-type",
    flags: 0,
    texts: ['"a"'],
  } as CorsaType;
  const widenedArgumentType = {
    __corsaOxlintKind: "type",
    id: "widened-argument-type",
    flags: 0,
    texts: ["string"],
  } as CorsaType;
  const callReturnType = {
    __corsaOxlintKind: "type",
    id: "call-return-type",
    flags: 0,
    texts: ["Target"],
  } as CorsaType;
  const genericCallableType = {
    __corsaOxlintKind: "type",
    id: "generic-callable-type",
    flags: 0,
    texts: ["<T>(value: T) => T"],
  } as CorsaType;
  const genericReturnType = {
    __corsaOxlintKind: "type",
    id: "generic-return-type",
    flags: typeParameterFlag,
    texts: ["T"],
  } as CorsaType;
  const nullableType = {
    __corsaOxlintKind: "type",
    id: "nullable-type",
    flags: 0,
    texts: ["Target | undefined"],
  } as CorsaType;
  const nonNullableType = {
    __corsaOxlintKind: "type",
    id: "non-nullable-type",
    flags: 0,
    texts: ["Target"],
  } as CorsaType;
  const registryType = {
    __corsaOxlintKind: "type",
    id: "registry-type",
    flags: 0,
    texts: ["Registry"],
  } as CorsaType;
  const keyType = {
    __corsaOxlintKind: "type",
    id: "key-type",
    flags: 0,
    texts: ["string"],
  } as CorsaType;
  const indexedValueType = {
    __corsaOxlintKind: "type",
    id: "indexed-value-type",
    flags: 0,
    texts: ["Plain"],
  } as CorsaType;
  const tupleType = {
    __corsaOxlintKind: "type",
    id: "tuple-type",
    flags: 0,
    texts: ["readonly [Target, Plain]"],
  } as CorsaType;
  const tupleTargetType = {
    __corsaOxlintKind: "type",
    id: "tuple-target-type",
    flags: 0,
    texts: ["Target"],
  } as CorsaType;
  const tuplePlainType = {
    __corsaOxlintKind: "type",
    id: "tuple-plain-type",
    flags: 0,
    texts: ["Plain"],
  } as CorsaType;
  const numberIndexType = {
    __corsaOxlintKind: "type",
    id: "number-index-type",
    flags: 0,
    texts: ["number"],
  } as CorsaType;
  return {
    types: {
      callableType,
      literalArgumentType,
      widenedArgumentType,
      callReturnType,
      genericCallableType,
      genericReturnType,
      nullableType,
      nonNullableType,
      registryType,
      keyType,
      indexedValueType,
      tupleType,
      tupleTargetType,
      tuplePlainType,
      numberIndexType,
    },
    signature: { id: "signature-1", flags: 0, typeParameters: [], parameters: [] },
    session: {
      getTypeAtSourceRange: vi.fn(
        (
          _fileName: string,
          position: number,
          _end: number,
          _sourceText: string | undefined,
          nodeKind: string | undefined,
        ) => {
          if (nodeKind === "ConditionalExpression") {
            return fallbackType;
          }
          if (position === 0 && nodeKind === "Identifier") {
            return callableType;
          }
          if (position === 7 && nodeKind === "Literal") {
            return literalArgumentType;
          }
          if (position === 100 && nodeKind === "Identifier") {
            return nullableType;
          }
          if (position === 300 && nodeKind === "Identifier") {
            return genericCallableType;
          }
          if (position === 309 && nodeKind === "Identifier") {
            return callReturnType;
          }
          if (position === 200 && nodeKind === "Identifier") {
            return registryType;
          }
          if (position === 209 && nodeKind === "Identifier") {
            return keyType;
          }
          if (position === 400 && nodeKind === "Identifier") {
            return tupleType;
          }
          if (position === 406 && nodeKind === "Identifier") {
            return numberIndexType;
          }
          return position === 7 ? knownType : undefined;
        },
      ),
      getBaseTypeOfLiteralType: vi.fn((type: CorsaType) =>
        type.id === "literal-argument-type" ? widenedArgumentType : undefined,
      ),
      getCallSignatureFacts: vi.fn((type: CorsaType) => ({
        signature:
          type.id === "generic-callable-type"
            ? {
                id: "generic-signature",
                flags: 0,
                typeParameters: ["generic-return-type"],
                parameters: [],
                parameterTypeTexts: [["T"]],
              }
            : { id: "signature-1", flags: 0, typeParameters: [], parameters: [] },
      })),
      getDeclaredTypeOfSymbol: vi.fn(() => undefined),
      getIndexInfosOfType: vi.fn(() => [
        { keyType, valueType: indexedValueType, isReadonly: false },
      ]),
      getNonNullableType: vi.fn((type: CorsaType) =>
        type.id === "nullable-type" ? nonNullableType : undefined,
      ),
      getPropertiesOfType: vi.fn(() => []),
      getReturnTypeOfSignature: vi.fn((signature: { id: string }) =>
        signature.id === "generic-signature" ? genericReturnType : callReturnType,
      ),
      getSignaturesOfType: vi.fn(() => []),
      getSymbolAtPosition: vi.fn(() => undefined),
      getTypeArguments: vi.fn((type: CorsaType) =>
        type.id === "tuple-type" ? [tupleTargetType, tuplePlainType] : [],
      ),
      getTypeOfSymbol: vi.fn(() => undefined),
      isTypeAssignableTo: vi.fn((source: CorsaType, target: CorsaType) => source.id === target.id),
      rememberTypeLookupFromType: vi.fn(),
      typeToString: vi.fn((type: CorsaType) => type.texts[0] ?? type.id),
    },
  };
});

vi.mock("./registry", () => ({
  sessionForContext: vi.fn(() => ({
    project: { rootDir: "/workspace" },
    session: mocks.session,
  })),
}));

const { createTypeChecker } = await import("./checker");

describe("createTypeChecker conditional type locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not collapse a conditional expression when either branch is unresolved", () => {
    const sourceText = "flag ? known : missing";
    const checker = createTypeChecker({
      cwd: "/workspace",
      filename: "/workspace/src/index.ts",
      sourceCode: { text: sourceText },
      settings: {},
    } as never);

    const type = checker.getTypeAtLocation({
      type: "ConditionalExpression",
      range: [0, sourceText.length],
      test: { type: "Identifier", name: "flag", range: [0, 4] },
      consequent: { type: "Identifier", name: "known", range: [7, 12] },
      alternate: { type: "Identifier", name: "missing", range: [15, 22] },
    } as never);

    expect(type).toBeUndefined();
    expect(mocks.session.getTypeAtSourceRange).toHaveBeenCalledTimes(2);
    expect(mocks.session.getTypeAtSourceRange.mock.calls.map((call) => call[4])).toEqual([
      "Identifier",
      "Identifier",
    ]);
  });

  it("passes literal and widened argument texts to signature facts", () => {
    const sourceText = 'choose("a")';
    const checker = createTypeChecker({
      cwd: "/workspace",
      filename: "/workspace/src/index.ts",
      sourceCode: { text: sourceText },
      settings: {},
    } as never);

    const type = checker.getTypeAtLocation({
      type: "CallExpression",
      range: [0, sourceText.length],
      callee: { type: "Identifier", name: "choose", range: [0, 6] },
      arguments: [{ type: "Literal", value: "a", range: [7, 10] }],
    } as never);

    expect(type).toBe(mocks.types.callReturnType);
    expect(mocks.session.getCallSignatureFacts).toHaveBeenCalledWith(
      mocks.types.callableType,
      0,
      [[`"a"`, "string"]],
      [],
    );
  });

  it("substitutes generic return types from matching argument types", () => {
    const sourceText = "identity(target)";
    const checker = createTypeChecker({
      cwd: "/workspace",
      filename: "/workspace/src/index.ts",
      sourceCode: { text: sourceText },
      settings: {},
    } as never);

    const type = checker.getTypeAtLocation({
      type: "CallExpression",
      range: [300, 316],
      callee: { type: "Identifier", name: "identity", range: [300, 308] },
      arguments: [{ type: "Identifier", name: "target", range: [309, 315] }],
    } as never);

    expect(type).toBe(mocks.types.callReturnType);
    expect(mocks.session.getCallSignatureFacts).toHaveBeenCalledWith(
      mocks.types.genericCallableType,
      0,
      [["Target"]],
      [],
    );
  });

  it("removes nullable parts from non-null assertion expressions", () => {
    const checker = createTypeChecker({
      cwd: "/workspace",
      filename: "/workspace/src/index.ts",
      sourceCode: { text: "value!" },
      settings: {},
    } as never);

    const type = checker.getTypeAtLocation({
      type: "TSNonNullExpression",
      range: [100, 106],
      expression: { type: "Identifier", name: "value", range: [100, 105] },
    } as never);

    expect(type).toBe(mocks.types.nonNullableType);
    expect(mocks.session.getNonNullableType).toHaveBeenCalledWith(mocks.types.nullableType);
  });

  it("resolves computed members through index signature value types", () => {
    const checker = createTypeChecker({
      cwd: "/workspace",
      filename: "/workspace/src/index.ts",
      sourceCode: { text: "registry[key]" },
      settings: {},
    } as never);

    const type = checker.getTypeAtLocation({
      type: "MemberExpression",
      computed: true,
      range: [200, 213],
      object: { type: "Identifier", name: "registry", range: [200, 208] },
      property: { type: "Identifier", name: "key", range: [209, 212] },
    } as never);

    expect(type).toBe(mocks.types.indexedValueType);
    expect(mocks.session.getIndexInfosOfType).toHaveBeenCalledWith(mocks.types.registryType);
  });

  it("resolves non-literal tuple numeric access as an element union", () => {
    const checker = createTypeChecker({
      cwd: "/workspace",
      filename: "/workspace/src/index.ts",
      sourceCode: { text: "tuple[index]" },
      settings: {},
    } as never);

    const type = checker.getTypeAtLocation({
      type: "MemberExpression",
      computed: true,
      range: [400, 412],
      object: { type: "Identifier", name: "tuple", range: [400, 405] },
      property: { type: "Identifier", name: "index", range: [406, 411] },
    } as never);

    expect(type?.texts).toEqual(["Target | Plain"]);
  });
});
