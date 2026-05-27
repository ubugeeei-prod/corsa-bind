import { createRustNativeRule } from "./native_bridge";

const syntaxOnlyBridge = {
  includePropertyNames: false,
  includeTypeTexts: false,
  maxDepth: 5,
};

const typedBridge = {
  includePropertyNames: false,
  includeTypeTexts: (_node: any, depth: number) => depth <= 2,
  maxDepth: 5,
};

const shallowTypedBridge = {
  includePropertyNames: false,
  includeTypeTexts: (_node: any, depth: number) => depth <= 1,
  maxDepth: 3,
};

const functionBodyTypedBridge = {
  includePropertyNames: false,
  includeTypeTexts: (_node: any, depth: number) => depth <= 3,
  maxDepth: 5,
};

export const consistentReturnRule = createRustNativeRule("consistent-return", {}, syntaxOnlyBridge);
export const consistentTypeExportsRule = createRustNativeRule(
  "consistent-type-exports",
  {},
  syntaxOnlyBridge,
);
export const dotNotationRule = createRustNativeRule("dot-notation", {}, syntaxOnlyBridge);
export const noConfusingVoidExpressionRule = createRustNativeRule(
  "no-confusing-void-expression",
  {},
  shallowTypedBridge,
);
export const noDeprecatedRule = createRustNativeRule("no-deprecated", {}, syntaxOnlyBridge);
export const noDuplicateTypeConstituentsRule = createRustNativeRule(
  "no-duplicate-type-constituents",
  {},
  {
    ...syntaxOnlyBridge,
    includeText: (_node: any, depth: number) => depth <= 1,
  },
);
export const noMisusedPromisesRule = createRustNativeRule("no-misused-promises", {}, typedBridge);
export const noMisusedSpreadRule = createRustNativeRule("no-misused-spread", {}, typedBridge);
export const noRedundantTypeConstituentsRule = createRustNativeRule(
  "no-redundant-type-constituents",
  {},
  {
    ...syntaxOnlyBridge,
    includeText: (_node: any, depth: number) => depth <= 1,
  },
);
export const noUnnecessaryBooleanLiteralCompareRule = createRustNativeRule(
  "no-unnecessary-boolean-literal-compare",
  {},
  typedBridge,
);
export const noUnnecessaryConditionRule = createRustNativeRule(
  "no-unnecessary-condition",
  {},
  shallowTypedBridge,
);
export const noUnnecessaryQualifierRule = createRustNativeRule(
  "no-unnecessary-qualifier",
  {},
  syntaxOnlyBridge,
);
export const noUnnecessaryTemplateExpressionRule = createRustNativeRule(
  "no-unnecessary-template-expression",
  {},
  syntaxOnlyBridge,
);
export const noUnnecessaryTypeArgumentsRule = createRustNativeRule(
  "no-unnecessary-type-arguments",
  {},
  typedBridge,
);
export const noUnnecessaryTypeAssertionRule = createRustNativeRule(
  "no-unnecessary-type-assertion",
  {},
  typedBridge,
);
export const noUnnecessaryTypeConversionRule = createRustNativeRule(
  "no-unnecessary-type-conversion",
  {},
  typedBridge,
);
export const noUnnecessaryTypeParametersRule = createRustNativeRule(
  "no-unnecessary-type-parameters",
  {},
  syntaxOnlyBridge,
);
export const noUnsafeArgumentRule = createRustNativeRule("no-unsafe-argument", {}, typedBridge);
export const noUnsafeEnumComparisonRule = createRustNativeRule(
  "no-unsafe-enum-comparison",
  {},
  shallowTypedBridge,
);
export const noUselessDefaultAssignmentRule = createRustNativeRule(
  "no-useless-default-assignment",
  {},
  syntaxOnlyBridge,
);
export const nonNullableTypeAssertionStyleRule = createRustNativeRule(
  "non-nullable-type-assertion-style",
  {},
  typedBridge,
);
export const preferNullishCoalescingRule = createRustNativeRule(
  "prefer-nullish-coalescing",
  {},
  shallowTypedBridge,
);
export const preferOptionalChainRule = createRustNativeRule(
  "prefer-optional-chain",
  {},
  syntaxOnlyBridge,
);
export const preferReadonlyRule = createRustNativeRule("prefer-readonly", {}, typedBridge);
export const preferReadonlyParameterTypesRule = createRustNativeRule(
  "prefer-readonly-parameter-types",
  {},
  typedBridge,
);
export const preferReturnThisTypeRule = createRustNativeRule(
  "prefer-return-this-type",
  {},
  typedBridge,
);
export const promiseFunctionAsyncRule = createRustNativeRule(
  "promise-function-async",
  {},
  typedBridge,
);
export const relatedGetterSetterPairsRule = createRustNativeRule(
  "related-getter-setter-pairs",
  {},
  typedBridge,
);
export const requireAwaitRule = createRustNativeRule("require-await", {}, functionBodyTypedBridge);
export const returnAwaitRule = createRustNativeRule("return-await", {}, typedBridge);
export const strictBooleanExpressionsRule = createRustNativeRule(
  "strict-boolean-expressions",
  {},
  shallowTypedBridge,
);
export const strictVoidReturnRule = createRustNativeRule("strict-void-return", {}, typedBridge);
export const switchExhaustivenessCheckRule = createRustNativeRule(
  "switch-exhaustiveness-check",
  {},
  shallowTypedBridge,
);
export const unboundMethodRule = createRustNativeRule("unbound-method", {}, shallowTypedBridge);
