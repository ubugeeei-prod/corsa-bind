import { definePlugin } from "../plugin";

import { awaitThenableRule } from "./await_thenable";
import { noArrayDeleteRule } from "./no_array_delete";
import { noBaseToStringRule } from "./no_base_to_string";
import { noFloatingPromisesRule } from "./no_floating_promises";
import { noForInArrayRule } from "./no_for_in_array";
import { noImpliedEvalRule } from "./no_implied_eval";
import { noMeaninglessVoidOperatorRule } from "./no_meaningless_void_operator";
import { noMixedEnumsRule } from "./no_mixed_enums";
import { noUnsafeAssignmentRule } from "./no_unsafe_assignment";
import { noUnsafeCallRule } from "./no_unsafe_call";
import { noUnsafeMemberAccessRule } from "./no_unsafe_member_access";
import { noUnsafeReturnRule } from "./no_unsafe_return";
import { noUnsafeTypeAssertionRule } from "./no_unsafe_type_assertion";
import { noUnsafeUnaryMinusRule } from "./no_unsafe_unary_minus";
import { onlyThrowErrorRule } from "./only_throw_error";
import {
  consistentReturnRule,
  consistentTypeExportsRule,
  dotNotationRule,
  noConfusingVoidExpressionRule,
  noDeprecatedRule,
  noDuplicateTypeConstituentsRule,
  noMisusedPromisesRule,
  noMisusedSpreadRule,
  noRedundantTypeConstituentsRule,
  noUnsafeArgumentRule,
  noUnsafeEnumComparisonRule,
  noUnnecessaryBooleanLiteralCompareRule,
  noUnnecessaryConditionRule,
  noUnnecessaryQualifierRule,
  noUnnecessaryTemplateExpressionRule,
  noUnnecessaryTypeArgumentsRule,
  noUnnecessaryTypeAssertionRule,
  noUnnecessaryTypeConversionRule,
  noUnnecessaryTypeParametersRule,
  noUselessDefaultAssignmentRule,
  nonNullableTypeAssertionStyleRule,
  preferNullishCoalescingRule,
  preferOptionalChainRule,
  preferReadonlyParameterTypesRule,
  preferReadonlyRule,
  preferReturnThisTypeRule,
  promiseFunctionAsyncRule,
  relatedGetterSetterPairsRule,
  requireAwaitRule,
  returnAwaitRule,
  strictBooleanExpressionsRule,
  strictVoidReturnRule,
  switchExhaustivenessCheckRule,
  unboundMethodRule,
} from "./pending_parity";
import { preferFindRule } from "./prefer_find";
import { preferIncludesRule } from "./prefer_includes";
import { preferPromiseRejectErrorsRule } from "./prefer_promise_reject_errors";
import { preferReduceTypeParameterRule } from "./prefer_reduce_type_parameter";
import { preferRegexpExecRule } from "./prefer_regexp_exec";
import { preferStringStartsEndsWithRule } from "./prefer_string_starts_ends_with";
import { requireArraySortCompareRule } from "./require_array_sort_compare";
import { restrictPlusOperandsRule } from "./restrict_plus_operands";
import { restrictTemplateExpressionsRule } from "./restrict_template_expressions";
import { useUnknownInCatchCallbackVariableRule } from "./use_unknown_in_catch_callback_variable";

export const implementedNativeRuleNames = [
  "await-thenable",
  "consistent-return",
  "consistent-type-exports",
  "dot-notation",
  "no-array-delete",
  "no-base-to-string",
  "no-confusing-void-expression",
  "no-deprecated",
  "no-duplicate-type-constituents",
  "no-floating-promises",
  "no-for-in-array",
  "no-implied-eval",
  "no-meaningless-void-operator",
  "no-misused-promises",
  "no-misused-spread",
  "no-mixed-enums",
  "no-redundant-type-constituents",
  "no-unnecessary-boolean-literal-compare",
  "no-unnecessary-condition",
  "no-unnecessary-qualifier",
  "no-unnecessary-template-expression",
  "no-unnecessary-type-arguments",
  "no-unnecessary-type-assertion",
  "no-unnecessary-type-conversion",
  "no-unnecessary-type-parameters",
  "no-unsafe-argument",
  "no-unsafe-assignment",
  "no-unsafe-call",
  "no-unsafe-enum-comparison",
  "no-unsafe-member-access",
  "no-unsafe-return",
  "no-unsafe-type-assertion",
  "no-unsafe-unary-minus",
  "no-useless-default-assignment",
  "non-nullable-type-assertion-style",
  "only-throw-error",
  "prefer-find",
  "prefer-includes",
  "prefer-nullish-coalescing",
  "prefer-optional-chain",
  "prefer-promise-reject-errors",
  "prefer-readonly",
  "prefer-readonly-parameter-types",
  "prefer-reduce-type-parameter",
  "prefer-regexp-exec",
  "prefer-return-this-type",
  "prefer-string-starts-ends-with",
  "promise-function-async",
  "related-getter-setter-pairs",
  "require-array-sort-compare",
  "require-await",
  "restrict-plus-operands",
  "restrict-template-expressions",
  "return-await",
  "strict-boolean-expressions",
  "strict-void-return",
  "switch-exhaustiveness-check",
  "unbound-method",
  "use-unknown-in-catch-callback-variable",
] as const;

export const pendingNativeRuleNames = [] as const;

export const typescriptOxlintRules = Object.freeze({
  "await-thenable": awaitThenableRule,
  "consistent-return": consistentReturnRule,
  "consistent-type-exports": consistentTypeExportsRule,
  "dot-notation": dotNotationRule,
  "no-array-delete": noArrayDeleteRule,
  "no-base-to-string": noBaseToStringRule,
  "no-confusing-void-expression": noConfusingVoidExpressionRule,
  "no-deprecated": noDeprecatedRule,
  "no-duplicate-type-constituents": noDuplicateTypeConstituentsRule,
  "no-floating-promises": noFloatingPromisesRule,
  "no-for-in-array": noForInArrayRule,
  "no-implied-eval": noImpliedEvalRule,
  "no-meaningless-void-operator": noMeaninglessVoidOperatorRule,
  "no-misused-promises": noMisusedPromisesRule,
  "no-misused-spread": noMisusedSpreadRule,
  "no-mixed-enums": noMixedEnumsRule,
  "no-redundant-type-constituents": noRedundantTypeConstituentsRule,
  "no-unnecessary-boolean-literal-compare": noUnnecessaryBooleanLiteralCompareRule,
  "no-unnecessary-condition": noUnnecessaryConditionRule,
  "no-unnecessary-qualifier": noUnnecessaryQualifierRule,
  "no-unnecessary-template-expression": noUnnecessaryTemplateExpressionRule,
  "no-unnecessary-type-arguments": noUnnecessaryTypeArgumentsRule,
  "no-unnecessary-type-assertion": noUnnecessaryTypeAssertionRule,
  "no-unnecessary-type-conversion": noUnnecessaryTypeConversionRule,
  "no-unnecessary-type-parameters": noUnnecessaryTypeParametersRule,
  "no-unsafe-argument": noUnsafeArgumentRule,
  "no-unsafe-assignment": noUnsafeAssignmentRule,
  "no-unsafe-call": noUnsafeCallRule,
  "no-unsafe-enum-comparison": noUnsafeEnumComparisonRule,
  "no-unsafe-member-access": noUnsafeMemberAccessRule,
  "no-unsafe-return": noUnsafeReturnRule,
  "no-unsafe-type-assertion": noUnsafeTypeAssertionRule,
  "no-unsafe-unary-minus": noUnsafeUnaryMinusRule,
  "no-useless-default-assignment": noUselessDefaultAssignmentRule,
  "non-nullable-type-assertion-style": nonNullableTypeAssertionStyleRule,
  "only-throw-error": onlyThrowErrorRule,
  "prefer-find": preferFindRule,
  "prefer-includes": preferIncludesRule,
  "prefer-nullish-coalescing": preferNullishCoalescingRule,
  "prefer-optional-chain": preferOptionalChainRule,
  "prefer-promise-reject-errors": preferPromiseRejectErrorsRule,
  "prefer-readonly": preferReadonlyRule,
  "prefer-readonly-parameter-types": preferReadonlyParameterTypesRule,
  "prefer-reduce-type-parameter": preferReduceTypeParameterRule,
  "prefer-regexp-exec": preferRegexpExecRule,
  "prefer-return-this-type": preferReturnThisTypeRule,
  "prefer-string-starts-ends-with": preferStringStartsEndsWithRule,
  "promise-function-async": promiseFunctionAsyncRule,
  "related-getter-setter-pairs": relatedGetterSetterPairsRule,
  "require-array-sort-compare": requireArraySortCompareRule,
  "require-await": requireAwaitRule,
  "restrict-plus-operands": restrictPlusOperandsRule,
  "restrict-template-expressions": restrictTemplateExpressionsRule,
  "return-await": returnAwaitRule,
  "strict-boolean-expressions": strictBooleanExpressionsRule,
  "strict-void-return": strictVoidReturnRule,
  "switch-exhaustiveness-check": switchExhaustivenessCheckRule,
  "unbound-method": unboundMethodRule,
  "use-unknown-in-catch-callback-variable": useUnknownInCatchCallbackVariableRule,
});

export const typescriptOxlintPlugin = definePlugin({
  meta: { name: "oxlint-plugin-corsa" },
  rules: typescriptOxlintRules,
});
