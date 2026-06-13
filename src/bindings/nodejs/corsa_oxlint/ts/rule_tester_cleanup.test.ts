import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCalls: Array<{
  tests: {
    valid: Array<{ filename?: string }>;
    invalid: Array<{ filename?: string }>;
  };
}> = [];

class FakeOxlintRuleTester {
  static describe = vi.fn();
  static it = vi.fn();
  static only = vi.fn((item) => item);

  run(
    _ruleName: string,
    _rule: Record<string, unknown>,
    tests: {
      valid: Array<{ filename?: string }>;
      invalid: Array<{ filename?: string }>;
    },
  ): void {
    runCalls.push({ tests });
  }
}

vi.mock("oxlint/plugins-dev", () => ({
  RuleTester: FakeOxlintRuleTester,
}));

vi.mock("./context", () => ({
  defaultCorsaExecutable: vi.fn(() => "/tmp/corsa"),
  mergeTypeAwareParserOptions: vi.fn(
    (left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined) => ({
      ...(left ?? {}),
      ...(right ?? {}),
    }),
  ),
}));

vi.mock("./plugin", () => ({
  decorateRule: vi.fn((rule: Record<string, unknown>) => rule),
}));

const { RuleTester } = await import("./rule_tester");

describe("RuleTester cleanup", () => {
  beforeEach(() => {
    runCalls.length = 0;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the workspace alive until the lifecycle cleanup runs", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-cleanup-root-"));
    const previousRoot = process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR;
    const cleanupCallbacks: Array<() => void> = [];
    process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR = tempRoot;
    vi.stubGlobal(
      "afterAll",
      vi.fn((callback: () => void) => cleanupCallbacks.push(callback)),
    );
    try {
      new RuleTester().run(
        "noop",
        {},
        {
          valid: ["const one = 1;", "const two = 2;"],
          invalid: [],
        },
      );

      expect(runCalls).toHaveLength(1);
      expect(cleanupCallbacks).toHaveLength(1);

      const filename = runCalls[0]?.tests.valid[0]?.filename;
      expect(filename).toBeDefined();

      const workspace = resolve(dirname(filename ?? ""), "..");
      expect(tempWorkspaces(tempRoot)).toHaveLength(1);
      expect(existsSync(filename ?? "")).toBe(true);
      expect(existsSync(join(workspace, "tsconfig.json"))).toBe(true);

      cleanupCallbacks[0]?.();

      expect(tempWorkspaces(tempRoot)).toEqual([]);
    } finally {
      if (previousRoot === undefined) {
        delete process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR;
      } else {
        process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR = previousRoot;
      }
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});

function tempWorkspaces(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.startsWith("corsa-oxlint-"))
    .sort();
}
