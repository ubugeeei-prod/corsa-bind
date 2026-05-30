//! Rust-authored lint rule primitives and built-in type-aware rules.

mod context;
mod helpers;
mod registry;
mod rules;
mod stylistic;
#[cfg(test)]
mod stylistic_conformance;
#[cfg(test)]
mod stylistic_golden;
#[cfg(test)]
mod tests;
mod types;

pub use context::{RuleContext, RustLintRule};
pub use registry::{LintRuleRegistry, run_default_type_aware_rule};
pub use rules::{
    AwaitThenableRule, ConsistentReturnRule, ConsistentTypeExportsRule, DotNotationRule,
    NoArrayDeleteRule, NoBaseToStringRule, NoConfusingVoidExpressionRule, NoDeprecatedRule,
    NoDuplicateTypeConstituentsRule, NoFloatingPromisesRule, NoForInArrayRule, NoImpliedEvalRule,
    NoMeaninglessVoidOperatorRule, NoMisusedPromisesRule, NoMisusedSpreadRule, NoMixedEnumsRule,
    NoRedundantTypeConstituentsRule, NoUnnecessaryBooleanLiteralCompareRule,
    NoUnnecessaryConditionRule, NoUnnecessaryQualifierRule, NoUnnecessaryTemplateExpressionRule,
    NoUnnecessaryTypeArgumentsRule, NoUnnecessaryTypeAssertionRule,
    NoUnnecessaryTypeConversionRule, NoUnnecessaryTypeParametersRule, NoUnsafeArgumentRule,
    NoUnsafeAssignmentRule, NoUnsafeCallRule, NoUnsafeEnumComparisonRule, NoUnsafeMemberAccessRule,
    NoUnsafeReturnRule, NoUnsafeTypeAssertionRule, NoUnsafeUnaryMinusRule,
    NoUselessDefaultAssignmentRule, NonNullableTypeAssertionStyleRule, OnlyThrowErrorRule,
    PreferFindRule, PreferIncludesRule, PreferNullishCoalescingRule, PreferOptionalChainRule,
    PreferPromiseRejectErrorsRule, PreferReadonlyParameterTypesRule, PreferReadonlyRule,
    PreferReduceTypeParameterRule, PreferRegexpExecRule, PreferReturnThisTypeRule,
    PreferStringStartsEndsWithRule, PromiseFunctionAsyncRule, RelatedGetterSetterPairsRule,
    RequireArraySortCompareRule, RequireAwaitRule, RestrictPlusOperandsRule,
    RestrictTemplateExpressionsRule, ReturnAwaitRule, StrictBooleanExpressionsRule,
    StrictVoidReturnRule, SwitchExhaustivenessCheckRule, UnboundMethodRule,
    UseUnknownInCatchCallbackVariableRule,
};
pub use stylistic::{
    StylisticRuleConfig, StylisticRunConfig, run_stylistic_lint, stylistic_rule_metas,
};
pub use types::{
    LintDiagnostic, LintFix, LintNode, LintSuggestion, RuleMessage, RuleMeta, TextRange,
};
