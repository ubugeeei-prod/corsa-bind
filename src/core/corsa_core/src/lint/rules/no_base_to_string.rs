use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::{
    lint::helpers::{
        callee_property_name, child_list, is_identifier_named, is_literal_string, member_object,
        strip_chain_expression,
    },
    utils::{
        TypeTextKind, classify_type_text, is_string_like_type_texts, split_top_level_type_text,
    },
};

/// Type-aware rule that rejects values stringified through base Object#toString.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoBaseToStringRule;

const MESSAGES: &[RuleMessage] = &[RuleMessage {
    id: "unexpected",
    description: "This value is stringified through its base Object#toString() representation.",
}];
const LISTENERS: &[&str] = &["BinaryExpression", "CallExpression", "TemplateLiteral"];

impl RustLintRule for NoBaseToStringRule {
    fn name(&self) -> &'static str {
        "no-base-to-string"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow stringifying values that fall back to Object.prototype.toString()."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "BinaryExpression" if node.field_str("operator") == Some("+") => {
                let Some(left) = node.child("left") else {
                    return;
                };
                let Some(right) = node.child("right") else {
                    return;
                };
                if is_literal_string(left) || is_string_like_type_texts(&left.type_texts) {
                    report_if_unsafe(ctx, right);
                }
                if is_literal_string(right) || is_string_like_type_texts(&right.type_texts) {
                    report_if_unsafe(ctx, left);
                }
            }
            "CallExpression" => {
                let Some(first_argument) = child_list(node, "arguments").first() else {
                    return;
                };
                if node
                    .child("callee")
                    .is_some_and(|callee| is_identifier_named(callee, "String"))
                {
                    report_if_unsafe(ctx, first_argument);
                    return;
                }
                if callee_property_name(Some(node)).as_deref() == Some("toString")
                    && let Some(object) = node.child("callee").and_then(member_object)
                {
                    report_if_unsafe(ctx, object);
                }
            }
            "TemplateLiteral" => {
                for expression in child_list(node, "expressions") {
                    report_if_unsafe(ctx, expression);
                }
            }
            _ => {}
        }
    }
}

fn report_if_unsafe(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if is_possibly_base_to_string(node) {
        ctx.report("unexpected", node.range);
    }
}

fn is_possibly_base_to_string(node: &LintNode) -> bool {
    let current = strip_chain_expression(node);
    if matches!(
        current.kind.as_str(),
        "ArrayExpression" | "ObjectExpression" | "ArrowFunctionExpression" | "FunctionExpression"
    ) {
        return true;
    }
    !node.type_texts.is_empty()
        && node.type_texts.iter().any(|text| {
            split_top_level_type_text(text, '|')
                .iter()
                .any(|part| is_unsafe_stringified_text(part))
        })
}

fn is_unsafe_stringified_text(text: &str) -> bool {
    let current = text.trim();
    if matches!(
        classify_type_text(Some(current)),
        TypeTextKind::String
            | TypeTextKind::Number
            | TypeTextKind::Bigint
            | TypeTextKind::Boolean
            | TypeTextKind::Nullish
            | TypeTextKind::Regexp
    ) {
        return false;
    }
    if current == "symbol" {
        return true;
    }
    if matches!(
        current,
        "Date"
            | "Error"
            | "EvalError"
            | "RangeError"
            | "ReferenceError"
            | "RegExp"
            | "SyntaxError"
            | "TypeError"
            | "URIError"
            | "URL"
            | "URLSearchParams"
    ) {
        return false;
    }
    current == "object"
        || current == "Object"
        || current.starts_with('{')
        || current.ends_with("[]")
        || current.starts_with('[')
        || current.starts_with("Array<")
        || current.starts_with("ReadonlyArray<")
        || current.starts_with("Map<")
        || current.starts_with("ReadonlyMap<")
        || current.starts_with("Set<")
        || current.starts_with("ReadonlySet<")
        || current.starts_with("Record<")
        || current.starts_with("WeakMap<")
        || current.starts_with("WeakSet<")
        || current.starts_with("Promise<")
        || current.contains("=>")
}
