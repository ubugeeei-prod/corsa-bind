use super::super::{
    LintFix, LintNode, LintSuggestion, RuleContext, RuleMessage, RustLintRule, TextRange,
};
use crate::{
    lint::{
        helpers::rule_option_bool,
        type_tree::{TypeTree, flags},
    },
    utils::split_type_text,
};

/// Type-aware rule that rejects `void` when the expression is already void-like.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoMeaninglessVoidOperatorRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "meaninglessVoidOperator",
        description: "void operator should only be used to ignore a non-void return value.",
    },
    RuleMessage {
        id: "meaninglessVoidOnNonCall",
        description: "void operator is useless here; it should only discard a call's return value",
    },
    RuleMessage {
        id: "removeVoid",
        description: "Remove 'void'.",
    },
];
const LISTENERS: &[&str] = &["UnaryExpression"];

impl RustLintRule for NoMeaninglessVoidOperatorRule {
    fn name(&self) -> &'static str {
        "no-meaningless-void-operator"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow void operators on expressions that are already void-like."
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
        if node.kind != "UnaryExpression" || node.field_str("operator") != Some("void") {
            return;
        }
        let Some(argument) = node.child("argument") else {
            return;
        };
        let inner = unwrap_void_argument(argument);
        if inner.kind != "CallExpression" {
            check_non_call(ctx, node, argument, inner);
            return;
        }
        if let Some(shape) = TypeTree::of(argument) {
            if !shape.parts_known() {
                return;
            }
            let parts = shape.union_parts();
            let void_like = parts
                .iter()
                .all(|part| part.has(flags::VOID | flags::UNDEFINED));
            let void_like_or_never = parts
                .iter()
                .all(|part| part.has(flags::VOID | flags::UNDEFINED | flags::NEVER));
            if void_like || (check_never(node) && void_like_or_never) {
                report_void_operator(ctx, node, argument);
            }
            return;
        }
        if is_always_void_like(&argument.type_texts)
            || (check_never(node) && is_always_void_like_or_never(&argument.type_texts))
        {
            ctx.report_with_suggestions(
                "meaninglessVoidOperator",
                node.range,
                remove_void_suggestion(node, argument).into_iter().collect(),
            );
        }
    }
}

/// typescript-eslint's `unwrapVoidArgument`: look through chains, type
/// assertions, non-null assertions and to the last expression of a sequence.
fn unwrap_void_argument(node: &LintNode) -> &LintNode {
    let mut current = node;
    loop {
        let next = match current.kind.as_str() {
            "ChainExpression"
            | "TSAsExpression"
            | "TSNonNullExpression"
            | "TSSatisfiesExpression"
            | "TSTypeAssertion"
            | "ParenthesizedExpression" => current.child("expression"),
            "SequenceExpression" => current
                .child_list("expressions")
                .and_then(|expressions| expressions.last()),
            _ => None,
        };
        match next {
            Some(next) => current = next,
            None => return current,
        }
    }
}

/// `void` on anything but a call discards nothing, except the `void 0`
/// idiom, `void (x = value)` and `void promise` (left to no-floating-promises).
fn check_non_call(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    argument: &LintNode,
    inner: &LintNode,
) {
    if inner.kind == "Literal" && inner.field_f64("value") == Some(0.0) {
        return;
    }
    if inner.kind == "AssignmentExpression" {
        return;
    }
    if argument.type_texts.is_empty() || is_thenable(argument) {
        return;
    }
    ctx.report("meaninglessVoidOnNonCall", node.range);
}

/// `tsutils.isThenableType`: some union constituent has a `then` method.
fn is_thenable(node: &LintNode) -> bool {
    if node.property_names.iter().any(|name| name == "then") {
        return true;
    }
    node.type_texts.iter().any(|text| {
        split_type_text(text).iter().any(|part| {
            let part = part.trim();
            let name = part.split('<').next().unwrap_or(part);
            matches!(name, "Promise" | "PromiseLike")
        })
    })
}

fn report_void_operator(ctx: &mut RuleContext<'_>, node: &LintNode, argument: &LintNode) {
    ctx.report_with_suggestions(
        "meaninglessVoidOperator",
        node.range,
        remove_void_suggestion(node, argument).into_iter().collect(),
    );
}

fn check_never(node: &LintNode) -> bool {
    rule_option_bool(node, "checkNever").unwrap_or(false)
}

fn is_always_void_like(type_texts: &[String]) -> bool {
    !type_texts.is_empty()
        && type_texts
            .iter()
            .flat_map(|text| split_type_text(text))
            .all(|text| matches!(text.trim(), "void" | "undefined"))
}

fn is_always_void_like_or_never(type_texts: &[String]) -> bool {
    !type_texts.is_empty()
        && type_texts
            .iter()
            .flat_map(|text| split_type_text(text))
            .all(|text| matches!(text.trim(), "void" | "undefined" | "never"))
}

fn remove_void_suggestion(node: &LintNode, argument: &LintNode) -> Option<LintSuggestion> {
    let remove_range = TextRange::new(node.range.start, argument.range.start);
    if !remove_range.is_valid() {
        return None;
    }
    Some(LintSuggestion {
        message_id: "removeVoid".to_owned(),
        message: "Remove 'void'.".to_owned(),
        fixes: vec![LintFix::remove_range(remove_range)],
    })
}
