import { corsaOxlintPlugin } from "corsa-oxlint/rules";

import { createExampleParserOptions } from "./shared.ts";

const config = [
  {
    settings: {
      corsaOxlint: {
        parserOptions: createExampleParserOptions(),
      },
    },
    plugins: {
      typescript: corsaOxlintPlugin,
    },
    rules: {
      "typescript/no-base-to-string": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-unsafe-assignment": "error",
      "typescript/no-unsafe-return": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/prefer-string-starts-ends-with": "error",
      "typescript/restrict-plus-operands": ["error", { allowNumberAndString: false }],
    },
  },
];

export default config;
