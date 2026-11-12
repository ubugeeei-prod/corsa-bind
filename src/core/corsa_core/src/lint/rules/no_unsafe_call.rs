use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::TypeDetail;
use crate::lint::helpers::{is_any_like_node, strip_chain_expression};

/// Type-aware rule that rejects calling values with unsafe callable types.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnsafeCallRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unsafeCall",
        description: "Unsafe call of a(n) `any` typed value.",
    },
    RuleMessage {
        id: "unsafeCallThis",
        description: "Unsafe call of a(n) `any` typed value. `this` is typed as `any`.",
    },
    RuleMessage {
        id: "unsafeNew",
        description: "Unsafe construction of a(n) `any` typed value.",
    },
    RuleMessage {
        id: "unsafeTemplateTag",
        description: "Unsafe use of a(n) `any` typed template tag.",
    },
];
const LISTENERS: &[&str] = &[
    "CallExpression",
    "NewExpression",
    "TaggedTemplateExpression",
];

impl RustLintRule for NoUnsafeCallRule {
    fn name(&self) -> &'static str {
        "no-unsafe-call"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow calling values typed as any."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "CallExpression" => {
                let Some(callee) = node.child("callee") else {
                    return;
                };
                if is_import_expression(callee) {
                    return;
                }
                report_if_unsafe(ctx, callee, "unsafeCall", callee);
            }
            "NewExpression" => {
                let Some(callee) = node.child("callee") else {
                    return;
                };
                report_if_unsafe(ctx, callee, "unsafeNew", node);
            }
            "TaggedTemplateExpression" => {
                let Some(tag) = node.child("tag") else {
                    return;
                };
                report_if_unsafe(ctx, tag, "unsafeTemplateTag", tag);
            }
            _ => {}
        }
    }
}

fn report_if_unsafe(
    ctx: &mut RuleContext<'_>,
    callee: &LintNode,
    message_id: &'static str,
    report_node: &LintNode,
) {
    // The checker gives the `super` keyword no type of its own (it answers
    // `any`); only a host that typed it from the extended class can judge it.
    if strip_chain_expression(callee).kind == "Super"
        && callee.field_bool("__typedFromSuperClass") != Some(true)
    {
        return;
    }
    let is_any = match TypeDetail::of(callee) {
        Some(detail) => detail.constrained().is_any(),
        None => is_any_like_node(callee),
    };
    if is_any || is_unsafe_function_type(callee) {
        ctx.report(message_id, report_node.range);
    }
}

/// typescript-eslint treats the global `Function` (and its subtypes) as unsafe
/// unless the type also has a call or construct signature. (A `new` through
/// void-returning call signatures alone is unsafe too; the host does not
/// report return types here, so such a `new` stays silent.) Without signature
/// counts from the host, the `Function` text alone decides.
fn is_unsafe_function_type(callee: &LintNode) -> bool {
    if !is_function_type(callee) {
        return false;
    }
    match (
        callee.field_f64("__callSignatureCount"),
        callee.field_f64("__constructSignatureCount"),
    ) {
        (Some(call), Some(construct)) => call <= 0.0 && construct <= 0.0,
        _ => true,
    }
}

fn is_import_expression(node: &LintNode) -> bool {
    let current = strip_chain_expression(node);
    matches!(
        current.kind.as_str(),
        "Import" | "ImportExpression" | "ImportKeyword"
    )
}

fn is_function_type(node: &LintNode) -> bool {
    let named = node.type_texts.iter().any(|text| {
        let text = text.trim();
        text == "Function" || text.ends_with(" & Function") || text.ends_with(" extends Function")
    });
    named || (node.fields.contains_key("__callSignatureCount") && has_function_members(node))
}

/// The members of the global `Function` interface, which a subtype such as
/// `interface Unsafe extends Function {}` inherits.
fn has_function_members(node: &LintNode) -> bool {
    ["apply", "call", "bind", "prototype"]
        .iter()
        .all(|name| node.property_names.iter().any(|property| property == name))
}
