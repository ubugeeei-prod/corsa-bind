//! Promise rules over the host's checker facts (`__promiseFacts`).
use serde_json::{Value, json};

use super::{LintDiagnostic, LintNode, LintRuleRegistry, TextRange};

fn run(rule: &str, node: Value) -> Vec<LintDiagnostic> {
    let node: LintNode = serde_json::from_value(node).expect("valid LintNode");
    LintRuleRegistry::with_default_type_aware_rules()
        .run_rule(rule, &node)
        .expect("registered rule")
}

fn ids(diagnostics: &[LintDiagnostic]) -> Vec<&str> {
    diagnostics
        .iter()
        .map(|diagnostic| diagnostic.message_id.as_str())
        .collect()
}

fn expr(kind: &str, start: u32, end: u32, facts: Value) -> Value {
    json!({
        "kind": kind,
        "range": { "start": start, "end": end },
        "fields": { "__promiseFacts": facts }
    })
}

fn await_of(facts: Value) -> Value {
    json!({
        "kind": "AwaitExpression",
        "range": { "start": 0, "end": 9 },
        "children": { "argument": expr("Identifier", 6, 9, facts) }
    })
}

#[test]
fn await_thenable_follows_needs_to_be_awaited() {
    let never = run(
        "await-thenable",
        await_of(json!({ "flags": 64, "awaitable": "never" })),
    );
    assert_eq!(ids(&never), ["unexpected"]);
    // `any`, `unknown` and unconstrained generics may still be awaited.
    let may = run(
        "await-thenable",
        await_of(json!({ "flags": 1, "awaitable": "may" })),
    );
    assert!(may.is_empty());
    let always = run(
        "await-thenable",
        await_of(json!({ "flags": 0, "awaitable": "always" })),
    );
    assert!(always.is_empty());
}

fn aggregator(argument: Value, options: Option<Value>) -> Value {
    let mut fields = serde_json::Map::new();
    if let Some(options) = options {
        fields.insert("__ruleOptions".into(), json!([options]));
    }
    json!({
        "kind": "CallExpression",
        "range": { "start": 0, "end": 30 },
        "fields": fields,
        "children": {
            "callee": {
                "kind": "MemberExpression",
                "range": { "start": 0, "end": 11 },
                "fields": { "computed": false },
                "children": {
                    "object": expr("Identifier", 0, 7, json!({ "flags": 0, "promiseConstructor": true })),
                    "property": { "kind": "Identifier", "range": { "start": 8, "end": 11 }, "fields": { "name": "all" } }
                }
            }
        },
        "childLists": { "arguments": [argument] }
    })
}

#[test]
fn await_thenable_checks_promise_aggregators() {
    let mixed = expr(
        "Identifier",
        12,
        29,
        json!({ "flags": 0, "invalidAggregatorInput": true, "maybeAwaitableValue": true }),
    );
    let reported = run("await-thenable", aggregator(mixed.clone(), None));
    assert_eq!(ids(&reported), ["invalidPromiseAggregatorInput"]);
    assert_eq!(reported[0].range, TextRange::new(12, 29));
    // `allowMixedPromiseArrays` accepts an iterable that may hold a promise.
    let allowed = run(
        "await-thenable",
        aggregator(mixed, Some(json!({ "allowMixedPromiseArrays": true }))),
    );
    assert!(allowed.is_empty());
    let array = json!({
        "kind": "ArrayExpression",
        "range": { "start": 12, "end": 29 },
        "childLists": { "elements": [
            expr("Literal", 13, 14, json!({ "flags": 0, "nonAwaitable": true })),
            expr("CallExpression", 16, 28, json!({ "flags": 0, "nonAwaitable": false }))
        ] }
    });
    let elements = run("await-thenable", aggregator(array, None));
    assert_eq!(ids(&elements), ["invalidPromiseAggregatorInput"]);
    assert_eq!(elements[0].range, TextRange::new(13, 14));
}

#[test]
fn await_thenable_checks_for_await_and_await_using() {
    let for_await = run(
        "await-thenable",
        json!({
            "kind": "ForOfStatement",
            "range": { "start": 0, "end": 40 },
            "fields": { "await": true },
            "children": { "right": expr("Identifier", 20, 25, json!({ "flags": 0, "asyncIterable": false })) }
        }),
    );
    assert_eq!(ids(&for_await), ["forAwaitOfNonAsyncIterable"]);
    let using = run(
        "await-thenable",
        json!({
            "kind": "VariableDeclaration",
            "range": { "start": 0, "end": 30 },
            "fields": { "kind": "await using" },
            "childLists": { "declarations": [
                { "kind": "VariableDeclarator", "range": { "start": 12, "end": 29 },
                  "children": { "init": expr("Identifier", 16, 29, json!({ "flags": 0, "asyncDisposable": false })) } },
                { "kind": "VariableDeclarator", "range": { "start": 12, "end": 29 },
                  "children": { "init": expr("Identifier", 16, 29, json!({ "flags": 1, "asyncDisposable": false })) } }
            ] }
        }),
    );
    assert_eq!(ids(&using), ["awaitUsingOfNonAsyncDisposable"]);
}

fn call_with(argument: Value, fields: Value) -> Value {
    json!({
        "kind": "CallExpression",
        "range": { "start": 0, "end": 30 },
        "fields": fields,
        "children": { "callee": { "kind": "Identifier", "range": { "start": 0, "end": 3 }, "fields": { "name": "use" } } },
        "childLists": { "arguments": [argument] }
    })
}

#[test]
fn misused_promises_merges_signature_and_contextual_argument_facts() {
    let argument = |fields: Value| {
        let mut value = expr(
            "ArrowFunctionExpression",
            4,
            20,
            json!({ "flags": 0, "returnsThenable": true }),
        );
        for (key, field) in fields.as_object().into_iter().flatten() {
            value["fields"][key] = field.clone();
        }
        value
    };
    let signature = run(
        "no-misused-promises",
        call_with(
            argument(json!({})),
            json!({ "__voidArgumentIndices": [0], "__thenableArgumentIndices": [] }),
        ),
    );
    assert_eq!(ids(&signature), ["voidReturnArgument"]);
    // An instantiated generic parameter is only visible as the contextual type.
    let contextual = run(
        "no-misused-promises",
        call_with(
            argument(json!({ "__contextualVoidFunction": true })),
            json!({ "__voidArgumentIndices": [], "__thenableArgumentIndices": [] }),
        ),
    );
    assert_eq!(ids(&contextual), ["voidReturnArgument"]);
    // A position that also accepts a thenable-returning function is fine.
    let overload = run(
        "no-misused-promises",
        call_with(
            argument(json!({ "__contextualThenableFunction": true })),
            json!({ "__voidArgumentIndices": [0], "__thenableArgumentIndices": [] }),
        ),
    );
    assert!(overload.is_empty());
}

fn if_test(facts: Value, options: Option<Value>) -> Value {
    let mut fields = serde_json::Map::new();
    if let Some(options) = options {
        fields.insert("__ruleOptions".into(), json!([options]));
    }
    json!({
        "kind": "IfStatement",
        "range": { "start": 0, "end": 20 },
        "fields": fields,
        "children": { "test": expr("CallExpression", 4, 7, facts) }
    })
}

#[test]
fn misused_promises_honors_flag_unions() {
    let union = json!({ "flags": 0, "alwaysThenable": false, "thenable": true, "matchingPromiseUnion": false });
    assert!(run("no-misused-promises", if_test(union.clone(), None)).is_empty());
    let all = run(
        "no-misused-promises",
        if_test(
            union.clone(),
            Some(json!({ "checksConditionals": { "flagUnions": "all" } })),
        ),
    );
    assert_eq!(ids(&all), ["conditional"]);
    let strict = run(
        "no-misused-promises",
        if_test(
            union,
            Some(json!({ "checksConditionals": { "flagUnions": "strict" } })),
        ),
    );
    assert!(strict.is_empty());
    let matching = json!({ "flags": 0, "alwaysThenable": false, "thenable": true, "matchingPromiseUnion": true });
    let strict = run(
        "no-misused-promises",
        if_test(
            matching,
            Some(json!({ "checksConditionals": { "flagUnions": "strict" } })),
        ),
    );
    assert_eq!(ids(&strict), ["conditional"]);
}

fn logical(chain: Value) -> Value {
    json!({
        "kind": "LogicalExpression",
        "range": { "start": 0, "end": 20 },
        "fields": { "operator": "||", "__ancestorChain": chain },
        "children": {
            "left": expr("CallExpression", 0, 10, json!({ "flags": 0, "alwaysThenable": true })),
            "right": expr("Literal", 14, 19, json!({ "flags": 0, "alwaysThenable": false }))
        }
    })
}

#[test]
fn misused_promises_checks_each_logical_expression_once() {
    let statement = run(
        "no-misused-promises",
        logical(json!([{ "kind": "ExpressionStatement", "childKey": "expression" }])),
    );
    assert_eq!(ids(&statement), ["conditional"]);
    // The `if` test check reaches this logical expression first.
    let in_test = run(
        "no-misused-promises",
        logical(json!([{ "kind": "IfStatement", "childKey": "test" }])),
    );
    assert!(in_test.is_empty());
}

#[test]
fn only_throw_error_reads_checker_facts() {
    let throw = |facts: Value| {
        json!({
            "kind": "ThrowStatement",
            "range": { "start": 0, "end": 12 },
            "children": { "argument": expr("Identifier", 6, 11, facts) }
        })
    };
    // A class merely named `...Error` is not Error-like.
    assert_eq!(
        ids(&run(
            "only-throw-error",
            throw(json!({ "flags": 0, "error": false }))
        )),
        ["object"]
    );
    assert!(
        run(
            "only-throw-error",
            throw(json!({ "flags": 0, "error": true }))
        )
        .is_empty()
    );
    // The checker's error type is `any`, allowed by default.
    assert!(
        run(
            "only-throw-error",
            throw(json!({ "flags": 1, "error": false }))
        )
        .is_empty()
    );
    assert_eq!(
        ids(&run(
            "only-throw-error",
            throw(json!({ "flags": 4, "error": false }))
        )),
        ["undef"]
    );
}

#[test]
fn only_throw_error_rethrow_needs_a_plain_parameter() {
    let throw = |first_is_identifier: bool| {
        json!({
            "kind": "ThrowStatement",
            "range": { "start": 30, "end": 38 },
            "fields": { "__ancestorFacts": [{
                "kind": "ArrowFunctionExpression",
                "paramNames": ["e"],
                "firstParamIsIdentifier": first_is_identifier,
                "parentKind": "CallExpression",
                "parentCalleePropertyName": "catch",
                "parentArgumentIndex": 0
            }] },
            "children": { "argument": {
                "kind": "Identifier",
                "range": { "start": 36, "end": 37 },
                "fields": { "name": "e", "__promiseFacts": { "flags": 0, "error": false } }
            } }
        })
    };
    assert!(run("only-throw-error", throw(true)).is_empty());
    assert_eq!(ids(&run("only-throw-error", throw(false))), ["object"]);
}

#[test]
fn prefer_promise_reject_errors_reads_constructor_and_error_facts() {
    let reject = |object: Value, argument: Value| {
        json!({
            "kind": "CallExpression",
            "range": { "start": 0, "end": 20 },
            "children": { "callee": {
                "kind": "MemberExpression",
                "range": { "start": 0, "end": 14 },
                "fields": { "computed": false },
                "children": {
                    "object": object,
                    "property": { "kind": "Identifier", "range": { "start": 8, "end": 14 }, "fields": { "name": "reject" } }
                }
            } },
            "childLists": { "arguments": [argument] }
        })
    };
    let alias = expr(
        "Identifier",
        0,
        3,
        json!({ "flags": 0, "promiseConstructor": true, "promise": false }),
    );
    let reported = run(
        "prefer-promise-reject-errors",
        reject(
            alias.clone(),
            expr("Literal", 15, 16, json!({ "flags": 0, "error": false })),
        ),
    );
    assert_eq!(ids(&reported), ["rejectAnError"]);
    assert!(
        run(
            "prefer-promise-reject-errors",
            reject(
                alias,
                expr("Identifier", 15, 18, json!({ "flags": 0, "error": true }))
            ),
        )
        .is_empty()
    );
    let other = expr(
        "Identifier",
        0,
        3,
        json!({ "flags": 0, "promiseConstructor": false, "promise": false }),
    );
    assert!(
        run(
            "prefer-promise-reject-errors",
            reject(
                other,
                expr("Literal", 15, 16, json!({ "flags": 0, "error": false }))
            ),
        )
        .is_empty()
    );
}

#[test]
fn require_await_names_the_function_and_reads_yield_facts() {
    let generator = |argument_facts: Value| {
        json!({
            "kind": "FunctionDeclaration",
            "range": { "start": 0, "end": 40 },
            "fields": { "async": true, "generator": true, "__functionName": "run" },
            "children": { "body": {
                "kind": "BlockStatement",
                "range": { "start": 20, "end": 40 },
                "childLists": { "body": [{
                    "kind": "ExpressionStatement",
                    "range": { "start": 22, "end": 38 },
                    "children": { "expression": {
                        "kind": "YieldExpression",
                        "range": { "start": 22, "end": 37 },
                        "fields": { "delegate": false },
                        "children": { "argument": expr("Identifier", 28, 37, argument_facts) }
                    } }
                }] }
            } }
        })
    };
    let reported = run(
        "require-await",
        generator(json!({ "flags": 0, "thenable": false })),
    );
    assert_eq!(ids(&reported), ["missingAwait"]);
    assert_eq!(
        reported[0].message,
        "Async generator function 'run' has no 'await' expression."
    );
    assert!(
        run(
            "require-await",
            generator(json!({ "flags": 0, "thenable": true }))
        )
        .is_empty()
    );
}

#[test]
fn use_unknown_in_catch_callback_variable_reads_handler_facts() {
    let catch_call = |object_facts: Value, handler_facts: Value| {
        json!({
            "kind": "CallExpression",
            "range": { "start": 0, "end": 30 },
            "children": { "callee": {
                "kind": "MemberExpression",
                "range": { "start": 0, "end": 9 },
                "fields": { "computed": false },
                "children": {
                    "object": expr("Identifier", 0, 3, object_facts),
                    "property": { "kind": "Identifier", "range": { "start": 4, "end": 9 }, "fields": { "name": "catch" } }
                }
            } },
            "childLists": { "arguments": [{
                "kind": "ArrowFunctionExpression",
                "range": { "start": 10, "end": 29 },
                "fields": { "__promiseFacts": handler_facts },
                "childLists": { "params": [{ "kind": "Identifier", "range": { "start": 11, "end": 14 }, "fields": { "name": "err" } }] }
            }] }
        })
    };
    let reported = run(
        "use-unknown-in-catch-callback-variable",
        catch_call(
            json!({ "flags": 0, "thenable": true }),
            json!({ "flags": 0, "flaggableHandler": true }),
        ),
    );
    assert_eq!(ids(&reported), ["useUnknown"]);
    assert_eq!(
        reported[0].message,
        "Prefer the safe `: unknown` for a `catch` callback variable."
    );
    assert!(
        run(
            "use-unknown-in-catch-callback-variable",
            catch_call(
                json!({ "flags": 0, "thenable": true }),
                json!({ "flags": 0, "flaggableHandler": false })
            ),
        )
        .is_empty()
    );
    // Not a thenable: not a promise catch.
    assert!(
        run(
            "use-unknown-in-catch-callback-variable",
            catch_call(
                json!({ "flags": 0, "thenable": false }),
                json!({ "flags": 0, "flaggableHandler": true })
            ),
        )
        .is_empty()
    );
}

#[test]
fn no_floating_promises_reads_promise_and_handler_facts() {
    let statement = |expression: Value| {
        json!({
            "kind": "ExpressionStatement",
            "range": { "start": 0, "end": 20 },
            "children": { "expression": expression }
        })
    };
    // `PromiseLike` is not the built-in Promise, so it is not checked by default.
    let like = run(
        "no-floating-promises",
        statement(expr(
            "CallExpression",
            0,
            19,
            json!({ "flags": 0, "promise": false, "promiseArray": false }),
        )),
    );
    assert!(like.is_empty());
    let promise = run(
        "no-floating-promises",
        statement(expr(
            "Identifier",
            0,
            7,
            json!({ "flags": 0, "promise": true, "promiseArray": false }),
        )),
    );
    assert_eq!(ids(&promise), ["floatingVoid"]);
    let array = run(
        "no-floating-promises",
        statement(expr(
            "Identifier",
            0,
            7,
            json!({ "flags": 0, "promise": false, "promiseArray": true }),
        )),
    );
    assert_eq!(ids(&array), ["floatingPromiseArrayVoid"]);
}
