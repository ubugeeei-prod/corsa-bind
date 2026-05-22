use super::super::{LintFix, LintNode, LintSuggestion, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    callee_property_name, child_list, is_obviously_promise_like, is_promise_like_node,
    member_object, strip_chain_expression,
};

/// Type-aware rule that requires promises to be awaited or explicitly handled.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoFloatingPromisesRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unexpected",
        description: "Promises must be awaited, returned, or explicitly ignored with void.",
    },
    RuleMessage {
        id: "floatingVoid",
        description: "Prefix the expression with void.",
    },
    RuleMessage {
        id: "floatingAwait",
        description: "Await the promise.",
    },
];
const LISTENERS: &[&str] = &["ExpressionStatement"];

impl RustLintRule for NoFloatingPromisesRule {
    fn name(&self) -> &'static str {
        "no-floating-promises"
    }

    fn docs_description(&self) -> &'static str {
        "Require promises to be awaited or otherwise handled."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn has_suggestions(&self) -> bool {
        true
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "ExpressionStatement" {
            return;
        }
        let Some(expression) = node.child("expression").map(strip_chain_expression) else {
            return;
        };
        if expression.kind == "UnaryExpression" && expression.field_str("operator") == Some("void")
        {
            return;
        }
        if !(is_obviously_promise_like(expression) || is_promise_like_node(expression))
            || is_handled(expression)
        {
            return;
        }
        ctx.report_with_suggestions("unexpected", node.range, suggestions(node, expression));
    }
}

fn is_handled(node: &LintNode) -> bool {
    let current = strip_chain_expression(node);
    let Some(property_name) = callee_property_name(Some(current)) else {
        return false;
    };
    match property_name.as_str() {
        "catch" => !child_list(current, "arguments").is_empty(),
        "then" => child_list(current, "arguments").len() > 1,
        "finally" => current
            .child("callee")
            .and_then(member_object)
            .is_some_and(is_handled),
        _ => false,
    }
}

fn suggestions(node: &LintNode, expression: &LintNode) -> Vec<LintSuggestion> {
    let insertion = super::super::TextRange::new(expression.range.start, expression.range.start);
    let mut suggestions = vec![LintSuggestion {
        message_id: "floatingVoid".to_owned(),
        message: "Prefix the expression with void.".to_owned(),
        fixes: vec![LintFix::replace_range(insertion, "void ")],
    }];
    if node.field_bool("__nearestFunctionAsync").unwrap_or(false) {
        suggestions.push(LintSuggestion {
            message_id: "floatingAwait".to_owned(),
            message: "Await the promise.".to_owned(),
            fixes: vec![LintFix::replace_range(insertion, "await ")],
        });
    }
    suggestions
}
