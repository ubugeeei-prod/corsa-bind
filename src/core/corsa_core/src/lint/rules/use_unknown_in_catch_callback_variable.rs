use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    callee_property_name, child_list, has_unknown_type_annotation, member_object,
    strip_chain_expression,
};
use crate::lint::promise_facts::{promise_fact, static_member_name};

/// Rule that requires Promise catch callback variables to be typed `unknown`.
#[derive(Clone, Copy, Debug, Default)]
pub struct UseUnknownInCatchCallbackVariableRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unexpected",
        description: "Catch callback variables should be explicitly typed as unknown.",
    },
    RuleMessage {
        id: "useUnknown",
        description: "Prefer the safe `: unknown` for a `{{method}}`{{append}} callback variable.",
    },
    RuleMessage {
        id: "useUnknownArrayDestructuringPattern",
        description: "Prefer the safe `: unknown` for a `{{method}}`{{append}} callback variable. The thrown error may not be iterable.",
    },
    RuleMessage {
        id: "useUnknownObjectDestructuringPattern",
        description: "Prefer the safe `: unknown` for a `{{method}}`{{append}} callback variable. The thrown error may be nullable, or may not have the expected shape.",
    },
];
const LISTENERS: &[&str] = &["CallExpression"];

impl RustLintRule for UseUnknownInCatchCallbackVariableRule {
    fn name(&self) -> &'static str {
        "use-unknown-in-catch-callback-variable"
    }

    fn docs_description(&self) -> &'static str {
        "Require Promise catch callback variables to use an explicit unknown annotation."
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
        if node.kind != "CallExpression" {
            return;
        }
        if checked_by_facts(ctx, node) {
            return;
        }
        let property_name = callee_property_name(Some(node));
        let callback = match property_name.as_deref() {
            Some("catch") => child_list(node, "arguments").first(),
            Some("then") => child_list(node, "arguments").get(1),
            _ => None,
        };
        let Some(callback) = callback else {
            return;
        };
        if !callback.kind.contains("Function") {
            return;
        }
        let Some(parameter) = callback
            .child_list("params")
            .and_then(|params| params.first())
        else {
            return;
        };
        if !has_unknown_type_annotation(parameter) {
            ctx.report("unexpected", parameter.range);
        }
    }
}

/// typescript-eslint's flow over the host's checker facts: the callee object
/// must be thenable, the handler and every argument before it ordinary, and a
/// handler is flagged when a call signature's first parameter is not the
/// intrinsic `unknown`. Returns `false` when the facts are missing.
fn checked_by_facts(ctx: &mut RuleContext<'_>, node: &LintNode) -> bool {
    let Some(callee) = node.child("callee").map(strip_chain_expression) else {
        return false;
    };
    let Some(object) = member_object(callee) else {
        return false;
    };
    let Some(thenable) = promise_fact(object, "thenable") else {
        return false;
    };
    let (index, append) = match static_member_name(callee).as_deref() {
        Some("catch") => (0, ""),
        Some("then") => (1, " rejection"),
        _ => return true,
    };
    let method = if index == 0 { "catch" } else { "then" };
    let arguments = child_list(node, "arguments");
    let Some(handler) = arguments.get(index) else {
        return true;
    };
    if !thenable
        || arguments
            .iter()
            .take(index + 1)
            .any(|argument| argument.kind == "SpreadElement")
    {
        return true;
    }
    let mut flagged = Vec::new();
    collect_flagged(handler, &mut flagged);
    for function in flagged {
        let Some(parameter) = child_list(function, "params").first() else {
            continue;
        };
        let inner = if parameter.kind == "AssignmentPattern" {
            parameter.child("left").unwrap_or(parameter)
        } else {
            parameter
        };
        let base =
            format!("Prefer the safe `: unknown` for a `{method}`{append} callback variable.");
        let (message_id, message) = match inner.kind.as_str() {
            "ArrayPattern" => (
                "useUnknownArrayDestructuringPattern",
                format!("{base} The thrown error may not be iterable."),
            ),
            "ObjectPattern" => (
                "useUnknownObjectDestructuringPattern",
                format!(
                    "{base} The thrown error may be nullable, or may not have the expected shape."
                ),
            ),
            _ => ("useUnknown", base),
        };
        ctx.report_with_message(message_id, message, parameter.range);
    }
    true
}

/// `collectFlaggedNodes`: handlers reached through logical, sequence (last
/// operand) and conditional expressions.
fn collect_flagged<'a>(node: &'a LintNode, out: &mut Vec<&'a LintNode>) {
    match node.kind.as_str() {
        "LogicalExpression" => {
            if let Some(left) = node.child("left") {
                collect_flagged(left, out);
            }
            if let Some(right) = node.child("right") {
                collect_flagged(right, out);
            }
        }
        "SequenceExpression" => {
            if let Some(last) = child_list(node, "expressions").last() {
                collect_flagged(last, out);
            }
        }
        "ConditionalExpression" => {
            if let Some(consequent) = node.child("consequent") {
                collect_flagged(consequent, out);
            }
            if let Some(alternate) = node.child("alternate") {
                collect_flagged(alternate, out);
            }
        }
        "ArrowFunctionExpression" | "FunctionExpression"
            if promise_fact(node, "flaggableHandler") == Some(true) =>
        {
            out.push(node);
        }
        _ => {}
    }
}
