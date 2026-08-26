import { createRustNativeRule } from "./native_bridge";

export const consistentReturnRule = createRustNativeRule("consistent-return");
export const consistentTypeExportsRule = createRustNativeRule("consistent-type-exports");
export const dotNotationRule = createRustNativeRule("dot-notation");
export const noConfusingVoidExpressionRule = createRustNativeRule("no-confusing-void-expression");
export const noDeprecatedRule = createRustNativeRule("no-deprecated");
export const noDuplicateTypeConstituentsRule = createRustNativeRule(
  "no-duplicate-type-constituents",
);
export const noMisusedPromisesRule = createRustNativeRule("no-misused-promises");
export const noMisusedSpreadRule = createRustNativeRule("no-misused-spread");
export const noRedundantTypeConstituentsRule = createRustNativeRule(
  "no-redundant-type-constituents",
);
export const noUnnecessaryBooleanLiteralCompareRule = createRustNativeRule(
  "no-unnecessary-boolean-literal-compare",
);
export const noUnnecessaryConditionRule = createRustNativeRule("no-unnecessary-condition");
export const noUnnecessaryQualifierRule = createRustNativeRule("no-unnecessary-qualifier");
export const noUnnecessaryTemplateExpressionRule = createRustNativeRule(
  "no-unnecessary-template-expression",
);
export const noUnnecessaryTypeArgumentsRule = createRustNativeRule("no-unnecessary-type-arguments");
export const noUnnecessaryTypeAssertionRule = createRustNativeRule("no-unnecessary-type-assertion");
export const noUnnecessaryTypeConversionRule = createRustNativeRule(
  "no-unnecessary-type-conversion",
);
export const noUnnecessaryTypeParametersRule = createRustNativeRule(
  "no-unnecessary-type-parameters",
);
export const noUnsafeArgumentRule = createRustNativeRule("no-unsafe-argument");
export const noUnsafeEnumComparisonRule = createRustNativeRule("no-unsafe-enum-comparison");
export const noUselessDefaultAssignmentRule = createRustNativeRule("no-useless-default-assignment");
export const nonNullableTypeAssertionStyleRule = createRustNativeRule(
  "non-nullable-type-assertion-style",
);
export const preferNullishCoalescingRule = createRustNativeRule("prefer-nullish-coalescing");
export const preferOptionalChainRule = createRustNativeRule("prefer-optional-chain");
export const preferReadonlyRule = createRustNativeRule("prefer-readonly");
export const preferReadonlyParameterTypesRule = createRustNativeRule(
  "prefer-readonly-parameter-types",
);
export const preferReturnThisTypeRule = createRustNativeRule("prefer-return-this-type");
export const promiseFunctionAsyncRule = createRustNativeRule("promise-function-async");
export const relatedGetterSetterPairsRule = createRustNativeRule("related-getter-setter-pairs");
export const requireAwaitRule = createRustNativeRule("require-await");
export const returnAwaitRule = createRustNativeRule("return-await");
export const strictBooleanExpressionsRule = createRustNativeRule("strict-boolean-expressions");
export const strictVoidReturnRule = createRustNativeRule("strict-void-return");
export const switchExhaustivenessCheckRule = createRustNativeRule("switch-exhaustiveness-check");
export const unboundMethodRule = createRustNativeRule("unbound-method");
