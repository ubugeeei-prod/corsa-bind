import { existsSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");

const CANDIDATES = [
  ".cache/corsa",
  ".cache/corsa.exe",
  "ref/corsa-upstream/.cache/corsa",
  "ref/corsa-upstream/.cache/corsa.exe",
  "ref/corsa-upstream/built/local/corsa",
  "ref/corsa-upstream/built/local/corsa.exe",
] as const;

/**
 * Resolves the Corsa runtime the integration tests should exercise, or
 * `undefined` when the workspace has not built one yet.
 *
 * These tests deliberately do not call `defaultCorsaExecutable`. That helper is
 * the consumer-facing resolution order, and it prefers the runtime shipped
 * inside the installed `typescript` package. Using it here would silently bind
 * the suite to whatever TypeScript release happens to be in `node_modules`
 * rather than the Corsa build this repository pins in `corsa_ref.lock.toml`,
 * which is the version truth the rest of the workspace tests against.
 *
 * Mirrors `resolved_real_corsa_binary` in the Rust test support module.
 */
export function resolvedRealCorsaBinary(): string | undefined {
  const fromEnvironment = process.env.CORSA_EXECUTABLE;
  if (fromEnvironment && existsSync(fromEnvironment)) {
    return resolve(fromEnvironment);
  }
  return CANDIDATES.map((candidate) => resolve(workspaceRoot, candidate)).find((candidate) =>
    existsSync(candidate),
  );
}
