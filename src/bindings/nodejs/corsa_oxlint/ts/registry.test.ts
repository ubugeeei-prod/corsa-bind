import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sessionForContext } from "./registry";

const cleanupDirs = new Set<string>();

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  cleanupDirs.clear();
});

describe("corsa oxlint session registry", () => {
  it("reuses the resolved project and session for the same lint context", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-session-"));
    cleanupDirs.add(workspaceRoot);
    writeFileSync(
      resolve(workspaceRoot, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, files: ["fixture.ts"] }),
    );
    const sourcePath = resolve(workspaceRoot, "fixture.ts");
    writeFileSync(sourcePath, "const value = 1;\n");

    const context = {
      cwd: workspaceRoot,
      filename: sourcePath,
      languageOptions: {
        parserOptions: {
          project: "tsconfig.json",
          corsa: {
            executable: resolve(workspaceRoot, "fake-corsa"),
          },
        },
      },
      settings: {},
      sourceCode: {
        text: "const value = 1;\n",
      },
    } as never;

    const first = sessionForContext(context);
    const second = sessionForContext(context);

    expect(second.project).toBe(first.project);
    expect(second.session).toBe(first.session);
  });
});
