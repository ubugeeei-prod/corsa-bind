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
import { noUnsafeUnaryMinusRule } from "./no_unsafe_unary_minus";
import { onlyThrowErrorRule } from "./only_throw_error";
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
  "no-array-delete",
  "no-base-to-string",
  "no-floating-promises",
  "no-for-in-array",
  "no-implied-eval",
  "no-meaningless-void-operator",
  "no-mixed-enums",
  "no-unsafe-assignment",
  "no-unsafe-call",
  "no-unsafe-member-access",
  "no-unsafe-return",
  "no-unsafe-unary-minus",
  "only-throw-error",
  "prefer-find",
  "prefer-includes",
  "prefer-promise-reject-errors",
  "prefer-reduce-type-parameter",
  "prefer-regexp-exec",
  "prefer-string-starts-ends-with",
  "require-array-sort-compare",
  "restrict-plus-operands",
  "restrict-template-expressions",
  "use-unknown-in-catch-callback-variable",
] as const;

export const pendingNativeRuleNames = [
  "consistent-return",
  "consistent-type-exports",
  "dot-notation",
  "no-confusing-void-expression",
  "no-deprecated",
  "no-duplicate-type-constituents",
  "no-misused-promises",
  "no-misused-spread",
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
  "no-unsafe-enum-comparison",
  "no-unsafe-type-assertion",
  "no-useless-default-assignment",
  "non-nullable-type-assertion-style",
  "prefer-nullish-coalescing",
  "prefer-optional-chain",
  "prefer-readonly",
  "prefer-readonly-parameter-types",
  "prefer-return-this-type",
  "promise-function-async",
  "related-getter-setter-pairs",
  "require-await",
  "return-await",
  "strict-boolean-expressions",
  "strict-void-return",
  "switch-exhaustiveness-check",
  "unbound-method",
] as const;

export const typescriptOxlintRules = Object.freeze({
  "await-thenable": awaitThenableRule,
  "no-array-delete": noArrayDeleteRule,
  "no-base-to-string": noBaseToStringRule,
  "no-floating-promises": noFloatingPromisesRule,
  "no-for-in-array": noForInArrayRule,
  "no-implied-eval": noImpliedEvalRule,
  "no-meaningless-void-operator": noMeaninglessVoidOperatorRule,
  "no-mixed-enums": noMixedEnumsRule,
  "no-unsafe-assignment": noUnsafeAssignmentRule,
  "no-unsafe-call": noUnsafeCallRule,
  "no-unsafe-member-access": noUnsafeMemberAccessRule,
  "no-unsafe-return": noUnsafeReturnRule,
  "no-unsafe-unary-minus": noUnsafeUnaryMinusRule,
  "only-throw-error": onlyThrowErrorRule,
  "prefer-find": preferFindRule,
  "prefer-includes": preferIncludesRule,
  "prefer-promise-reject-errors": preferPromiseRejectErrorsRule,
  "prefer-reduce-type-parameter": preferReduceTypeParameterRule,
  "prefer-regexp-exec": preferRegexpExecRule,
  "prefer-string-starts-ends-with": preferStringStartsEndsWithRule,
  "require-array-sort-compare": requireArraySortCompareRule,
  "restrict-plus-operands": restrictPlusOperandsRule,
  "restrict-template-expressions": restrictTemplateExpressionsRule,
  "use-unknown-in-catch-callback-variable": useUnknownInCatchCallbackVariableRule,
});

export const typescriptOxlintPlugin = definePlugin({
  meta: { name: "oxlint-plugin-corsa" },
  rules: typescriptOxlintRules,
});
