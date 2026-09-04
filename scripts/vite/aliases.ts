import { resolve } from "node:path";

import { corsaOxlintDir, nodePackageDir } from "./paths.ts";

/**
 * Runtime and test aliases for unpublished workspace packages.
 *
 * These aliases keep examples, tests, and package builds pointed at source files
 * instead of stale build output.
 */
export const aliases = {
  "@corsa-bind/napi": resolve(nodePackageDir, "ts/index.ts"),
  "@corsa-bind/napi/orchestrator": resolve(nodePackageDir, "ts/orchestrator.ts"),
  "corsa-oxlint/ast-utils": resolve(corsaOxlintDir, "ts/ast_utils.ts"),
  "corsa-oxlint/compat": resolve(corsaOxlintDir, "ts/oxlint_compat.ts"),
  "corsa-oxlint/eslint-utils": resolve(corsaOxlintDir, "ts/oxlint_utils.ts"),
  "corsa-oxlint/json-schema": resolve(corsaOxlintDir, "ts/json_schema.ts"),
  "corsa-oxlint/oxlint-utils": resolve(corsaOxlintDir, "ts/oxlint_utils.ts"),
  "corsa-oxlint/utils": resolve(corsaOxlintDir, "ts/utils.ts"),
  "corsa-oxlint/rule-tester": resolve(corsaOxlintDir, "ts/rule_tester.ts"),
  "corsa-oxlint/rules": resolve(corsaOxlintDir, "ts/rules/index.ts"),
  "corsa-oxlint/ts-estree": resolve(corsaOxlintDir, "ts/ts_estree.ts"),
  "corsa-oxlint/ts-eslint": resolve(corsaOxlintDir, "ts/ts_eslint.ts"),
  "corsa-oxlint/ts-utils": resolve(corsaOxlintDir, "ts/ts_utils.ts"),
  "corsa-oxlint": resolve(corsaOxlintDir, "ts/index.ts"),
};
