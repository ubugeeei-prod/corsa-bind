import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const examplesDir = dirname(fileURLToPath(import.meta.url));
const executableSuffix = process.platform === "win32" ? ".exe" : "";

export const workspaceRoot = resolve(examplesDir, "..");
export const mockBinary = resolve(workspaceRoot, `target/debug/mock_tsgo${executableSuffix}`);
export const realBinary = resolve(workspaceRoot, `.cache/tsgo${executableSuffix}`);
const realDatasetCandidates = [
  "ref/typescript-go/_packages/native-preview/tsconfig.json",
  "ref/typescript-go/_packages/api/tsconfig.json",
].map((path) => resolve(workspaceRoot, path));
export const realDataset =
  realDatasetCandidates.find((candidate) => existsSync(candidate)) ?? realDatasetCandidates[0];

export function assertExists(path: string, label: string, hint: string): void {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label} at ${path}; ${hint}`);
  }
}

export function isMain(metaUrl: string): boolean {
  const entry = process.argv[1];
  return entry ? resolve(entry) === fileURLToPath(metaUrl) : false;
}
