import type { ESTree as OxlintESTree } from "@oxlint/plugins";

export { AST_NODE_TYPES, AST_TOKEN_TYPES, TSESTree } from "./compat";
export * as ASTUtils from "./ast_utils";
export * as JSONSchema from "./json_schema";
export * as OxlintCompat from "./oxlint_compat";
export * as TSUtils from "./ts_utils";
export * as Utils from "./utils";

export { ESLintUtils, OxlintUtils, RuleCreator } from "./oxlint_utils";
export { compatPlugin, definePlugin, defineRule } from "./plugin";
export type { Plugin, Rule } from "./plugin";
export { getParserServices } from "./parser_services";
export { RuleTester } from "./rule_tester";
export { SignatureKind } from "./types";
export type { RuleTesterConfig } from "./rule_tester";
export { TSESLint } from "./ts_eslint";
export * as rules from "./rules/index";
export * as stylistic from "./stylistic";
export { oxlintCompat } from "./oxlint_compat";
export type ESTree = {
  NewExpression: OxlintESTree.NewExpression;
  BindingIdentifier: Omit<OxlintESTree.BindingIdentifier, "typeAnnotation"> & {
    typeAnnotation?: OxlintESTree.TSTypeAnnotation | null;
  };
  TSTypeAnnotation: OxlintESTree.TSTypeAnnotation;
  [key: string]: unknown;
};
export type {
  CorsaNode,
  CorsaProgramShape,
  CorsaRuntimeOptions,
  CorsaOxlintSettings,
  CorsaStylisticSettings,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypeCheckerShape,
  ContextWithParserOptions,
  ParserServices,
  ParserServicesWithTypeInformation,
  ProjectServiceOptions,
  TypeAwareParserOptions,
} from "./types";
