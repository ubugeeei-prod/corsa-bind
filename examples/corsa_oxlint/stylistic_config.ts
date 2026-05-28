import { corsaStylisticPlugin } from "corsa-oxlint/stylistic";

const config = [
  {
    settings: {
      corsaStylistic: {
        rules: {
          "eol-last": ["always"],
          "linebreak-style": ["unix"],
          "no-multiple-empty-lines": [{ max: 1, maxBOF: 0, maxEOF: 1 }],
          "no-tabs": [{ allowIndentationTabs: false }],
          "no-trailing-spaces": [{ skipBlankLines: false }],
          quotes: ["single", { avoidEscape: true }],
          "unicode-bom": ["never"],
        },
      },
    },
    plugins: {
      stylistic: corsaStylisticPlugin,
    },
    rules: {
      "stylistic/eol-last": "error",
      "stylistic/linebreak-style": "error",
      "stylistic/no-multiple-empty-lines": "error",
      "stylistic/no-tabs": "error",
      "stylistic/no-trailing-spaces": "error",
      "stylistic/quotes": "error",
      "stylistic/unicode-bom": "error",
    },
  },
];

export default config;
