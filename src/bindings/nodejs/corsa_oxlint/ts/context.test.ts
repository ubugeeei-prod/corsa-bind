import {
  closeSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

  it("resolves the platform-specific default corsa executable when it exists", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);
    mkdirSync(resolve(workspace, ".cache"), { recursive: true });
    const linuxBin = resolve(workspace, ".cache/corsa");
    const windowsBin = resolve(workspace, ".cache/corsa.exe");
    closeSync(openSync(linuxBin, "w"));
    closeSync(openSync(windowsBin, "w"));

    expect(defaultCorsaExecutable(workspace, "linux")).toBe(linuxBin);
    expect(defaultCorsaExecutable(workspace, "win32")).toBe(windowsBin);
  });

  it("throws a dependency-focused error when no default executable exists", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);

    expect(() => defaultCorsaExecutable(workspace, "linux")).toThrow(
      "Install `@typescript/native-preview`",
    );
  });

  it("prefers the installed native-preview tsgo binary when available", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);
    const packageDir = resolve(workspace, "node_modules/@typescript/native-preview");
    const binPath = resolve(packageDir, "bin/tsgo.js");
    mkdirSync(dirname(binPath), { recursive: true });
    writeFileSync(
      resolve(packageDir, "package.json"),
      JSON.stringify({
        name: "@typescript/native-preview",
        bin: {
          tsgo: "bin/tsgo.js",
        },
      }),
    );
    writeFileSync(binPath, "#!/usr/bin/env node\n");

    expect(defaultCorsaExecutable(workspace)).toBe(realpathSync(binPath));
  });

  it("falls back to a plugin anchor when native-preview is only installed next to the plugin", () => {
    const consumerRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-consumer-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-plugin-"));
    cleanupDirs.add(consumerRoot);
    cleanupDirs.add(pluginRoot);

    const packageDir = resolve(pluginRoot, "node_modules/@typescript/native-preview");
    const binPath = resolve(packageDir, "bin/tsgo.js");
    mkdirSync(dirname(binPath), { recursive: true });
    writeFileSync(
      resolve(packageDir, "package.json"),
      JSON.stringify({
        name: "@typescript/native-preview",
        bin: {
          tsgo: "bin/tsgo.js",
        },
      }),
    );
    writeFileSync(binPath, "#!/usr/bin/env node\n");

    const pluginEntry = resolve(pluginRoot, "dist/plugin.js");
    mkdirSync(dirname(pluginEntry), { recursive: true });
    writeFileSync(pluginEntry, "export default {};\n");

    expect(defaultCorsaExecutable(consumerRoot, "linux", pathToFileURL(pluginEntry).href)).toBe(
      realpathSync(binPath),
    );
  });
});
