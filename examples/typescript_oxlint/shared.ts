import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TypeAwareParserOptions } from "corsa-oxlint";

const examplesDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(examplesDir, "../..");
const corsaExecutable =
  process.platform === "win32"
    ? resolve(workspaceRoot, ".cache/tsgo.exe")
    : resolve(workspaceRoot, ".cache/tsgo");

export function createExampleParserOptions(): TypeAwareParserOptions {
  return {
    projectService: {
      allowDefaultProject: ["*.ts", "*.tsx"],
    },
    tsconfigRootDir: workspaceRoot,
    corsa: {
      executable: corsaExecutable,
      cwd: workspaceRoot,
      mode: "msgpack",
      requestTimeoutMs: 30_000,
    },
  };
}

export function createExampleSettings() {
  return {
    typescriptOxlint: {
      parserOptions: createExampleParserOptions(),
    },
  };
}
