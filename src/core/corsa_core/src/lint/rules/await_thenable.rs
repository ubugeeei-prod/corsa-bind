use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule, TextRange};
use crate::lint::helpers::{
    child_list, is_obviously_promise_like, is_promise_like_node, member_object, rule_option_bool,
    strip_chain_expression,
};
use crate::lint::promise_facts::{awaitable, is_any, promise_fact, static_member_name};

/// Type-aware rule that rejects `await` on values without a thenable shape,
/// `for await` over values that are not async iterable, `await using` of
/// values that are not async disposable, and promise aggregators
/// (`Promise.all` and friends) given iterables of non-thenables.
///
/// With the host's checker facts (`__promiseFacts`) this follows
/// typescript-eslint exactly; without them only `await` is checked, from
/// rendered type texts.
#[derive(Clone, Copy, Debug, Default)]
pub struct AwaitThenableRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unexpected",
        description: "Unexpected `await` of a non-Promise (non-\"Thenable\") value.",
    },
    RuleMessage {
        id: "awaitUsingOfNonAsyncDisposable",
        description: "Unexpected `await using` of a value that is not async disposable.",
    },
    RuleMessage {
        id: "forAwaitOfNonAsyncIterable",
        description: "Unexpected `for await...of` of a value that is not async iterable.",
    },
    RuleMessage {
        id: "invalidPromiseAggregatorInput",
        description: "Unexpected iterable of non-Promise (non-\"Thenable\") values passed to promise aggregator.",
    },
];
const LISTENERS: &[&str] = &[
    "AwaitExpression",
    "CallExpression",
    "ForOfStatement",
    "VariableDeclaration",
];
const AGGREGATORS: &[&str] = &["all", "allSettled", "any", "race"];

impl RustLintRule for AwaitThenableRule {
    fn name(&self) -> &'static str {
        "await-thenable"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow awaiting a value that is not a Thenable."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "AwaitExpression" => check_await(ctx, node),
            "CallExpression" => check_aggregator(ctx, node),
            "ForOfStatement" => check_for_await(ctx, node),
            "VariableDeclaration" => check_await_using(ctx, node),
            _ => {}
        }
    }
}

fn check_await(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(argument) = node.child("argument") else {
        return;
    };
    // With checker facts, mirror `needsToBeAwaited`: only a value that is
    // certainly not thenable is reported (`any`, `unknown` and unresolved
    // generics may still be awaited).
    if let Some(certainty) = awaitable(argument) {
        if certainty == "never" {
            ctx.report("unexpected", node.range);
        }
        return;
    }
    if !is_promise_like_node(argument) && !is_obviously_promise_like(argument) {
        ctx.report("unexpected", node.range);
    }
}

/// `isPromiseAggregatorMethod` and the aggregator input checks.
fn check_aggregator(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(callee) = node.child("callee").map(strip_chain_expression) else {
        return;
    };
    if !static_member_name(callee).is_some_and(|name| AGGREGATORS.contains(&name.as_str())) {
        return;
    }
    let constructor = member_object(callee)
        .and_then(|object| promise_fact(object, "promiseConstructor"))
        .unwrap_or(false);
    if !constructor {
        return;
    }
    let Some(argument) = child_list(node, "arguments").first() else {
        return;
    };
    let allow_mixed = rule_option_bool(node, "allowMixedPromiseArrays").unwrap_or(false);
    if allow_mixed && promise_fact(argument, "maybeAwaitableValue") == Some(true) {
        return;
    }
    if argument.kind == "ArrayExpression" {
        for element in child_list(argument, "elements") {
            if promise_fact(element, "nonAwaitable") == Some(true) {
                ctx.report("invalidPromiseAggregatorInput", element.range);
            }
        }
        return;
    }
    if promise_fact(argument, "invalidAggregatorInput") == Some(true) {
        ctx.report("invalidPromiseAggregatorInput", argument.range);
    }
}

fn check_for_await(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_bool("await") != Some(true) {
        return;
    }
    let Some(right) = node.child("right") else {
        return;
    };
    if is_any(right) == Some(true) {
        return;
    }
    if promise_fact(right, "asyncIterable") == Some(false) {
        // Upstream reports the loop head, `for await (... of right)`.
        let end = right.range.end.saturating_add(1).min(node.range.end);
        ctx.report(
            "forAwaitOfNonAsyncIterable",
            TextRange::new(node.range.start, end),
        );
    }
}

fn check_await_using(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_str("kind") != Some("await using") {
        return;
    }
    for declarator in child_list(node, "declarations") {
        let Some(init) = declarator.child("init") else {
            continue;
        };
        if is_any(init) == Some(true) {
            continue;
        }
        if promise_fact(init, "asyncDisposable") == Some(false) {
            ctx.report("awaitUsingOfNonAsyncDisposable", init.range);
        }
    }
}
