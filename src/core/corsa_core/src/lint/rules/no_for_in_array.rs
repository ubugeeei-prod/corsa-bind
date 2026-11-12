use super::super::{
    LintNode, RuleContext, RuleMessage, RustLintRule, constrained_shape::ConstrainedShape,
};
use crate::utils::is_array_like_type_texts;

/// Type-aware rule that rejects `for-in` loops over array-like values.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoForInArrayRule;

const MESSAGES: &[RuleMessage] = &[RuleMessage {
    id: "unexpected",
    description: "Do not iterate over an array with a for-in loop.",
}];
const LISTENERS: &[&str] = &["ForInStatement"];

impl RustLintRule for NoForInArrayRule {
    fn name(&self) -> &'static str {
        "no-for-in-array"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow for-in iteration over array-like values."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "ForInStatement" {
            return;
        }
        let Some(right) = node.child("right") else {
            return;
        };
        if right.field_bool("__typeFactsMissing").unwrap_or(false) {
            return;
        }
        // `isArrayLike(getConstrainedTypeAtLocation(node.right))`: some union or
        // intersection constituent has a number index signature and a
        // number-like `length`.
        let array_like = match ConstrainedShape::of(right) {
            Some(shape) => shape.some_leaf(&|part| part.is_array_like()),
            None => right.kind == "ArrayExpression" || is_array_like_type_texts(&right.type_texts),
        };
        if array_like {
            ctx.report("unexpected", node.range);
        }
    }
}
