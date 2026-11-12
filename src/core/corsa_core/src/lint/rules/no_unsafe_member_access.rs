use serde_json::Value;

use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::TypeDetail;
use crate::lint::helpers::{
    is_any_like_node, member_object, rule_option_bool, strip_chain_expression,
};

/// Type-aware rule that rejects member access through unsafe values.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnsafeMemberAccessRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unsafeComputedMemberAccess",
        description: "Computed name {{property}} resolves to an `any` value.",
    },
    RuleMessage {
        id: "unsafeMemberExpression",
        description: "Unsafe member access {{property}} on an `any` value.",
    },
    RuleMessage {
        id: "unsafeThisMemberExpression",
        description: "Unsafe member access {{property}} on an `any` value. `this` is typed as `any`.",
    },
];
const LISTENERS: &[&str] = &["MemberExpression"];

impl RustLintRule for NoUnsafeMemberAccessRule {
    fn name(&self) -> &'static str {
        "no-unsafe-member-access"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow member access on values typed as any."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "MemberExpression" {
            return;
        }
        if allow_optional_chaining(node) && node.field_bool("optional") == Some(true) {
            return;
        }
        // `class C implements A.B` / `interface I extends A.B` name types, not values.
        if is_in_heritage_clause(node) {
            return;
        }

        if let Some(object) = node.child("object") {
            report_unsafe_object_access(ctx, node, object);
        }
        if node.field_bool("computed").unwrap_or(false) {
            report_unsafe_computed_key(ctx, node);
        }
    }
}

fn allow_optional_chaining(node: &LintNode) -> bool {
    rule_option_bool(node, "allowOptionalChaining").unwrap_or(false)
}

/// typescript-eslint `isTypeAnyType` on the checker type, falling back to the
/// rendered text when the host sent no checker detail.
fn is_any_typed(node: &LintNode) -> bool {
    match TypeDetail::of(node) {
        Some(detail) => detail.is_any(),
        None => is_any_like_node(node),
    }
}

fn is_in_heritage_clause(node: &LintNode) -> bool {
    node.fields
        .get("__ancestorChain")
        .and_then(Value::as_array)
        .is_some_and(|chain| {
            chain.iter().any(|ancestor| {
                matches!(
                    ancestor.get("kind").and_then(Value::as_str),
                    Some("TSClassImplements" | "TSInterfaceHeritage")
                )
            })
        })
}

fn report_unsafe_object_access(ctx: &mut RuleContext<'_>, node: &LintNode, object: &LintNode) {
    if !is_any_typed(object) || is_reported_by_inner_member(object) {
        return;
    }
    let property = node.child("property");
    let report_range = property.map_or(node.range, |property| property.range);
    let computed = node.field_bool("computed").unwrap_or(false);
    let name = property
        .map(|property| property_text(property, computed))
        .unwrap_or_default();
    ctx.report_with_data(
        "unsafeMemberExpression",
        report_range,
        &[("property", name.as_str())],
    );
}

fn report_unsafe_computed_key(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(property) = node.child("property") else {
        return;
    };
    if is_safe_computed_key(property) || !is_any_typed(property) {
        return;
    }
    let name = property_text(property, true);
    ctx.report_with_data(
        "unsafeComputedMemberAccess",
        property.range,
        &[("property", name.as_str())],
    );
}

/// typescript-eslint only skips a member whose object is itself a member
/// expression with an unsafe object (already reported). A parenthesized chain
/// `(a?.b).c` ends the chain, so `.c` is judged on its own.
fn is_reported_by_inner_member(object: &LintNode) -> bool {
    object.kind == "MemberExpression" && member_object(object).is_some_and(is_any_typed)
}

fn is_safe_computed_key(property: &LintNode) -> bool {
    let current = strip_chain_expression(property);
    current.kind == "Literal"
        || (current.kind == "UpdateExpression"
            && matches!(current.field_str("operator"), Some("++" | "--")))
}

/// `.name` or `[expression]`, as typescript-eslint names the accessed member.
fn property_text(property: &LintNode, computed: bool) -> String {
    let text = property
        .text
        .clone()
        .or_else(|| property.field_stringish("name"))
        .unwrap_or_default();
    if computed {
        format!("[{text}]")
    } else {
        format!(".{text}")
    }
}
