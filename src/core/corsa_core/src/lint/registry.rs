use super::{
    AwaitThenableRule, LintDiagnostic, LintNode, NoArrayDeleteRule, NoBaseToStringRule,
    NoForInArrayRule, NoImpliedEvalRule, NoMixedEnumsRule, NoUnsafeAssignmentRule,
    NoUnsafeUnaryMinusRule, OnlyThrowErrorRule, PreferFindRule, PreferIncludesRule,
    PreferRegexpExecRule, RequireArraySortCompareRule, RestrictPlusOperandsRule, RuleContext,
    RuleMeta, RustLintRule, UseUnknownInCatchCallbackVariableRule,
};

/// Collection of Rust-authored lint rules addressable by stable rule name.
#[derive(Default)]
pub struct LintRuleRegistry {
    rules: Vec<Box<dyn RustLintRule>>,
}

impl LintRuleRegistry {
    /// Creates an empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds one rule to the registry and returns the updated registry.
    pub fn with_rule(mut self, rule: impl RustLintRule + 'static) -> Self {
        self.rules.push(Box::new(rule));
        self
    }

    /// Creates a registry containing the built-in type-aware lint rules.
    pub fn with_default_type_aware_rules() -> Self {
        Self::new()
            .with_rule(NoArrayDeleteRule)
            .with_rule(NoForInArrayRule)
            .with_rule(NoBaseToStringRule)
            .with_rule(AwaitThenableRule)
            .with_rule(NoImpliedEvalRule)
            .with_rule(NoMixedEnumsRule)
            .with_rule(NoUnsafeAssignmentRule)
            .with_rule(NoUnsafeUnaryMinusRule)
            .with_rule(OnlyThrowErrorRule)
            .with_rule(PreferFindRule)
            .with_rule(PreferIncludesRule)
            .with_rule(PreferRegexpExecRule)
            .with_rule(RequireArraySortCompareRule)
            .with_rule(RestrictPlusOperandsRule)
            .with_rule(UseUnknownInCatchCallbackVariableRule)
    }

    /// Returns the stable names of every rule registered in insertion order.
    pub fn rule_names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.rules.iter().map(|rule| rule.name())
    }

    /// Returns serializable metadata for every registered rule.
    pub fn metas(&self) -> Vec<RuleMeta> {
        self.rules.iter().map(|rule| rule.meta()).collect()
    }

    /// Runs a single rule by name against one compact host-provided node.
    ///
    /// Returns `None` when `rule_name` is not registered.
    pub fn run_rule(&self, rule_name: &str, node: &LintNode) -> Option<Vec<LintDiagnostic>> {
        let rule = self
            .rules
            .iter()
            .find(|candidate| candidate.name() == rule_name)?;
        let mut ctx = RuleContext::new(rule.as_ref());
        rule.check(&mut ctx, node);
        Some(ctx.finish())
    }
}

/// Runs one built-in type-aware rule by name against a host-provided node.
///
/// This convenience helper rebuilds the default registry for simple FFI and
/// JavaScript bridge calls. Reuse [`LintRuleRegistry`] directly when running
/// many nodes.
pub fn run_default_type_aware_rule(
    rule_name: &str,
    node: &LintNode,
) -> Option<Vec<LintDiagnostic>> {
    LintRuleRegistry::with_default_type_aware_rules().run_rule(rule_name, node)
}
