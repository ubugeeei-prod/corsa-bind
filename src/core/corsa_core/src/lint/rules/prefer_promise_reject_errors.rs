use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::promise_facts::{is_any, is_unknown, promise_fact};
use crate::{
    lint::helpers::{
        child_list, is_any_like_node, is_error_like_node, is_identifier_named,
        is_promise_like_node, is_unknown_like_node, member_object, member_property_name,
        strip_chain_expression,
    },
    utils::is_promise_like_type_texts,
};

/// Type-aware rule that requires Promise rejection reasons to be Error-like.
#[derive(Clone, Copy, Debug, Default)]
pub struct PreferPromiseRejectErrorsRule;

const MESSAGES: &[RuleMessage] = &[RuleMessage {
    id: "rejectAnError",
    description: "Expected the Promise rejection reason to be an Error.",
}];
const LISTENERS: &[&str] = &["CallExpression"];

impl RustLintRule for PreferPromiseRejectErrorsRule {
    fn name(&self) -> &'static str {
        "prefer-promise-reject-errors"
    }

    fn docs_description(&self) -> &'static str {
        "Require Promise rejection reasons to be Error-like values."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "CallExpression"
            || (!is_promise_reject_call(node) && !is_promise_executor_reject_call(node))
        {
            return;
        }
        if accept_reject_arguments(node, child_list(node, "arguments")) {
            return;
        }
        ctx.report("rejectAnError", node.range);
    }
}

fn is_promise_reject_call(node: &LintNode) -> bool {
    let Some(callee) = node.child("callee") else {
        return false;
    };
    let Some(object) = member_object(callee) else {
        return false;
    };
    if member_property_name(callee).as_deref() != Some("reject") {
        return false;
    }
    if promise_fact(strip_chain_expression(object), "promiseConstructor").is_some() {
        return is_promise_like_object(object);
    }
    is_identifier_named(object, "Promise") || is_promise_like_object(object)
}

fn is_promise_like_object(node: &LintNode) -> bool {
    let current = strip_chain_expression(node);
    // Checker facts: `isPromiseConstructorLike || isPromiseLike`.
    if let Some(constructor) = promise_fact(current, "promiseConstructor") {
        return constructor || promise_fact(current, "promise") == Some(true);
    }
    is_promise_like_node(current)
        || is_promise_like_type_texts(&current.type_texts, &current.property_names)
}

fn is_promise_executor_reject_call(node: &LintNode) -> bool {
    node.field_bool("__promiseExecutorRejectCall")
        .unwrap_or(false)
}

fn accept_reject_arguments(node: &LintNode, args: &[LintNode]) -> bool {
    let Some(argument) = args.first() else {
        return rule_option(node, "allowEmptyReject", false);
    };
    if crate::lint::helpers::type_texts_match_names(
        &argument.type_texts,
        &crate::lint::helpers::rule_allow_list_names(node, "allow"),
    ) {
        return true;
    }
    if let Some(error) = promise_fact(argument, "error") {
        return (rule_option(node, "allowThrowingAny", false) && is_any(argument) == Some(true))
            || (rule_option(node, "allowThrowingUnknown", false)
                && is_unknown(argument) == Some(true))
            || error;
    }
    if rule_option(node, "allowThrowingAny", false) && is_any_like_node(argument) {
        return true;
    }
    if rule_option(node, "allowThrowingUnknown", false) && is_unknown_like_node(argument) {
        return true;
    }
    is_error_like_node(argument)
}

fn rule_option(node: &LintNode, key: &str, default: bool) -> bool {
    crate::lint::helpers::rule_option_bool(node, key).unwrap_or(default)
}
