use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::TextRange;
use crate::lint::helpers::{
    child_list, is_promise_like_node, member_object, strip_chain_expression,
};
use crate::lint::promise_facts::{promise_fact, static_member_name};
use crate::utils::is_promise_like_type_texts;

/// Type-aware rule that disallows Promises in positions not designed to handle
/// them (boolean conditionals, spreads, and void-return contexts).
///
/// Faithful port of the tsgolint `no-misused-promises` rule. The decision logic
/// lives entirely in Rust over [`LintNode`] facts. Thenable detection reuses the
/// shared promise-like type-text helpers. Contextual "void-returning function
/// type" detection (which in the Go rule comes from the TypeScript checker's
/// `getContextualType`) is supplied as a raw fact, `__contextualReturnTypeTexts`,
/// the rendered return-type texts of the position's contextual function type.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoMisusedPromisesRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "conditional",
        description: "Expected non-Promise value in a boolean conditional.",
    },
    RuleMessage {
        id: "predicate",
        description: "Expected a non-Promise value to be returned.",
    },
    RuleMessage {
        id: "spread",
        description: "Expected a non-Promise value to be spread in an object.",
    },
    RuleMessage {
        id: "voidReturnArgument",
        description: "Promise returned in function argument where a void return was expected.",
    },
    RuleMessage {
        id: "voidReturnAttribute",
        description: "Promise-returning function provided to attribute where a void return was expected.",
    },
    RuleMessage {
        id: "voidReturnInheritedMethod",
        description: "Promise-returning method provided where a void return was expected by an \
             extended/implemented type.",
    },
    RuleMessage {
        id: "voidReturnProperty",
        description: "Promise-returning function provided to property where a void return was expected.",
    },
    RuleMessage {
        id: "voidReturnReturnValue",
        description: "Promise-returning function provided to return value where a void return was expected.",
    },
    RuleMessage {
        id: "voidReturnVariable",
        description: "Promise-returning function provided to variable where a void return was expected.",
    },
];

const LISTENERS: &[&str] = &[
    // checksConditionals
    "IfStatement",
    "WhileStatement",
    "DoWhileStatement",
    "ForStatement",
    "ConditionalExpression",
    "UnaryExpression",
    "LogicalExpression",
    "MemberExpression",
    // checksVoidReturn
    "CallExpression",
    "NewExpression",
    "JSXAttribute",
    "ClassDeclaration",
    "ClassExpression",
    "TSInterfaceDeclaration",
    "Property",
    "MethodDefinition",
    "ReturnStatement",
    "VariableDeclarator",
    "AssignmentExpression",
    // checksSpreads
    "SpreadElement",
];

impl RustLintRule for NoMisusedPromisesRule {
    fn name(&self) -> &'static str {
        "no-misused-promises"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow Promises in places not designed to handle them."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        let opts = Options::read(node);

        match node.kind.as_str() {
            // ---- checksConditionals: test-expression positions ----
            "IfStatement" | "WhileStatement" | "DoWhileStatement"
                if opts.checks_conditionals => {
                    if let Some(test) = node.child("test") {
                        check_conditional(ctx, test, true, opts.flag_unions);
                    }
                }
            "ForStatement"
                if opts.checks_conditionals => {
                    if let Some(test) = node.child("test") {
                        check_conditional(ctx, test, true, opts.flag_unions);
                    }
                }
            "ConditionalExpression"
                if opts.checks_conditionals => {
                    if let Some(test) = node.child("test") {
                        check_conditional(ctx, test, true, opts.flag_unions);
                    }
                }
            "UnaryExpression"
                if opts.checks_conditionals && node.field_str("operator") == Some("!") => {
                    if let Some(argument) = node.child("argument") {
                        check_conditional(ctx, argument, true, opts.flag_unions);
                    }
                }
            "LogicalExpression" if opts.checks_conditionals => {
                // Upstream checks every logical expression with
                // `isTestExpr = false` and dedups nodes it already reached from
                // a test position or an enclosing logical operand. Without a
                // shared dedup set, skip logicals another check reaches first;
                // that needs the host's `__ancestorChain` with `childKey`.
                if logical_reached_elsewhere(node) == Some(false) {
                    check_conditional(ctx, node, false, opts.flag_unions);
                }
            }
            "MemberExpression"
                // Array predicate methods: `arr.filter(async ...)` etc.
                if opts.checks_conditionals => {
                    check_array_predicate(ctx, node);
                }

            // ---- checksVoidReturn ----
            "CallExpression" | "NewExpression" => {
                if opts.checks_conditionals {
                    check_array_predicate_call(ctx, node);
                }
                if opts.checks_void_return.arguments {
                    check_arguments(ctx, node);
                }
            }
            "JSXAttribute"
                if opts.checks_void_return.attributes => {
                    check_jsx_attribute(ctx, node);
                }
            "ClassDeclaration" | "ClassExpression" | "TSInterfaceDeclaration"
                if opts.checks_void_return.inherited_methods => {
                    check_class_like_or_interface(ctx, node);
                }
            "Property"
                if opts.checks_void_return.properties => {
                    check_property(ctx, node);
                }
            "MethodDefinition"
                // Object-literal method shorthand surfaces as MethodDefinition in some
                // TS-ESTree shapes; only object-literal members are relevant.
                if opts.checks_void_return.properties
                    && node.field_str("__parentKind") == Some("ObjectExpression")
                => {
                    check_method(ctx, node);
                }
            "ReturnStatement"
                if opts.checks_void_return.returns => {
                    check_return_statement(ctx, node);
                }
            "VariableDeclarator"
                if opts.checks_void_return.variables => {
                    check_variable_declarator(ctx, node);
                }
            "AssignmentExpression"
                if opts.checks_void_return.variables => {
                    check_assignment(ctx, node);
                }

            // ---- checksSpreads ----
            "SpreadElement" if opts.checks_spreads => {
                check_spread(ctx, node);
            }
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
struct ChecksVoidReturn {
    arguments: bool,
    attributes: bool,
    inherited_methods: bool,
    properties: bool,
    returns: bool,
    variables: bool,
}

impl ChecksVoidReturn {
    const ALL: Self = Self {
        arguments: true,
        attributes: true,
        inherited_methods: true,
        properties: true,
        returns: true,
        variables: true,
    };
    const NONE: Self = Self {
        arguments: false,
        attributes: false,
        inherited_methods: false,
        properties: false,
        returns: false,
        variables: false,
    };
}

/// `checksConditionals.flagUnions`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FlagUnions {
    None,
    All,
    Strict,
}

#[derive(Clone, Copy, Debug)]
struct Options {
    checks_conditionals: bool,
    flag_unions: FlagUnions,
    checks_spreads: bool,
    checks_void_return: ChecksVoidReturn,
}

impl Options {
    /// Reads `__ruleOptions[0]` honoring the upstream defaults: every top-level
    /// switch defaults to `true`, and `checksVoidReturn` may be a bool or an
    /// object whose members each default to `true`.
    fn read(node: &LintNode) -> Self {
        let raw = node
            .fields
            .get("__ruleOptions")
            .and_then(|value| value.as_array())
            .and_then(|array| array.first());

        let mut opts = Self {
            checks_conditionals: true,
            flag_unions: FlagUnions::None,
            checks_spreads: true,
            checks_void_return: ChecksVoidReturn::ALL,
        };

        let Some(obj) = raw.and_then(|value| value.as_object()) else {
            return opts;
        };

        match obj.get("checksConditionals") {
            Some(value) if value.is_boolean() => {
                opts.checks_conditionals = value.as_bool() == Some(true);
            }
            Some(value) if value.is_object() => {
                opts.flag_unions = match value.get("flagUnions").and_then(|v| v.as_str()) {
                    Some("all") => FlagUnions::All,
                    Some("strict") => FlagUnions::Strict,
                    _ => FlagUnions::None,
                };
            }
            _ => {}
        }
        if let Some(value) = obj.get("checksSpreads").and_then(|v| v.as_bool()) {
            opts.checks_spreads = value;
        }

        match obj.get("checksVoidReturn") {
            Some(value) if value.is_boolean() => {
                opts.checks_void_return = if value.as_bool() == Some(true) {
                    ChecksVoidReturn::ALL
                } else {
                    ChecksVoidReturn::NONE
                };
            }
            Some(value) if value.is_object() => {
                let map = value.as_object().expect("checked is_object");
                let member = |key: &str| map.get(key).and_then(|v| v.as_bool()).unwrap_or(true);
                opts.checks_void_return = ChecksVoidReturn {
                    arguments: member("arguments"),
                    attributes: member("attributes"),
                    inherited_methods: member("inheritedMethods"),
                    properties: member("properties"),
                    returns: member("returns"),
                    variables: member("variables"),
                };
            }
            _ => {}
        }

        opts
    }
}

// ---------------------------------------------------------------------------
// Thenable / void-returning helpers (over LintNode facts)
// ---------------------------------------------------------------------------

/// Mirrors the Go `isAlwaysThenable`: the value's type is thenable in all union
/// alternates. The host renders a node's type texts; a value is always-thenable
/// when every top-level union part is promise-like.
fn is_always_thenable(node: &LintNode) -> bool {
    if let Some(always) = promise_fact(node, "alwaysThenable") {
        return always;
    }
    // `is_promise_like_node` already accounts for a `then` property and for
    // promise-like type texts (including union members). For the conditional
    // check we additionally require that no alternate is non-thenable: if a
    // `__allTypePartsThenable` raw fact is present we honor it, otherwise we
    // fall back to the promise-like check.
    if let Some(all) = node.field_bool("__allTypePartsThenable") {
        return all;
    }
    is_promise_like_node(node)
}

/// Mirrors `returnsThenable`: the node is (or evaluates to) a function whose
/// call signature returns a thenable. The host supplies the function's rendered
/// return-type texts as `__returnTypeTexts`; an async function / promise-typed
/// return marks it thenable.
fn returns_thenable(node: &LintNode) -> bool {
    let current = strip_chain_expression(node);
    if let Some(returns) = promise_fact(current, "returnsThenable") {
        return returns;
    }

    // async function literal
    if is_function_like(current) {
        if current.field_bool("async") == Some(true) {
            return true;
        }
        let texts = collect_string_array(current, "__returnTypeTexts");
        return is_promise_like_type_texts(&texts, &[] as &[&str]);
    }

    // A reference whose type is a thenable-returning function: the host renders
    // its signature return type as `__returnTypeTexts`.
    let texts = collect_string_array(current, "__returnTypeTexts");
    is_promise_like_type_texts(&texts, &[] as &[&str])
}

/// Whether the contextual function type at this position returns void (and is
/// not also thenable). The host renders the contextual signature's return-type
/// texts as `__contextualReturnTypeTexts`.
fn is_void_returning_function_type(texts: &[String]) -> bool {
    if texts.is_empty() {
        return false;
    }
    // If any contextual return type is thenable, a promise-returning function is
    // valid there (Go returns false immediately in that case).
    if is_promise_like_type_texts(texts, &[] as &[&str]) {
        return false;
    }
    // Go checks `IsTypeFlagSet(returnType, TypeFlagsVoid)` only — `undefined` is
    // NOT treated as void-returning, so we match `void` exactly.
    texts.iter().any(|text| text.trim() == "void")
}

fn collect_string_array(node: &LintNode, key: &str) -> Vec<String> {
    node.fields
        .get(key)
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn is_function_like(node: &LintNode) -> bool {
    matches!(
        node.kind.as_str(),
        "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
    )
}

// ---------------------------------------------------------------------------
// checksConditionals
// ---------------------------------------------------------------------------

fn check_conditional(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    is_test_expr: bool,
    flag_unions: FlagUnions,
) {
    let node = strip_chain_expression(node);

    // ignore assignment expressions
    if node.kind == "AssignmentExpression" {
        return;
    }

    if node.kind == "LogicalExpression" {
        let operator = node.field_str("operator");
        // ignore the left operand for `??` outside a test-expression context
        if operator != Some("??") || is_test_expr {
            if let Some(left) = node.child("left") {
                check_conditional(ctx, left, is_test_expr, flag_unions);
            }
        }
        // ignore the right operand when not in a test-expression context
        if is_test_expr {
            if let Some(right) = node.child("right") {
                check_conditional(ctx, right, is_test_expr, flag_unions);
            }
        }
        return;
    }

    if is_always_thenable(node) {
        ctx.report("conditional", node.range);
        return;
    }
    // `checksConditionals.flagUnions`: `all` reports `Promise | ...`, and
    // `strict` reports `Promise<T> | T` but not `Promise<T> | NotT`.
    let union = match flag_unions {
        FlagUnions::None => false,
        FlagUnions::All => promise_fact(node, "thenable") == Some(true),
        FlagUnions::Strict => promise_fact(node, "matchingPromiseUnion") == Some(true),
    };
    if union {
        ctx.report("conditional", node.range);
    }
}

fn check_array_predicate(ctx: &mut RuleContext<'_>, member: &LintNode) {
    // `member` is the callee MemberExpression; the parent must be a CallExpression
    // whose array method takes a predicate. The host marks such calls with
    // `__arrayMethodCallWithPredicate` on the MemberExpression callee.
    if member.field_bool("__arrayMethodCallWithPredicate") != Some(true) {
        return;
    }
    let Some(callback) = member.child("__firstArgument") else {
        return;
    };
    if returns_thenable(callback) {
        ctx.report("predicate", callback.range);
    }
}

// ---------------------------------------------------------------------------
// checksSpreads
// ---------------------------------------------------------------------------

fn check_spread(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(argument) = node.child("argument") else {
        return;
    };
    // Go's `checkSpread` is registered for BOTH `KindSpreadElement` (array/call
    // spread) and `KindSpreadAssignment` (object spread) and applies no context
    // filter: it reports whenever the spread expression is thenable. We mirror
    // that here — any spread of a thenable is flagged regardless of position.
    let thenable =
        promise_fact(argument, "thenable").unwrap_or_else(|| is_promise_like_node(argument));
    if thenable {
        ctx.report("spread", argument.range);
    }
}

// ---------------------------------------------------------------------------
// checksVoidReturn: arguments
// ---------------------------------------------------------------------------

fn check_arguments(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let arguments = child_list(node, "arguments");
    if arguments.is_empty() || is_promise_finally_call(node) {
        return;
    }
    // Checker facts: the argument positions `voidFunctionArguments` keeps.
    // Each argument's contextual type (the instantiated parameter) can add a
    // void-returning or a thenable-returning expectation of its own.
    if let Some(void_indices) = node
        .fields
        .get("__voidArgumentIndices")
        .and_then(|value| value.as_array())
    {
        let listed = |key: &str, index: usize| {
            node.fields
                .get(key)
                .and_then(|value| value.as_array())
                .is_some_and(|indices| {
                    indices
                        .iter()
                        .any(|value| value.as_u64() == Some(index as u64))
                })
        };
        for (index, argument) in arguments.iter().enumerate() {
            let void = void_indices
                .iter()
                .any(|value| value.as_u64() == Some(index as u64))
                || argument.field_bool("__contextualVoidFunction") == Some(true);
            let thenable = listed("__thenableArgumentIndices", index)
                || argument.field_bool("__contextualThenableFunction") == Some(true);
            if void && !thenable && returns_thenable(argument) {
                ctx.report("voidReturnArgument", argument.range);
            }
        }
        return;
    }
    // The host renders, for each argument index, the expected parameter type's
    // signature return-type texts (the contextual function type for that slot)
    // as `__expectedArgumentReturnTypeTexts`: a list (per index) of type-text
    // lists. A void-return slot is one whose return texts are void-returning.
    let expected = node.fields.get("__expectedArgumentReturnTypeTexts");
    let Some(expected) = expected.and_then(|value| value.as_array()) else {
        return;
    };

    for (index, argument) in arguments.iter().enumerate() {
        let Some(slot) = expected.get(index).and_then(|value| value.as_array()) else {
            continue;
        };
        let texts: Vec<String> = slot
            .iter()
            .filter_map(|value| value.as_str().map(str::to_owned))
            .collect();
        if is_void_returning_function_type(&texts) && returns_thenable(argument) {
            ctx.report("voidReturnArgument", argument.range);
        }
    }
}

// ---------------------------------------------------------------------------
// checksVoidReturn: JSX attributes
// ---------------------------------------------------------------------------

fn check_jsx_attribute(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(value) = node.child("value") else {
        return;
    };
    if value.kind != "JSXExpressionContainer" {
        return;
    }
    let Some(expression) = value.child("expression") else {
        return;
    };
    let contextual = collect_string_array(node, "__contextualReturnTypeTexts");
    if is_void_returning_function_type(&contextual) && returns_thenable(expression) {
        ctx.report("voidReturnAttribute", value.range);
    }
}

// ---------------------------------------------------------------------------
// checksVoidReturn: inherited methods
// ---------------------------------------------------------------------------

fn check_class_like_or_interface(ctx: &mut RuleContext<'_>, node: &LintNode) {
    // The host marks each member that returns a thenable AND whose name matches a
    // void-returning member in an extended/implemented heritage type with
    // `__voidReturnInheritedMethod`. The heritage type computation requires the
    // checker, so the raw boolean is supplied per member.
    let body = node.child("body");
    let members = body
        .and_then(|body| body.child_list("body"))
        .or_else(|| node.child_list("body"))
        .unwrap_or(&[]);
    for member in members {
        // Checker facts: one report per heritage type that expects `void`.
        if let Some(names) = member
            .fields
            .get("__voidReturnHeritageTypeNames")
            .and_then(|value| value.as_array())
        {
            for name in names.iter().filter_map(|name| name.as_str()) {
                ctx.report_with_message(
                    "voidReturnInheritedMethod",
                    format!(
                        "Promise-returning method provided where a void return was expected by extended/implemented type '{name}'."
                    ),
                    member.range,
                );
            }
            continue;
        }
        if member.field_bool("__voidReturnInheritedMethod") == Some(true) {
            ctx.report("voidReturnInheritedMethod", member.range);
        }
    }
}

// ---------------------------------------------------------------------------
// checksVoidReturn: properties
// ---------------------------------------------------------------------------

fn check_property(ctx: &mut RuleContext<'_>, node: &LintNode) {
    // ESTree `Property`: { key, value, shorthand, method, ... }
    let Some(value) = node.child("value") else {
        return;
    };
    if let Some(void) = value.field_bool("__contextualVoidFunction") {
        // Accessors are not property assignments upstream, and a computed
        // method name has no property to look up.
        if node.field_str("kind").is_some_and(|kind| kind != "init")
            || (node.field_bool("method") == Some(true)
                && node.field_bool("computed") == Some(true))
        {
            return;
        }
        if void && returns_thenable(value) {
            ctx.report("voidReturnProperty", function_report_range(node, value));
        }
        return;
    }
    let contextual = collect_string_array(node, "__contextualReturnTypeTexts");
    if is_void_returning_function_type(&contextual) && returns_thenable(value) {
        // Report the return-type annotation when present, else the function.
        let target = value.child("returnType").unwrap_or(value);
        ctx.report("voidReturnProperty", target.range);
    }
}

fn check_method(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(value) = node.child("value") else {
        return;
    };
    if !returns_thenable(value) {
        return;
    }
    let contextual = collect_string_array(node, "__contextualReturnTypeTexts");
    if is_void_returning_function_type(&contextual) {
        let target = value.child("returnType").unwrap_or(value);
        ctx.report("voidReturnProperty", target.range);
    }
}

// ---------------------------------------------------------------------------
// checksVoidReturn: return statements
// ---------------------------------------------------------------------------

fn check_return_statement(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(argument) = node.child("argument") else {
        return;
    };
    if let Some(void) = argument.field_bool("__contextualVoidFunction") {
        if void && returns_thenable(argument) {
            ctx.report("voidReturnReturnValue", argument.range);
        }
        return;
    }
    let contextual = collect_string_array(node, "__contextualReturnTypeTexts");
    if is_void_returning_function_type(&contextual) && returns_thenable(argument) {
        ctx.report("voidReturnReturnValue", argument.range);
    }
}

// ---------------------------------------------------------------------------
// checksVoidReturn: variables
// ---------------------------------------------------------------------------

fn check_variable_declarator(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(init) = node.child("init") else {
        return;
    };
    let Some(annotation) = node.child("id").and_then(|id| id.child("typeAnnotation")) else {
        // Go requires an explicit type annotation on the variable.
        return;
    };
    if let Some(void) = node
        .child("id")
        .and_then(|id| promise_fact(id, "voidFunction"))
    {
        let annotation = annotation.child("typeAnnotation").unwrap_or(annotation);
        if is_possibly_function_type(annotation) && void && returns_thenable(init) {
            ctx.report("voidReturnVariable", init.range);
        }
        return;
    }
    // `__variableReturnTypeTexts`: the rendered signature return texts of the
    // annotated variable type (its `() => void` shape).
    let contextual = collect_string_array(node, "__variableReturnTypeTexts");
    if is_void_returning_function_type(&contextual) && returns_thenable(init) {
        ctx.report("voidReturnVariable", init.range);
    }
}

fn check_assignment(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_str("operator") != Some("=") {
        return;
    }
    let Some(right) = node.child("right") else {
        return;
    };
    if let Some(void) = node
        .child("left")
        .and_then(|left| promise_fact(left, "voidFunction"))
    {
        if void && returns_thenable(right) {
            ctx.report("voidReturnVariable", right.range);
        }
        return;
    }
    // `__variableReturnTypeTexts`: rendered signature return texts of the LHS type.
    let contextual = collect_string_array(node, "__variableReturnTypeTexts");
    if is_void_returning_function_type(&contextual) && returns_thenable(right) {
        ctx.report("voidReturnVariable", right.range);
    }
}

// ---------------------------------------------------------------------------
// Checker-fact helpers
// ---------------------------------------------------------------------------

const ARRAY_PREDICATE_FUNCTIONS: &[&str] = &[
    "every",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
];

/// `checkArrayPredicates` over checker facts: an array or tuple method that
/// takes a predicate, given a thenable-returning callback.
fn check_array_predicate_call(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.kind != "CallExpression" {
        return;
    }
    let Some(callee) = node.child("callee").map(strip_chain_expression) else {
        return;
    };
    if !static_member_name(callee)
        .is_some_and(|name| ARRAY_PREDICATE_FUNCTIONS.contains(&name.as_str()))
    {
        return;
    }
    let array = member_object(callee).and_then(|object| promise_fact(object, "arrayOrTuple"));
    if array != Some(true) {
        return;
    }
    let Some(callback) = child_list(node, "arguments").first() else {
        return;
    };
    if returns_thenable(callback) {
        ctx.report("predicate", callback.range);
    }
}

/// `isPromiseFinallyMethod`: `promise.finally(...)` on a built-in Promise.
fn is_promise_finally_call(node: &LintNode) -> bool {
    if node.kind != "CallExpression" {
        return false;
    }
    let Some(callee) = node.child("callee") else {
        return false;
    };
    static_member_name(callee).as_deref() == Some("finally")
        && member_object(callee).is_some_and(|object| promise_fact(object, "promise") == Some(true))
}

/// Whether a logical expression is first reached by another check (a test
/// position or an enclosing logical operand). `None` without the host's
/// `__ancestorChain` child keys.
fn logical_reached_elsewhere(node: &LintNode) -> Option<bool> {
    let chain = node.fields.get("__ancestorChain")?.as_array()?;
    let mut first = true;
    for entry in chain {
        let kind = entry.get("kind").and_then(|value| value.as_str())?;
        let key = entry.get("childKey").and_then(|value| value.as_str())?;
        let operator = entry.get("operator").and_then(|value| value.as_str());
        match kind {
            "IfStatement"
            | "WhileStatement"
            | "DoWhileStatement"
            | "ForStatement"
            | "ConditionalExpression"
                if key == "test" =>
            {
                return Some(true);
            }
            "UnaryExpression" if operator == Some("!") && key == "argument" => {
                return Some(true);
            }
            "LogicalExpression" => {
                if first && key == "left" && operator != Some("??") {
                    return Some(true);
                }
            }
            _ => return Some(false),
        }
        first = false;
    }
    Some(false)
}

/// `isPossiblyFunctionType`: annotation kinds that may name a function type.
fn is_possibly_function_type(annotation: &LintNode) -> bool {
    match annotation.kind.as_str() {
        "TSTypeLiteral" => child_list(annotation, "members").iter().any(|member| {
            matches!(
                member.kind.as_str(),
                "TSCallSignatureDeclaration" | "TSConstructSignatureDeclaration"
            )
        }),
        "TSConditionalType"
        | "TSConstructorType"
        | "TSFunctionType"
        | "TSImportType"
        | "TSIndexedAccessType"
        | "TSInferType"
        | "TSIntersectionType"
        | "TSQualifiedName"
        | "TSThisType"
        | "TSTypeOperator"
        | "TSTypeQuery"
        | "TSTypeReference"
        | "TSUnionType" => true,
        _ => false,
    }
}

/// Upstream reports a function value at its return type annotation, or at
/// its head: the `=>` token of an arrow, or from the property start.
fn function_report_range(property: &LintNode, value: &LintNode) -> TextRange {
    if !is_function_like(value) {
        return value.range;
    }
    if let Some(return_type) = value.child("returnType") {
        return return_type
            .child("typeAnnotation")
            .unwrap_or(return_type)
            .range;
    }
    if value.kind == "ArrowFunctionExpression" {
        if let Some(arrow) = arrow_token_start(value) {
            return TextRange::new(arrow, arrow.saturating_add(2));
        }
        return value.range;
    }
    let end = value
        .child_list("params")
        .and_then(|params| params.first())
        .map_or(value.range.start, |param| param.range.start);
    TextRange::new(property.range.start, end.max(property.range.start))
}

/// Offset of the `=>` token: the last one before the body.
fn arrow_token_start(arrow: &LintNode) -> Option<u32> {
    let text = arrow.text.as_deref()?;
    let body = arrow.child("body")?;
    let body_offset = body.range.start.checked_sub(arrow.range.start)? as usize;
    let head = text.get(..body_offset)?;
    let index = head.rfind("=>")?;
    Some(arrow.range.start + index as u32)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintNode, RuleContext, RustLintRule};
    use super::NoMisusedPromisesRule;

    fn run(node: &LintNode) -> Vec<String> {
        let rule = NoMisusedPromisesRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
            .into_iter()
            .map(|diagnostic| diagnostic.message_id)
            .collect()
    }

    fn from(value: serde_json::Value) -> LintNode {
        serde_json::from_value(value).expect("valid LintNode")
    }

    fn promise_call() -> serde_json::Value {
        // `Promise.resolve()` rendered with a promise-like type text.
        json!({
            "kind": "CallExpression",
            "range": { "start": 4, "end": 21 },
            "typeTexts": ["Promise<void>"],
            "fields": {},
            "children": {},
            "childLists": {}
        })
    }

    #[test]
    fn reports_promise_in_if_condition() {
        let node = from(json!({
            "kind": "IfStatement",
            "range": { "start": 0, "end": 25 },
            "children": { "test": promise_call() }
        }));
        assert_eq!(run(&node), vec!["conditional".to_owned()]);
    }

    #[test]
    fn reports_negated_promise_conditional() {
        let node = from(json!({
            "kind": "UnaryExpression",
            "range": { "start": 0, "end": 22 },
            "fields": { "operator": "!" },
            "children": { "argument": promise_call() }
        }));
        assert_eq!(run(&node), vec!["conditional".to_owned()]);
    }

    #[test]
    fn reports_thenable_object_spread() {
        let argument = json!({
            "kind": "Identifier",
            "range": { "start": 5, "end": 12 },
            "typeTexts": ["Promise<number>"],
            "fields": { "name": "promise" }
        });
        let node = from(json!({
            "kind": "SpreadElement",
            "range": { "start": 2, "end": 12 },
            "fields": { "__parentKind": "ObjectExpression" },
            "children": { "argument": argument }
        }));
        assert_eq!(run(&node), vec!["spread".to_owned()]);
    }

    #[test]
    fn reports_void_return_argument() {
        // `[...].forEach(async val => {})` — slot 0 expects `() => void`, callback is async.
        let callback = json!({
            "kind": "ArrowFunctionExpression",
            "range": { "start": 14, "end": 30 },
            "fields": { "async": true },
            "children": {},
            "childLists": {}
        });
        let node = from(json!({
            "kind": "CallExpression",
            "range": { "start": 0, "end": 31 },
            "fields": { "__expectedArgumentReturnTypeTexts": [["void"]] },
            "childLists": { "arguments": [callback] }
        }));
        assert_eq!(run(&node), vec!["voidReturnArgument".to_owned()]);
    }

    #[test]
    fn reports_void_return_variable() {
        // `let f: () => void = async () => {}`
        let init = json!({
            "kind": "ArrowFunctionExpression",
            "range": { "start": 20, "end": 34 },
            "fields": { "async": true }
        });
        let id = json!({
            "kind": "Identifier",
            "range": { "start": 4, "end": 5 },
            "fields": { "name": "f" },
            "children": {
                "typeAnnotation": {
                    "kind": "TSTypeAnnotation",
                    "range": { "start": 5, "end": 16 }
                }
            }
        });
        let node = from(json!({
            "kind": "VariableDeclarator",
            "range": { "start": 4, "end": 34 },
            "fields": { "__variableReturnTypeTexts": ["void"] },
            "children": { "id": id, "init": init }
        }));
        assert_eq!(run(&node), vec!["voidReturnVariable".to_owned()]);
    }

    #[test]
    fn ignores_awaited_conditional() {
        // `if (await Promise.resolve())` — the test node is no longer promise-like.
        let test = json!({
            "kind": "AwaitExpression",
            "range": { "start": 4, "end": 27 },
            "typeTexts": ["void"]
        });
        let node = from(json!({
            "kind": "IfStatement",
            "range": { "start": 0, "end": 30 },
            "children": { "test": test }
        }));
        assert!(run(&node).is_empty());
    }

    #[test]
    fn ignores_conditional_when_option_disabled() {
        let node = from(json!({
            "kind": "IfStatement",
            "range": { "start": 0, "end": 25 },
            "fields": { "__ruleOptions": [{ "checksConditionals": false }] },
            "children": { "test": promise_call() }
        }));
        assert!(run(&node).is_empty());
    }

    #[test]
    fn ignores_non_async_void_return_argument() {
        // sync callback returning void in a void slot — not a thenable, no report.
        let callback = json!({
            "kind": "ArrowFunctionExpression",
            "range": { "start": 14, "end": 28 },
            "fields": { "async": false }
        });
        let node = from(json!({
            "kind": "CallExpression",
            "range": { "start": 0, "end": 29 },
            "fields": { "__expectedArgumentReturnTypeTexts": [["void"]] },
            "childLists": { "arguments": [callback] }
        }));
        assert!(run(&node).is_empty());
    }

    #[test]
    fn ignores_undefined_return_argument() {
        // Go only treats `TypeFlagsVoid` (i.e. `void`) as void-returning; an
        // `undefined`-returning expected type must NOT be flagged.
        let callback = json!({
            "kind": "ArrowFunctionExpression",
            "range": { "start": 14, "end": 30 },
            "fields": { "async": true },
            "children": {},
            "childLists": {}
        });
        let node = from(json!({
            "kind": "CallExpression",
            "range": { "start": 0, "end": 31 },
            "fields": { "__expectedArgumentReturnTypeTexts": [["undefined"]] },
            "childLists": { "arguments": [callback] }
        }));
        assert!(run(&node).is_empty());
    }

    #[test]
    fn reports_thenable_spread_in_any_position() {
        // Go's checkSpread applies no positional filter: a thenable spread is
        // flagged for array/call spreads too (e.g. `[...promise]`), not only
        // object spreads. Mirror that.
        let argument = json!({
            "kind": "Identifier",
            "range": { "start": 5, "end": 12 },
            "typeTexts": ["Promise<number>"],
            "fields": { "name": "promise" }
        });
        let node = from(json!({
            "kind": "SpreadElement",
            "range": { "start": 2, "end": 12 },
            "fields": { "__parentKind": "ArrayExpression" },
            "children": { "argument": argument }
        }));
        assert_eq!(run(&node), vec!["spread".to_owned()]);
    }

    #[test]
    fn ignores_spread_of_non_thenable() {
        let argument = json!({
            "kind": "Identifier",
            "range": { "start": 5, "end": 8 },
            "typeTexts": ["{ a: number }"],
            "fields": { "name": "obj" }
        });
        let node = from(json!({
            "kind": "SpreadElement",
            "range": { "start": 2, "end": 8 },
            "fields": { "__parentKind": "ObjectExpression" },
            "children": { "argument": argument }
        }));
        assert!(run(&node).is_empty());
    }
}
