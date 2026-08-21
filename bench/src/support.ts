import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ApiClientOptions, ApiMode, ConfigResponse } from "@corsa-bind/napi";
import { CorsaApiClient } from "@corsa-bind/napi";

export const workspaceRoot = resolve(import.meta.dirname, "../..");
export const corsaPath = resolve(
  workspaceRoot,
  process.platform === "win32" ? ".cache/corsa.exe" : ".cache/corsa",
);
const datasetCandidates = ["ref/corsa-upstream/packages/typescript/tsconfig.json"].map((path) =>
  resolve(workspaceRoot, path),
);
export const datasetPath =
  datasetCandidates.find((candidate) => existsSync(candidate)) ?? datasetCandidates[0];
export const corsaOxlintFixtureDir = resolve(workspaceRoot, "bench/fixtures/corsa_oxlint");
export const corsaOxlintConfigPath = resolve(corsaOxlintFixtureDir, "tsconfig.json");
export const corsaOxlintFilePath = resolve(corsaOxlintFixtureDir, "index.ts");
export const corsaOxlintSourceText = readFileSync(corsaOxlintFilePath, "utf8");

export function benchOptions(mode: ApiMode): ApiClientOptions {
  return {
    executable: corsaPath,
    cwd: workspaceRoot,
    mode,
  };
}

export function ensureBenchInputs(): void {
  if (!existsSync(corsaPath)) {
    throw new Error(
      "missing built corsa binary under .cache; run `vp run -w build` or `vp run -w build_corsa` first",
    );
  }
  if (!existsSync(datasetPath)) {
    throw new Error("missing pinned corsa dataset under ref/corsa-upstream");
  }
  if (!existsSync(corsaOxlintConfigPath)) {
    throw new Error("missing corsa-oxlint fixture tsconfig");
  }
}

export function openBenchSession(mode: ApiMode): {
  client: CorsaApiClient;
  config: ConfigResponse;
  configPath: string;
  projectId: string;
  primaryFile: string;
  snapshot: string;
} {
  const client = CorsaApiClient.spawn(benchOptions(mode));
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
