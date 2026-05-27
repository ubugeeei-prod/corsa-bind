import { resolve } from "node:path";

import { defineConfig } from "vite-plus";

import { aliases } from "./scripts/vite/aliases.ts";
import {
  corsaOxlintDir,
  corsaOxlintSourceDir,
  generatedNodeArtifacts,
  lintIgnorePatterns,
  upstreamRefPatterns,
} from "./scripts/vite/paths.ts";
import { runTasks } from "./scripts/vite/tasks/index.ts";

export default defineConfig({
  fmt: {
    ignorePatterns: [...generatedNodeArtifacts, ...upstreamRefPatterns],
  },
  pack: {
    clean: true,
    deps: {
      neverBundle: ["@corsa-bind/napi"],
      skipNodeModulesBundle: true,
    },
    dts: true,
    entry: [
      "src/bindings/nodejs/corsa_oxlint/ts/**/*.ts",
      "!src/bindings/nodejs/corsa_oxlint/ts/**/*.test.ts",
    ],
    fixedExtension: false,
    format: "esm",
    outDir: resolve(corsaOxlintDir, "dist"),
    root: corsaOxlintSourceDir,
    sourcemap: true,
    tsconfig: resolve(corsaOxlintDir, "tsconfig.json"),
    unbundle: true,
  },
  resolve: {
    alias: aliases,
  },
  lint: {
    ignorePatterns: lintIgnorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    tasks: runTasks,
  },
  test: {
    environment: "node",
    include: ["bench/src/**/*.test.ts", "src/bindings/nodejs/**/ts/**/*.test.ts"],
    benchmark: {
      include: ["bench/src/**/*.bench.ts"],
      exclude: upstreamRefPatterns,
      includeSamples: true,
    },
  },
});
