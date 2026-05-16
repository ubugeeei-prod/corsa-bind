import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ApiClientOptions, ApiMode, ConfigResponse } from "@corsa-bind/napi";
import { TsgoApiClient } from "@corsa-bind/napi";

export const workspaceRoot = resolve(import.meta.dirname, "../..");
export const tsgoPath = resolve(
  workspaceRoot,
  process.platform === "win32" ? ".cache/tsgo.exe" : ".cache/tsgo",
);
const datasetCandidates = [
  "ref/typescript-go/_packages/native-preview/tsconfig.json",
  "ref/typescript-go/_packages/api/tsconfig.json",
].map((path) => resolve(workspaceRoot, path));
export const datasetPath =
  datasetCandidates.find((candidate) => existsSync(candidate)) ?? datasetCandidates[0];
export const typescriptOxlintFixtureDir = resolve(
  workspaceRoot,
  "bench/fixtures/typescript_oxlint",
);
export const typescriptOxlintConfigPath = resolve(typescriptOxlintFixtureDir, "tsconfig.json");
export const typescriptOxlintFilePath = resolve(typescriptOxlintFixtureDir, "index.ts");
export const typescriptOxlintSourceText = readFileSync(typescriptOxlintFilePath, "utf8");

export function benchOptions(mode: ApiMode): ApiClientOptions {
  return {
    executable: tsgoPath,
    cwd: workspaceRoot,
    mode,
  };
}

export function ensureBenchInputs(): void {
  if (!existsSync(tsgoPath)) {
    throw new Error(
      "missing built tsgo binary under .cache; run `vp run -w build` or `vp run -w build_tsgo` first",
    );
  }
  if (!existsSync(datasetPath)) {
    throw new Error("missing pinned tsgo dataset under ref/typescript-go");
  }
  if (!existsSync(typescriptOxlintConfigPath)) {
    throw new Error("missing corsa-oxlint fixture tsconfig");
  }
}

export function openBenchSession(mode: ApiMode): {
  client: TsgoApiClient;
  config: ConfigResponse;
  configPath: string;
  projectId: string;
  primaryFile: string;
  snapshot: string;
} {
  const client = TsgoApiClient.spawn(benchOptions(mode));
  client.initialize();
  const config = client.parseConfigFile(datasetPath);
  const snapshot = client.updateSnapshot({ openProject: datasetPath });
  const projectId = snapshot.projects[0]?.id;
  const primaryFile =
    config.fileNames.find((fileName: string) => !fileName.endsWith(".d.ts")) ?? config.fileNames[0];

  if (!projectId || !primaryFile) {
    client.close();
    throw new Error("bench dataset did not produce a project or source file");
  }

  return {
    client,
    config,
    configPath: datasetPath,
    projectId,
    primaryFile,
    snapshot: snapshot.snapshot,
  };
}
