import { RuleTester } from "./rule_tester";

export { RuleTester } from "./rule_tester";

export const ESLint = unsupportedTSESLintClass("ESLint");
export const FlatESLint = unsupportedTSESLintClass("FlatESLint");
export const LegacyESLint = unsupportedTSESLintClass("LegacyESLint");
export const Linter = unsupportedTSESLintClass("Linter");
export const Scope = Object.freeze({});
export const SourceCode = unsupportedTSESLintClass("SourceCode");

export const TSESLint = Object.freeze({
  ESLint,
  FlatESLint,
  LegacyESLint,
  Linter,
  RuleTester,
  Scope,
  SourceCode,
});

function unsupportedTSESLintClass(name: string) {
  return class UnsupportedTSESLintClass {
    constructor(..._args: unknown[]) {
      throw new Error(
        `TSESLint.${name} is not supported by corsa-oxlint because it depends on ESLint runtime internals.`,
      );
    }
  };
}
