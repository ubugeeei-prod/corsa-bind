import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { it } from "vitest";

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

/** Registers a test case, mirroring the shape of vitest's `it`. */
export type IntegrationCase = (name: string, fn: () => void | Promise<void>) => void;

/**
 * Returns the `it` variant integration cases should register with.
 *
 * Integration cases need a real Corsa runtime, so they fall back to `it.skip`
 * when the workspace has not built one. That silence is how this repository
 * shipped a long run of protocol regressions — issues #384, #389, #390, #392,
 * #393, #395, #410, #413, #416, #418, #427, #440, and #441 — while the suites
 * covering those endpoints reported success without executing a single case.
 *
 * Set `CORSA_REQUIRE_INTEGRATION=1`, as the real-runtime CI job does, to turn a
 * missing runtime into a failure instead of a skip.
 */
export function integrationCase(): IntegrationCase {
  if (resolvedRealCorsaBinary()) {
    return it;
  }
  if (!process.env.CORSA_REQUIRE_INTEGRATION) {
    return it.skip;
  }
  return (name, _fn) =>
    it(name, () => {
      throw new Error(
        [
          "CORSA_REQUIRE_INTEGRATION is set but no Corsa runtime was found.",
          "Build one with `vp run -w build_corsa`, or point CORSA_EXECUTABLE at an existing binary.",
        ].join(" "),
      );
    });
}
