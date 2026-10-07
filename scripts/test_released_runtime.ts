import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { fail, rootDir, runCommand } from "./shared.ts";

interface ReleasedRuntime {
  readonly executable: string;
  readonly version: string;
}

/**
 * Locates the native runtime shipped by the `typescript` package this
 * workspace installs from npm.
 *
 * Mirrors the consumer-facing lookup in `corsa-oxlint`: `typescript` declares
 * `@typescript/typescript-<platform>-<arch>` as an optional dependency and the
 * executable lives in its `lib` directory.
 */
function releasedRuntime(): ReleasedRuntime {
  const requireFromRoot = createRequire(resolve(rootDir, "package.json"));
  const packageJsonPath = requireFromRoot.resolve("typescript/package.json");
  const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`;
  const platformPackageJsonPath = createRequire(packageJsonPath).resolve(
    `${platformPackage}/package.json`,
  );
  const executable = resolve(
    dirname(platformPackageJsonPath),
    "lib",
    process.platform === "win32" ? "tsc.exe" : "tsc",
  );
  if (!existsSync(executable)) {
    throw new Error(`typescript@${version} has no native runtime at ${executable}`);
  }
  return { executable, version };
}

/**
 * Runs the wire-dialect contract tests against the released TypeScript runtime.
 *
 * Every other real-runtime check uses the build pinned in
 * `corsa_ref.lock.toml`, which tracks upstream `main` and therefore speaks the
 * newest dialect. The release on npm is what consumers run, and it can be a
 * dialect behind. Pointing the same contract at it is what keeps the adapter
 * for that dialect from rotting unobserved.
 */
function main(): void {
  const runtime = releasedRuntime();
  console.error(`==> dialect contract against typescript@${runtime.version}`);
  runCommand(
    "cargo",
    ["test", "-p", "corsa", "--no-default-features", "--test", "real_corsa_dialect"],
    { env: { ...process.env, CORSA_EXECUTABLE: runtime.executable } },
  );
}

try {
  main();
} catch (error) {
  fail(error);
}
