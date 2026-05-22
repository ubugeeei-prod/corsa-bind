import { dirname, resolve } from "node:path";

const tsconfig = process.env.TSGO_RS_BENCH_TSCONFIG;
const tsgoExecutable = process.env.TSGO_RS_BENCH_TSGO;
const workspaceRoot = process.env.TSGO_RS_BENCH_ROOT;

if (!tsconfig) {
  throw new Error("TSGO_RS_BENCH_TSCONFIG is required");
}
if (!tsgoExecutable) {
  throw new Error("TSGO_RS_BENCH_TSGO is required");
}
if (!workspaceRoot) {
  throw new Error("TSGO_RS_BENCH_ROOT is required");
}

const tsconfigPath = resolve(tsconfig);
const tsconfigRootDir = dirname(tsconfigPath);
const rules = {
  "corsa/await-thenable": "error",
  "corsa/no-array-delete": "error",
  "corsa/no-base-to-string": "error",
  "corsa/no-floating-promises": "error",
  "corsa/no-for-in-array": "error",
  "corsa/no-implied-eval": "error",
  "corsa/no-mixed-enums": "error",
  "corsa/no-unsafe-assignment": "error",
  "corsa/no-unsafe-return": "error",
  "corsa/no-unsafe-unary-minus": "error",
  "corsa/only-throw-error": "error",
  "corsa/prefer-find": "error",
  "corsa/prefer-includes": "error",
  "corsa/prefer-promise-reject-errors": "error",
  "corsa/prefer-regexp-exec": "error",
  "corsa/prefer-string-starts-ends-with": "error",
  "corsa/require-array-sort-compare": "error",
  "corsa/restrict-plus-operands": "error",
  "corsa/use-unknown-in-catch-callback-variable": "error",
};

export default {
  jsPlugins: [{ name: "corsa", specifier: "./corsa-oxlint-plugin.mjs" }],
  settings: {
    typescriptOxlint: {
      parserOptions: {
        project: [tsconfigPath],
        tsconfigRootDir,
        tsgo: {
          executable: tsgoExecutable,
          cwd: workspaceRoot,
          mode: "msgpack",
          cacheLifetimeMs: 60_000,
        },
      },
    },
  },
  rules,
};
