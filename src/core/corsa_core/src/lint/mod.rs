//! Rust-authored lint rule primitives and built-in type-aware rules.

mod context;
mod helpers;
mod registry;
mod rules;
#[cfg(test)]
mod tests;
mod types;

pub use context::{RuleContext, RustLintRule};
pub use registry::{LintRuleRegistry, run_default_type_aware_rule};
pub use rules::{
    AwaitThenableRule, NoArrayDeleteRule, NoBaseToStringRule, NoForInArrayRule, NoImpliedEvalRule,
    NoMixedEnumsRule, NoUnsafeAssignmentRule, NoUnsafeUnaryMinusRule, OnlyThrowErrorRule,
    PreferFindRule, PreferIncludesRule, PreferRegexpExecRule,
    UseUnknownInCatchCallbackVariableRule,
};
pub use types::{
    LintDiagnostic, LintFix, LintNode, LintSuggestion, RuleMessage, RuleMeta, TextRange,
};
