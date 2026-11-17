import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

import { fail, rootDir, runCommand } from "./shared.ts";

interface TsrsRuntime {
  readonly executable: string;
  readonly version: string;
}

/**
 * Locates the native binary of the `tsrs` package this workspace installs.
 *
 * Mirrors the lookup in `corsa-oxlint`: `tsrs` declares
 * `@tsrs/<platform>-<arch>` (with `-gnu` or `-musl` on Linux) as an optional
 * dependency, and the binary sits at that package's root next to the
 * `lib.*.d.ts` files it loads.
 */
function tsrsRuntime(): TsrsRuntime {
  const requireFromRoot = createRequire(resolve(rootDir, "package.json"));
  const packageJsonPath = requireFromRoot.resolve("tsrs/package.json");
  const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  const base = `@tsrs/${process.platform}-${process.arch}`;
  const candidates = process.platform === "linux" ? [`${base}-gnu`, `${base}-musl`] : [base];
  const requireFromTsrs = createRequire(packageJsonPath);
  for (const candidate of candidates) {
    let platformPackageJsonPath: string;
    try {
      platformPackageJsonPath = requireFromTsrs.resolve(`${candidate}/package.json`);
    } catch {
      continue;
    }
    const executable = resolve(
      dirname(platformPackageJsonPath),
      process.platform === "win32" ? "tsrs.exe" : "tsrs",
    );
    if (existsSync(executable)) {
      return { executable, version };
    }
  }
  throw new Error(`tsrs@${version} has no native binary for ${candidates.join(" or ")}`);
}

/**
 * Runs the real-runtime contract suites against tsrs.
 *
 * tsrs (oxc-project/tsrs) ports TypeScript 7's checker to Rust and serves the
 * same `--api` protocol, pinned to the TypeScript 7.1 beta. Running the suites
 * every other runtime runs keeps corsa-bind usable as its client, and catches
 * a divergence in either project early.
 */
function main(): void {
  const runtime = tsrsRuntime();
  console.error(`==> real-runtime contract against tsrs@${runtime.version}`);
  runCommand(
    "cargo",
    [
      "test",
      "-p",
      "corsa",
      "--no-default-features",
      "--test",
      "real_corsa_regression",
      "--test",
      "real_corsa_typecheck",
      "--test",
      "real_corsa_dialect",
    ],
    {
      env: {
        ...process.env,
        CORSA_EXECUTABLE: runtime.executable,
        // Pinned to the 7.1 beta, so it lacks checker operations that only
        // the pinned development build exposes.
        CORSA_RELEASED_RUNTIME: "1",
      },
    },
  );
}

try {
  main();
} catch (error) {
  fail(error);
}
