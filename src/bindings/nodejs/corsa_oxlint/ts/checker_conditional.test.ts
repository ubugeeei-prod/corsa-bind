import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CorsaType } from "./types";

const mocks = vi.hoisted(() => {
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
  return {
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
          return position === 7 ? knownType : undefined;
        },
      ),
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
    mocks.session.getTypeAtSourceRange.mockClear();
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
});
