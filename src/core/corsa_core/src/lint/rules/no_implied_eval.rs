use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    child_list, first_child_list_item, identifier_name, is_identifier_named, is_literal_string,
    member_property_name, strip_chain_expression,
};
use crate::lint::type_tree::TypeTree;
use crate::utils::is_string_like_type_texts;

/// Type-aware rule that rejects string-based dynamic code execution APIs.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoImpliedEvalRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unexpected",
        description: "Do not pass a string to an implied eval API.",
    },
    RuleMessage {
        id: "noImpliedEvalError",
        description: "Implied eval. Consider passing a function.",
    },
    RuleMessage {
        id: "noFunctionConstructor",
        description: "Implied eval. Do not use the Function constructor to create functions.",
    },
];

const EVAL_LIKE_FUNCTIONS: &[&str] = &["setImmediate", "setInterval", "setTimeout", "execScript"];
const GLOBAL_CANDIDATES: &[&str] = &["global", "globalThis", "window"];
// TypeScript SymbolFlags.Function | SymbolFlags.Method.
const FUNCTION_OR_METHOD: u32 = (1 << 4) | (1 << 13);
const LISTENERS: &[&str] = &["CallExpression", "NewExpression"];

impl RustLintRule for NoImpliedEvalRule {
    fn name(&self) -> &'static str {
        "no-implied-eval"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow string-based dynamic code execution APIs."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if shapes_available(node) {
            check_with_shapes(ctx, node);
            return;
        }
        match node.kind.as_str() {
            "CallExpression" => {
                let Some(callee) = node.child("callee") else {
                    return;
                };
                let callee = strip_chain_expression(callee);
                let callee_name = member_property_name(callee).or_else(|| identifier_name(callee));
                if !matches!(
                    callee_name.as_deref(),
                    Some("execScript" | "setInterval" | "setTimeout")
                ) {
                    return;
                }
                let Some(first_argument) = first_child_list_item(node, "arguments") else {
                    return;
                };
                if !first_argument.kind.contains("Function")
                    && (is_literal_string(first_argument)
                        || is_string_like_type_texts(&first_argument.type_texts))
                {
                    ctx.report("unexpected", node.range);
                }
            }
            "NewExpression" => {
                let Some(callee) = node.child("callee") else {
                    return;
                };
                if !is_identifier_named(callee, "Function") {
                    return;
                }
                if child_list(node, "arguments").iter().any(is_literal_string) {
                    ctx.report("unexpected", node.range);
                }
            }
            _ => {}
        }
    }
}

/// Whether the host attached checker shapes to the handler (and, for the
/// `Function` constructor, to the callee).
fn shapes_available(node: &LintNode) -> bool {
    if !matches!(node.kind.as_str(), "CallExpression" | "NewExpression") {
        return false;
    }
    let Some(callee) = node.child("callee") else {
        return false;
    };
    match callee_name(callee).as_deref() {
        Some("Function") => TypeTree::of(callee).is_some(),
        // An unresolvable callee name says nothing about the host: decide on
        // the handler's facts like any other call, so hosts that send no
        // type trees keep the text-based check.
        _ => first_child_list_item(node, "arguments")
            .is_none_or(|handler| TypeTree::of(handler).is_some()),
    }
}

/// typescript-eslint's `getCalleeName`.
fn callee_name(callee: &LintNode) -> Option<String> {
    if callee.kind == "Identifier" {
        return callee.field_stringish("name");
    }
    if callee.kind != "MemberExpression" {
        return None;
    }
    let object = callee.child("object")?;
    if object.kind != "Identifier"
        || !object
            .field_str("name")
            .is_some_and(|name| GLOBAL_CANDIDATES.contains(&name))
    {
        return None;
    }
    let property = callee.child("property")?;
    match property.kind.as_str() {
        "Identifier" if callee.field_bool("computed") != Some(true) => {
            property.field_stringish("name")
        }
        "Literal" => property.field_str("value").map(str::to_owned),
        _ => None,
    }
}

/// typescript-eslint's `checkImpliedEval`, over checker type shapes.
fn check_with_shapes(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(callee) = node.child("callee") else {
        return;
    };
    let Some(name) = callee_name(callee) else {
        return;
    };
    if name == "Function" {
        // No symbol on the callee's type (an unresolved `Function`) or the
        // global `FunctionConstructor`.
        let report = TypeTree::of(callee).is_some_and(|shape| {
            shape.symbol.is_none() || is_builtin(&shape, "FunctionConstructor")
        });
        if report {
            ctx.report("noFunctionConstructor", node.range);
            return;
        }
    }
    let Some(handler) = first_child_list_item(node, "arguments") else {
        return;
    };
    if !EVAL_LIKE_FUNCTIONS.contains(&name.as_str()) {
        return;
    }
    // A local binding of the same name is not the global API.
    if callee.kind == "Identifier" && callee.field_bool("__declaredInFile") == Some(true) {
        return;
    }
    if is_function(handler) {
        return;
    }
    ctx.report("noImpliedEvalError", handler.range);
}

fn is_builtin(shape: &TypeTree, name: &str) -> bool {
    shape.symbol.as_deref() == Some(name) && shape.lib != Some(false)
}

/// typescript-eslint's `isFunction`.
fn is_function(handler: &LintNode) -> bool {
    match handler.kind.as_str() {
        "ArrowFunctionExpression" | "FunctionDeclaration" | "FunctionExpression" => true,
        "Literal" | "TemplateLiteral" => false,
        "CallExpression" => {
            handler.child("callee").is_some_and(is_bind) || is_function_type(handler)
        }
        _ => is_function_type(handler),
    }
}

fn is_bind(node: &LintNode) -> bool {
    if node.kind == "MemberExpression" {
        return node.child("property").is_some_and(is_bind);
    }
    node.kind == "Identifier" && node.field_str("name") == Some("bind")
}

/// `isFunctionType`: a function or method symbol, the `Function` interface,
/// or any call signature.
fn is_function_type(node: &LintNode) -> bool {
    let Some(shape) = TypeTree::of(node) else {
        // No checker shape: assume a function rather than report.
        return true;
    };
    shape
        .symbol_flags
        .is_some_and(|symbol_flags| symbol_flags & FUNCTION_OR_METHOD != 0)
        || is_builtin(&shape, "Function")
        || shape.callable == Some(true)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintDiagnostic, LintNode, RuleContext, RustLintRule, TextRange};
    use super::NoImpliedEvalRule;

    fn run(node: &LintNode) -> Vec<LintDiagnostic> {
        let rule = NoImpliedEvalRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
    }

    fn call(callee: serde_json::Value, handler: serde_json::Value) -> LintNode {
        serde_json::from_value(json!({
            "kind": "CallExpression",
            "range": { "start": 0, "end": 20 },
            "children": { "callee": callee },
            "childLists": { "arguments": [handler] }
        }))
        .unwrap()
    }

    fn identifier(name: &str, declared_in_file: bool) -> serde_json::Value {
        json!({
            "kind": "Identifier",
            "range": { "start": 0, "end": 10 },
            "fields": { "name": name, "__declaredInFile": declared_in_file }
        })
    }

    fn handler(shape: serde_json::Value) -> serde_json::Value {
        json!({
            "kind": "Identifier",
            "range": { "start": 11, "end": 14 },
            "fields": { "name": "foo", "__typeTree": shape }
        })
    }

    #[test]
    fn reports_non_function_handlers_on_the_handler() {
        let undefined = json!({ "id": "u", "flags": 4, "text": "undefined" });
        let diagnostics = run(&call(identifier("setTimeout", false), handler(undefined)));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "noImpliedEvalError");
        assert_eq!(diagnostics[0].range, TextRange::new(11, 14));
    }

    #[test]
    fn allows_callable_handlers_and_local_functions() {
        let callable =
            json!({ "id": "f", "flags": 1 << 20, "text": "() => void", "callable": true });
        assert!(run(&call(identifier("setTimeout", false), handler(callable))).is_empty());

        let text = json!({ "id": "s", "flags": 1 << 5, "text": "string" });
        assert!(run(&call(identifier("setTimeout", true), handler(text))).is_empty());
    }

    #[test]
    fn keeps_text_check_for_hosts_without_type_trees() {
        let member = json!({
            "kind": "MemberExpression",
            "range": { "start": 0, "end": 10 },
            "children": { "property": identifier("setTimeout", false) }
        });
        let code = json!({
            "kind": "Identifier",
            "range": { "start": 11, "end": 15 },
            "fields": { "name": "code" },
            "typeTexts": ["string"]
        });
        let diagnostics = run(&call(member.clone(), code));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "unexpected");

        // With a type tree, the upstream port applies: a non-global object's
        // `setTimeout` is not the implied-eval API.
        let text = json!({ "id": "s", "flags": 1 << 5, "text": "string" });
        assert!(run(&call(member, handler(text))).is_empty());
    }

    #[test]
    fn reports_global_function_constructor() {
        let mut callee = identifier("Function", false);
        callee["fields"]["__typeTree"] = json!({
            "id": "F", "flags": 1 << 20, "text": "FunctionConstructor",
            "symbol": "FunctionConstructor", "lib": true
        });
        let text = json!({ "id": "s", "flags": 1 << 5, "text": "string" });
        let diagnostics = run(&call(callee.clone(), handler(text.clone())));
        assert_eq!(diagnostics[0].message_id, "noFunctionConstructor");

        callee["fields"]["__typeTree"] = json!({
            "id": "C", "flags": 1 << 20, "text": "typeof Function",
            "symbol": "Function", "lib": false
        });
        assert!(run(&call(callee, handler(text))).is_empty());
    }
}
