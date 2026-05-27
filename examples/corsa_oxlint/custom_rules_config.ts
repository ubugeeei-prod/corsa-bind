import { createExampleParserOptions } from "./shared.ts";
import { corsaOxlintCustomPlugin } from "./custom_plugin.ts";

const config = [
  {
    settings: {
      corsaOxlint: {
        parserOptions: createExampleParserOptions(),
      },
    },
    plugins: {
      example: corsaOxlintCustomPlugin,
    },
    rules: {
      "example/no-string-plus-number": "error",
    },
  },
];

export default config;
