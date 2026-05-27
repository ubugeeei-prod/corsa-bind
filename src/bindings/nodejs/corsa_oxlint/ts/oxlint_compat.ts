export const oxlintCompat = Object.freeze({
  config(...configs: readonly unknown[]) {
    return configs.flat();
  },
  configs: Object.freeze({}),
  parser: Object.freeze({
    meta: {
      name: "oxlint-plugin-corsa/parser",
      version: "0.1.0",
    },
    parse() {
      throw new Error(
        "oxlint-plugin-corsa relies on oxlint for parsing; use it as a JS plugin package instead of a standalone parser",
      );
    },
  }),
  plugin: Object.freeze({
    configs: Object.freeze({}),
    rules: Object.freeze({}),
  }),
});
