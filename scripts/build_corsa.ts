import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { fail, rootDir, runCommand } from "./shared.ts";

function main(): void {
  const refDir = resolve(rootDir, "ref/corsa-upstream/tsc");
  const goCacheDir = resolve(rootDir, ".cache/go-build");
  const outputName = process.platform === "win32" ? "corsa.exe" : "corsa";
  const outputPath = resolve(rootDir, ".cache", outputName);

  mkdirSync(goCacheDir, { recursive: true });

  runCommand("go", ["build", "-o", outputPath, "./cmd/tsc"], {
    cwd: refDir,
    env: {
      ...process.env,
      GOCACHE: goCacheDir,
    },
  });
}

try {
  main();
} catch (error) {
  fail(error);
}
