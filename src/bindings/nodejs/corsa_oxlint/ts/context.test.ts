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

    expect(() => defaultCorsaExecutable(workspace, "linux")).toThrow("Install `typescript` 7");
  });

  it("resolves the stable TypeScript 7 platform executable", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);
    const typescriptDir = resolve(workspace, "node_modules/typescript");
    const platformDir = resolve(
      workspace,
      `node_modules/@typescript/typescript-linux-${process.arch}`,
    );
    const stableBin = resolve(platformDir, "lib/tsc");

    mkdirSync(typescriptDir, { recursive: true });
    mkdirSync(dirname(stableBin), { recursive: true });
    writeFileSync(
      resolve(typescriptDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "7.0.2" }),
    );
    writeFileSync(
      resolve(platformDir, "package.json"),
      JSON.stringify({ name: `@typescript/typescript-linux-${process.arch}`, version: "7.0.2" }),
    );
    writeFileSync(stableBin, "");

    expect(defaultCorsaExecutable(workspace, "linux")).toBe(realpathSync(stableBin));
  });

  it("resolves the stable TypeScript 7 platform executable on Windows", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);
    const typescriptDir = resolve(workspace, "node_modules/typescript");
    const platformDir = resolve(
      workspace,
      `node_modules/@typescript/typescript-win32-${process.arch}`,
    );
    const stableBin = resolve(platformDir, "lib/tsc.exe");

    mkdirSync(typescriptDir, { recursive: true });
    mkdirSync(dirname(stableBin), { recursive: true });
    writeFileSync(
      resolve(typescriptDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "7.0.2" }),
    );
    writeFileSync(
      resolve(platformDir, "package.json"),
      JSON.stringify({ name: `@typescript/typescript-win32-${process.arch}`, version: "7.0.2" }),
    );
    writeFileSync(stableBin, "");

    expect(defaultCorsaExecutable(workspace, "win32")).toBe(realpathSync(stableBin));
  });

  it("ignores TypeScript versions before 7", () => {
    const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-context-"));
    cleanupDirs.add(workspace);
    const typescriptDir = resolve(workspace, "node_modules/typescript");
    const platformDir = resolve(
      workspace,
      `node_modules/@typescript/typescript-linux-${process.arch}`,
    );
    const stableBin = resolve(platformDir, "lib/tsc");
    const fallback = resolve(workspace, ".cache/corsa");

    mkdirSync(typescriptDir, { recursive: true });
    mkdirSync(dirname(stableBin), { recursive: true });
    mkdirSync(dirname(fallback), { recursive: true });
    writeFileSync(
      resolve(typescriptDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "6.0.3" }),
    );
    writeFileSync(
      resolve(platformDir, "package.json"),
      JSON.stringify({ name: `@typescript/typescript-linux-${process.arch}`, version: "6.0.3" }),
    );
    writeFileSync(stableBin, "");
    writeFileSync(fallback, "");

    expect(defaultCorsaExecutable(workspace, "linux")).toBe(fallback);
  });

  it("resolves stable TypeScript 7 from a plugin anchor", () => {
    const consumerRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-consumer-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "corsa-oxlint-plugin-"));
    cleanupDirs.add(consumerRoot);
    cleanupDirs.add(pluginRoot);

    const typescriptDir = resolve(pluginRoot, "node_modules/typescript");
    const platformDir = resolve(
      pluginRoot,
      `node_modules/@typescript/typescript-linux-${process.arch}`,
    );
    const binPath = resolve(platformDir, "lib/tsc");
    mkdirSync(typescriptDir, { recursive: true });
    mkdirSync(dirname(binPath), { recursive: true });
    writeFileSync(
      resolve(typescriptDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "7.0.2" }),
    );
    writeFileSync(
      resolve(platformDir, "package.json"),
      JSON.stringify({ name: `@typescript/typescript-linux-${process.arch}`, version: "7.0.2" }),
    );
    writeFileSync(binPath, "");

    const pluginEntry = resolve(pluginRoot, "dist/plugin.js");
    mkdirSync(dirname(pluginEntry), { recursive: true });
    writeFileSync(pluginEntry, "export default {};\n");

    expect(defaultCorsaExecutable(consumerRoot, "linux", pathToFileURL(pluginEntry).href)).toBe(
      realpathSync(binPath),
    );
  });
});
