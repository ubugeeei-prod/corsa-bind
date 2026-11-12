use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::{TypeDetail, flags};
use crate::lint::helpers::{is_number_or_bigint_literal, is_unary_minus_type_safe};

/// Type-aware rule that rejects unary minus on non-number-like values.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnsafeUnaryMinusRule;

const MESSAGES: &[RuleMessage] = &[RuleMessage {
    id: "unaryMinus",
    description: "Argument of unary negation should be assignable to number | bigint but is {{type}} instead.",
}];
const LISTENERS: &[&str] = &["UnaryExpression"];

impl RustLintRule for NoUnsafeUnaryMinusRule {
    fn name(&self) -> &'static str {
        "no-unsafe-unary-minus"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow unary negation on non-number and non-bigint values."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "UnaryExpression" || node.field_str("operator") != Some("-") {
            return;
        }
        let Some(argument) = node.child("argument") else {
            return;
        };
        if is_number_or_bigint_literal(argument) {
            return;
        }
        let safe = match TypeDetail::of(argument) {
            Some(detail) => is_negatable(detail),
            None => is_unary_minus_type_safe(&argument.type_texts),
        };
        if !safe {
            let name = argument
                .type_texts
                .first()
                .map_or("unknown", |text| text.trim());
            ctx.report_with_data("unaryMinus", node.range, &[("type", name)]);
        }
    }
}

/// Every union constituent of the constrained argument type is `any`, `never`,
/// number-like or bigint-like (typescript-eslint checks each constituent's own
/// flags, so `T extends number` and enum members pass).
fn is_negatable(detail: TypeDetail<'_>) -> bool {
    let negatable = flags::ANY | flags::NEVER | flags::BIGINT_LIKE | flags::NUMBER_LIKE;
    let parts = detail.constrained().parts();
    !parts.is_empty() && parts.iter().all(|part| part.flags & negatable != 0)
}
