import { definePlugin } from "corsa-oxlint";

import { noStringPlusNumberRule } from "./custom_rule.ts";

export const corsaOxlintCustomPlugin = definePlugin({
  meta: {
    name: "corsa-example-plugin",
  },
  rules: {
    "no-string-plus-number": noStringPlusNumberRule,
  },
});

export default corsaOxlintCustomPlugin;
