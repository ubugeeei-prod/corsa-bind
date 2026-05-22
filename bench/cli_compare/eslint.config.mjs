import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const tsconfig = process.env.TSGO_RS_BENCH_TSCONFIG;

if (!tsconfig) {
  throw new Error("TSGO_RS_BENCH_TSCONFIG is required");
}

const tsconfigPath = resolve(tsconfig);
const tsconfigRootDir = dirname(tsconfigPath);
const configDir = dirname(fileURLToPath(import.meta.url));
const basePath = resolve(configDir, "../..");

export default [
  {
    basePath,
    files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: [tsconfigPath],
        tsconfigRootDir,
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-array-delete": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-implied-eval": "error",
      "@typescript-eslint/no-mixed-enums": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-find": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/prefer-regexp-exec": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/require-array-sort-compare": "error",
      "@typescript-eslint/restrict-plus-operands": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
    },
  },
];
