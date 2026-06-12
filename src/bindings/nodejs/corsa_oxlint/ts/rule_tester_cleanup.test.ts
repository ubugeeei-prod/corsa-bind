import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { defineRule } from "./plugin";
import { RuleTester } from "./rule_tester";

describe("RuleTester cleanup", () => {
  it("cleans up the workspace created for a run", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-cleanup-root-"));
    const previousRoot = process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR;
    process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR = tempRoot;
    try {
      const before = tempWorkspaces(tempRoot);
      const rule = defineRule({
        meta: {
          type: "problem",
          docs: {
            description: "noop",
          },
          messages: {
            demo: "demo",
          },
          schema: [],
        },
        create() {
          return {};
        },
      });

      new RuleTester().run("noop", rule, {
        valid: ["const one = 1;", "const two = 2;"],
        invalid: [],
      });

      expect(tempWorkspaces(tempRoot)).toEqual(before);
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
