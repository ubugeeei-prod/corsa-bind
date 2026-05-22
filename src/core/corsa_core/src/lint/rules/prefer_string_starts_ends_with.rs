use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    callee_property_name, child_list, identifier_name, is_zero_literal, member_object,
    member_property_name, strip_chain_expression,
};

/// Rule that prefers startsWith()/endsWith() over manual string checks.
#[derive(Clone, Copy, Debug, Default)]
pub struct PreferStringStartsEndsWithRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "endsWith",
        description: "Use endsWith() instead of slicing and comparing a suffix.",
    },
    RuleMessage {
        id: "startsWith",
        description: "Use startsWith() instead of comparing a prefix manually.",
    },
];
const LISTENERS: &[&str] = &["BinaryExpression"];

impl RustLintRule for PreferStringStartsEndsWithRule {
    fn name(&self) -> &'static str {
        "prefer-string-starts-ends-with"
    }

    fn docs_description(&self) -> &'static str {
        "Prefer startsWith()/endsWith() over manual string prefix/suffix checks."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn requires_type_texts(&self) -> bool {
        false
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "BinaryExpression"
            || !matches!(
                node.field_str("operator"),
                Some("==" | "===" | "!=" | "!==")
            )
        {
            return;
        }
        let Some(left) = node.child("left") else {
            return;
        };
        let Some(right) = node.child("right") else {
            return;
        };
        if let Some(message_id) = detect_manual_string_check(left, right)
            .or_else(|| detect_manual_string_check(right, left))
        {
            ctx.report(message_id, node.range);
        }
    }
}

fn detect_manual_string_check(candidate: &LintNode, compared: &LintNode) -> Option<&'static str> {
    let current = strip_chain_expression(candidate);
    if current.kind != "CallExpression" {
        return None;
    }

    if callee_property_name(Some(current)).as_deref() == Some("indexOf")
        && is_zero_literal(compared)
    {
        return Some("startsWith");
    }

    if callee_property_name(Some(current)).as_deref() != Some("slice") {
        return None;
    }

    let args = child_list(current, "arguments");
    let start = args.first()?;
    let end = args.get(1);
    if is_zero_literal(start) && end.is_some_and(|end| same_length_target(end, compared)) {
        return Some("startsWith");
    }

    let suffix = negative_length_target(start);
    if end.is_none() && suffix.is_some_and(|suffix| same_expression(suffix, compared)) {
        return Some("endsWith");
    }

    None
}

fn same_length_target(length_node: &LintNode, compared: &LintNode) -> bool {
    if member_property_name(length_node).as_deref() != Some("length") {
        return false;
    }
    member_object(length_node).is_some_and(|target| same_expression(target, compared))
}

fn negative_length_target(node: &LintNode) -> Option<&LintNode> {
    let current = strip_chain_expression(node);
    if current.kind != "UnaryExpression" || current.field_str("operator") != Some("-") {
        return None;
    }
    let target = current.child("argument").and_then(member_object)?;
    (member_property_name(current.child("argument")?).as_deref() == Some("length"))
        .then_some(target)
}

fn same_expression(left: &LintNode, right: &LintNode) -> bool {
    let left = strip_chain_expression(left);
    let right = strip_chain_expression(right);
    if left.kind != right.kind {
        return false;
    }
    match left.kind.as_str() {
        "Identifier" => identifier_name(left) == identifier_name(right),
        "Literal" => left.fields.get("value") == right.fields.get("value"),
        "ThisExpression" | "Super" => true,
        "MemberExpression" => {
            member_property_name(left) == member_property_name(right)
                && match (member_object(left), member_object(right)) {
                    (Some(left_object), Some(right_object)) => {
                        same_expression(left_object, right_object)
                    }
                    _ => false,
                }
        }
        _ => left.range == right.range,
    }
}
