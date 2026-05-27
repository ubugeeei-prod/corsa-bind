import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultCorsaExecutable,
  resolveProjectConfig,
  resolveTypeAwareParserOptions,
} from "./context";

const cleanupDirs = new Set<string>();
const normalizePathSeparators = (path: string) => path.replaceAll("\\", "/");

afterEach(() => {
  for (const dir of cleanupDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  cleanupDirs.clear();
});

describe("context", () => {
  it("merges settings.corsaOxlint parser options ahead of Oxlint defaults", () => {
    const resolved = resolveTypeAwareParserOptions({
      cwd: "/repo",
      filename: "/repo/src/demo.ts",
      languageOptions: {
        parserOptions: {
          corsa: {
            mode: "jsonrpc",
          },
        },
      },
      settings: {
        corsaOxlint: {
          parserOptions: {
            project: ["tsconfig.json"],
            corsa: {
              executable: "/repo/.cache/corsa",
            },
          },
        },
      },
      sourceCode: {
        text: "const demo = 1;",
      },
    } as any);

    expect(resolved.project).toEqual(["tsconfig.json"]);
    expect(resolved.corsa).toEqual({
      executable: "/repo/.cache/corsa",
      mode: "jsonrpc",
    });
  });

  it("creates a default project when projectService is enabled from settings", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);
    const filename = resolve(workspace, "src/demo.ts");
    mkdirSync(dirname(filename), { recursive: true });
    writeFileSync(filename, "export const demo = 1;\n");

    const resolved = resolveProjectConfig({
      cwd: workspace,
      filename,
      settings: {
        corsaOxlint: {
          parserOptions: {
            projectService: {
              allowDefaultProject: ["*.ts"],
            },
            corsa: {
              executable: resolve(workspace, ".cache/corsa"),
            },
          },
        },
      },
      sourceCode: {
        text: "export const demo = 1;\n",
      },
    } as any);

    expect(normalizePathSeparators(resolved.configPath)).toContain(".cache/corsa_oxlint/default/");
    expect(resolved.runtime.executable).toBe(resolve(workspace, ".cache/corsa"));
  });

  it("resolves the platform-specific default corsa executable", () => {
    expect(defaultCorsaExecutable("/repo", "linux")).toBe(resolve("/repo", ".cache/corsa"));
    expect(defaultCorsaExecutable("/repo", "win32")).toBe(resolve("/repo", ".cache/corsa.exe"));
  });
});
