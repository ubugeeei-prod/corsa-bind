use super::{
    AwaitThenableRule, ConsistentReturnRule, ConsistentTypeExportsRule, DotNotationRule,
    LintDiagnostic, LintNode, NoArrayDeleteRule, NoBaseToStringRule, NoConfusingVoidExpressionRule,
    NoDeprecatedRule, NoDuplicateTypeConstituentsRule, NoFloatingPromisesRule, NoForInArrayRule,
    NoImpliedEvalRule, NoMeaninglessVoidOperatorRule, NoMisusedPromisesRule, NoMisusedSpreadRule,
    NoMixedEnumsRule, NoRedundantTypeConstituentsRule, NoUnnecessaryBooleanLiteralCompareRule,
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
    RestrictTemplateExpressionsRule, ReturnAwaitRule, RuleContext, RuleMeta, RustLintRule,
    StrictBooleanExpressionsRule, StrictVoidReturnRule, SwitchExhaustivenessCheckRule,
    UnboundMethodRule, UseUnknownInCatchCallbackVariableRule,
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
            .with_rule(ConsistentReturnRule)
            .with_rule(ConsistentTypeExportsRule)
            .with_rule(DotNotationRule)
            .with_rule(NoArrayDeleteRule)
            .with_rule(NoBaseToStringRule)
            .with_rule(NoConfusingVoidExpressionRule)
            .with_rule(NoDeprecatedRule)
            .with_rule(NoDuplicateTypeConstituentsRule)
            .with_rule(NoFloatingPromisesRule)
            .with_rule(NoForInArrayRule)
            .with_rule(AwaitThenableRule)
            .with_rule(NoImpliedEvalRule)
            .with_rule(NoMeaninglessVoidOperatorRule)
            .with_rule(NoMisusedPromisesRule)
            .with_rule(NoMisusedSpreadRule)
            .with_rule(NoMixedEnumsRule)
            .with_rule(NoRedundantTypeConstituentsRule)
            .with_rule(NoUnnecessaryBooleanLiteralCompareRule)
            .with_rule(NoUnnecessaryConditionRule)
            .with_rule(NoUnnecessaryQualifierRule)
            .with_rule(NoUnnecessaryTemplateExpressionRule)
            .with_rule(NoUnnecessaryTypeArgumentsRule)
            .with_rule(NoUnnecessaryTypeAssertionRule)
            .with_rule(NoUnnecessaryTypeConversionRule)
            .with_rule(NoUnnecessaryTypeParametersRule)
            .with_rule(NoUnsafeArgumentRule)
            .with_rule(NoUnsafeAssignmentRule)
            .with_rule(NoUnsafeCallRule)
            .with_rule(NoUnsafeEnumComparisonRule)
            .with_rule(NoUnsafeMemberAccessRule)
            .with_rule(NoUnsafeReturnRule)
            .with_rule(NoUnsafeTypeAssertionRule)
            .with_rule(NoUnsafeUnaryMinusRule)
            .with_rule(NoUselessDefaultAssignmentRule)
            .with_rule(NonNullableTypeAssertionStyleRule)
            .with_rule(OnlyThrowErrorRule)
            .with_rule(PreferFindRule)
            .with_rule(PreferIncludesRule)
            .with_rule(PreferNullishCoalescingRule)
            .with_rule(PreferOptionalChainRule)
            .with_rule(PreferPromiseRejectErrorsRule)
            .with_rule(PreferReadonlyRule)
            .with_rule(PreferReadonlyParameterTypesRule)
            .with_rule(PreferReduceTypeParameterRule)
            .with_rule(PreferRegexpExecRule)
            .with_rule(PreferReturnThisTypeRule)
            .with_rule(PreferStringStartsEndsWithRule)
            .with_rule(PromiseFunctionAsyncRule)
            .with_rule(RelatedGetterSetterPairsRule)
            .with_rule(RequireArraySortCompareRule)
            .with_rule(RequireAwaitRule)
            .with_rule(RestrictPlusOperandsRule)
            .with_rule(RestrictTemplateExpressionsRule)
            .with_rule(ReturnAwaitRule)
            .with_rule(StrictBooleanExpressionsRule)
            .with_rule(StrictVoidReturnRule)
            .with_rule(SwitchExhaustivenessCheckRule)
            .with_rule(UnboundMethodRule)
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
