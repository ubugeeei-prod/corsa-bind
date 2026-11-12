use std::collections::BTreeMap;

use serde_json::Value;

use super::super::{LintFix, LintNode, LintSuggestion, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    ancestor_fact, ancestor_facts, ancestor_kind, child_list, is_function_or_function_type,
    rule_option_bool,
};

/// Type-aware rule that disallows duplicate union or intersection constituents.
///
/// Faithful port of tsgolint's `no-duplicate-type-constituents`. The rule walks
/// the constituents of a top-level union or intersection (recursing into
/// parenthesized constituents of the *same* kind, mirroring the upstream
/// `checkDuplicateRecursively` flattening) and reports the second and later
/// constituent that resolves to a type already seen. For unions whose parent is
/// an optional parameter, an explicit `undefined` constituent is additionally
/// reported as `unnecessary`.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoDuplicateTypeConstituentsRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "duplicate",
        description: "Union type constituent is duplicated with a previous constituent.",
    },
    RuleMessage {
        id: "unnecessary",
        description: "Explicit undefined is unnecessary on an optional parameter.",
    },
];

const LISTENERS: &[&str] = &["TSUnionType", "TSIntersectionType"];

impl RustLintRule for NoDuplicateTypeConstituentsRule {
    fn name(&self) -> &'static str {
        "no-duplicate-type-constituents"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow duplicate union or intersection constituents."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn has_suggestions(&self) -> bool {
        true
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        let options = Options::from_node(node);
        let kind = match node.kind.as_str() {
            "TSIntersectionType" => {
                if options.ignore_intersections {
                    return;
                }
                Kind::Intersection
            }
            "TSUnionType" => {
                if options.ignore_unions {
                    return;
                }
                Kind::Union
            }
            _ => return,
        };

        // Mirrors `unwindedParentType(node, kind) != nil`: skip a union or
        // intersection that is nested (through parenthesized types) inside another
        // of the SAME kind, because the outer listener already flattened it.
        if has_same_kind_ancestor(node) {
            return;
        }

        check_duplicate(ctx, node, kind);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Kind {
    Union,
    Intersection,
}

#[derive(Clone, Copy, Debug, Default)]
struct Options {
    ignore_intersections: bool,
    ignore_unions: bool,
}

impl Options {
    fn from_node(node: &LintNode) -> Self {
        Self {
            ignore_intersections: rule_option_bool(node, "ignoreIntersections").unwrap_or(false),
            ignore_unions: rule_option_bool(node, "ignoreUnions").unwrap_or(false),
        }
    }
}

/// Returns whether an ancestor (looking only through parenthesized types) is a
/// union/intersection of the same kind as `node`.
///
/// Consumes the host fact `__sameKindAncestor` when present (a raw AST
/// observation: the first non-parenthesized ancestor matches `node`'s kind).
/// Otherwise the same observation is read off `__ancestorFacts`, or off
/// `__parentKind` for hosts that send only the parent. The verdict (skip vs.
/// check) stays here in Rust.
fn has_same_kind_ancestor(node: &LintNode) -> bool {
    if let Some(same) = node.field_bool("__sameKindAncestor") {
        return same;
    }
    let parent = match ancestor_facts(node) {
        Some(ancestors) => ancestors
            .iter()
            .rev()
            .filter_map(ancestor_kind)
            .find(|kind| *kind != "TSParenthesizedType"),
        None => node.field_str("__parentKind"),
    };
    parent == Some(node.kind.as_str())
}

/// Whether the union annotates an optional function parameter: upstream's
/// `forEachNodeType` callback walks union -> `TSTypeAnnotation` -> optional
/// `Identifier` in the `params` of a function or function type.
///
/// Consumes `__parentOptionalParam` when present, otherwise the `kind`,
/// `optional` and `keyInParent` entries of `__ancestorFacts`.
fn is_optional_parameter_annotation(node: &LintNode) -> bool {
    if node.field_bool("__parentOptionalParam") == Some(true) {
        return true;
    }
    let Some(ancestors) = ancestor_facts(node) else {
        return false;
    };
    let annotation = ancestor_fact(ancestors, 1);
    let parameter = ancestor_fact(ancestors, 2);
    let function = ancestor_fact(ancestors, 3);
    annotation.and_then(ancestor_kind) == Some("TSTypeAnnotation")
        && parameter.is_some_and(|parameter| {
            ancestor_kind(parameter) == Some("Identifier")
                && parameter.get("optional").and_then(Value::as_bool) == Some(true)
                && parameter.get("keyInParent").and_then(Value::as_str) == Some("params")
        })
        && function
            .and_then(ancestor_kind)
            .is_some_and(is_function_or_function_type)
}

fn check_duplicate(ctx: &mut RuleContext<'_>, node: &LintNode, kind: Kind) {
    let parent_optional_param = kind == Kind::Union && is_optional_parameter_annotation(node);

    let mut unique: Vec<&LintNode> = Vec::new();
    let mut seen: BTreeMap<String, &LintNode> = BTreeMap::new();
    for constituent in child_list(node, "types") {
        check_duplicate_recursively(
            ctx,
            kind,
            constituent,
            &mut unique,
            &mut seen,
            parent_optional_param,
        );
    }
}

/// Recursively checks one constituent, mirroring upstream
/// `checkDuplicateRecursively`: an AST-identical earlier constituent, then an
/// earlier constituent of the same resolved type, makes this one a duplicate.
fn check_duplicate_recursively<'a>(
    ctx: &mut RuleContext<'_>,
    kind: Kind,
    constituent: &'a LintNode,
    unique: &mut Vec<&'a LintNode>,
    seen: &mut BTreeMap<String, &'a LintNode>,
    parent_optional_param: bool,
) {
    // `isSameAstNode` runs before any type lookup, so `{ a: string }` twice is
    // a duplicate although each type literal is a distinct checker type.
    if let Some(previous) = unique
        .iter()
        .find(|previous| same_ast_node(previous, constituent))
    {
        report(ctx, kind, constituent, previous);
        return;
    }

    // `tsutils.isIntrinsicErrorType(type)`: the constituent neither
    // participates in duplicate detection nor is flattened. This is why
    // `type T = A | A` (with `A` unresolved) is NOT reported upstream.
    if constituent.field_bool("__isErrorType") == Some(true) {
        return;
    }
    // A constituent without a resolved type id (and no syntax id) is treated
    // the same way for detection, but still flattened.
    let type_id = resolved_type_id(constituent);

    if let Some(previous) = type_id.as_deref().and_then(|id| seen.get(id)) {
        report(ctx, kind, constituent, previous);
        return;
    }

    // `forEachNodeType`: for a union whose parent is an optional parameter, an
    // explicit `undefined` constituent is reported as `unnecessary`.
    if parent_optional_param && is_undefined_type(constituent) {
        report_unnecessary(ctx, constituent);
    }

    if let Some(id) = type_id {
        seen.insert(id, constituent);
        unique.push(constituent);
    }

    // Flatten into same-kind constituents reached through parenthesized types.
    let Some(nested) = same_kind_constituents(constituent, kind) else {
        return;
    };
    for child in nested {
        check_duplicate_recursively(ctx, kind, child, unique, seen, parent_optional_param);
    }
}

fn ast_fields(node: &LintNode) -> Vec<(&String, &Value)> {
    node.fields
        .iter()
        .filter(|(key, _)| !key.starts_with("__"))
        .collect()
}

/// Upstream `isSameAstNode`: structural equality of two nodes, ignoring
/// locations. Host facts (`__`-prefixed fields), source text and type texts
/// are not part of the AST.
fn same_ast_node(left: &LintNode, right: &LintNode) -> bool {
    left.kind == right.kind
        && ast_fields(left) == ast_fields(right)
        && left.children.len() == right.children.len()
        && left.children.iter().all(|(key, child)| {
            right
                .children
                .get(key)
                .is_some_and(|other| same_ast_node(child, other))
        })
        && left.child_lists.len() == right.child_lists.len()
        && left.child_lists.iter().all(|(key, children)| {
            right.child_lists.get(key).is_some_and(|others| {
                children.len() == others.len()
                    && children
                        .iter()
                        .zip(others)
                        .all(|(child, other)| same_ast_node(child, other))
            })
        })
}

/// Returns the constituents of `node` when, after skipping parenthesized types,
/// it is a union/intersection of the same `kind`; otherwise `None`. Mirrors
/// `ast.SkipTypeParentheses` + the kind match in upstream.
fn same_kind_constituents(node: &LintNode, kind: Kind) -> Option<&[LintNode]> {
    let inner = skip_type_parentheses(node);
    match (kind, inner.kind.as_str()) {
        (Kind::Union, "TSUnionType") | (Kind::Intersection, "TSIntersectionType") => {
            inner.child_list("types")
        }
        _ => None,
    }
}

/// Mirrors `ast.SkipTypeParentheses`: unwraps nested `TSParenthesizedType`.
fn skip_type_parentheses(node: &LintNode) -> &LintNode {
    let mut current = node;
    while current.kind == "TSParenthesizedType" {
        match current.child("typeAnnotation") {
            Some(inner) => current = inner,
            None => break,
        }
    }
    current
}

/// Reads the host-provided stable resolved-type identity for a constituent.
///
/// Consumes the raw host fact `__resolvedTypeId` (a string). The host computes
/// it as: `const t = checker.getTypeAtLocation(constituentNode); if
/// (utils.isIntrinsicErrorType(t)) leave unset; else assign a per-source-file
/// stable id from a `Map<ts.Type, number>` (pointer identity, matching the
/// upstream `map[*checker.Type]*ast.Node`)`. The duplicate verdict stays in
/// Rust.
fn resolved_type_id(node: &LintNode) -> Option<String> {
    node.field_str("__resolvedTypeId")
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .or_else(|| syntax_type_id(node))
}

/// Reads whether the constituent's resolved type has the `undefined` type flag.
///
/// Consumes the raw host fact `__isUndefinedType` computed as
/// `utils.isTypeFlagSet(checker.getTypeAtLocation(constituentNode),
/// ts.TypeFlags.Undefined)`.
fn is_undefined_type(node: &LintNode) -> bool {
    node.field_bool("__isUndefinedType").unwrap_or(false) || node.kind == "TSUndefinedKeyword"
}

fn syntax_type_id(node: &LintNode) -> Option<String> {
    let node = skip_type_parentheses(node);
    if let Some(keyword) = keyword_type_id(node.kind.as_str()) {
        return Some(keyword.to_owned());
    }
    if node.kind == "TSLiteralType" {
        return literal_type_id(node);
    }
    if node.kind == "TSTemplateLiteralType" {
        return node
            .text
            .as_deref()
            .filter(|text| !text.is_empty())
            .map(|text| format!("template:{text}"));
    }
    None
}

fn keyword_type_id(kind: &str) -> Option<&'static str> {
    match kind {
        "TSAnyKeyword" => Some("keyword:any"),
        "TSBigIntKeyword" => Some("keyword:bigint"),
        "TSBooleanKeyword" => Some("keyword:boolean"),
        "TSNeverKeyword" => Some("keyword:never"),
        "TSNullKeyword" => Some("keyword:null"),
        "TSNumberKeyword" => Some("keyword:number"),
        "TSObjectKeyword" => Some("keyword:object"),
        "TSStringKeyword" => Some("keyword:string"),
        "TSSymbolKeyword" => Some("keyword:symbol"),
        "TSUndefinedKeyword" => Some("keyword:undefined"),
        "TSUnknownKeyword" => Some("keyword:unknown"),
        "TSVoidKeyword" => Some("keyword:void"),
        _ => None,
    }
}

fn literal_type_id(node: &LintNode) -> Option<String> {
    let Some(literal) = node.child("literal") else {
        return node
            .text
            .as_deref()
            .filter(|text| !text.is_empty())
            .map(|text| format!("literal:{text}"));
    };
    if literal.kind == "TemplateLiteral" || literal.kind == "TSTemplateLiteralType" {
        return literal
            .text
            .as_deref()
            .filter(|text| !text.is_empty())
            .map(|text| format!("template:{text}"));
    }
    match literal.kind.as_str() {
        "Literal" => match literal.fields.get("value") {
            Some(Value::Bool(value)) => Some(format!("literal:bool:{value}")),
            Some(Value::Number(value)) => Some(format!("literal:number:{value}")),
            Some(Value::String(value)) => Some(format!("literal:string:{value}")),
            _ => literal
                .field_str("bigint")
                .map(|bigint| format!("literal:bigint:{bigint}")),
        },
        "TSTrueKeyword" => Some("literal:bool:true".to_owned()),
        "TSFalseKeyword" => Some("literal:bool:false".to_owned()),
        _ => node
            .text
            .as_deref()
            .filter(|text| !text.is_empty())
            .map(|text| format!("literal:{text}")),
    }
}

/// `{{type}} type constituent is duplicated with {{previous}}.`, naming the
/// earlier constituent by its source text when the host sent it.
fn report(ctx: &mut RuleContext<'_>, kind: Kind, constituent: &LintNode, previous: &LintNode) {
    let suggestion = LintSuggestion {
        message_id: "duplicate".to_owned(),
        message: "Remove the duplicated type constituent.".to_owned(),
        fixes: vec![LintFix::remove_range(constituent.range)],
    };
    let container = match kind {
        Kind::Union => "Union",
        Kind::Intersection => "Intersection",
    };
    let message = match previous.text.as_deref() {
        Some(text) => format!("{container} type constituent is duplicated with {text}."),
        None => format!("{container} type constituent is duplicated with a previous constituent."),
    };
    ctx.report_formatted("duplicate", message, constituent.range, vec![suggestion]);
}

fn report_unnecessary(ctx: &mut RuleContext<'_>, constituent: &LintNode) {
    let suggestion = LintSuggestion {
        message_id: "unnecessary".to_owned(),
        message: "Remove the unnecessary undefined constituent.".to_owned(),
        fixes: vec![LintFix::remove_range(constituent.range)],
    };
    ctx.report_with_suggestions("unnecessary", constituent.range, vec![suggestion]);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintDiagnostic, LintNode, RuleContext, RustLintRule};
    use super::NoDuplicateTypeConstituentsRule;

    fn run(node: &LintNode) -> Vec<LintDiagnostic> {
        let rule = NoDuplicateTypeConstituentsRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
    }

    fn constituent(start: u32, end: u32, type_id: &str) -> serde_json::Value {
        json!({
            "kind": "TSTypeReference",
            "range": { "start": start, "end": end },
            "fields": { "__resolvedTypeId": type_id }
        })
    }

    fn keyword(kind: &str, start: u32, end: u32, type_id: &str) -> serde_json::Value {
        json!({
            "kind": kind,
            "range": { "start": start, "end": end },
            "fields": { "__resolvedTypeId": type_id }
        })
    }

    // `type T = 1 | 1;` -> reports duplicate on the second literal.
    #[test]
    fn reports_duplicate_union_literal() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 14 },
            "childLists": {
                "types": [
                    keyword("TSLiteralType", 9, 10, "1"),
                    keyword("TSLiteralType", 13, 14, "1"),
                ]
            }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "duplicate");
        assert_eq!(diagnostics[0].range.start, 13);
        assert_eq!(diagnostics[0].range.end, 14);
    }

    // `type T = string | string;` -> reports duplicate even when the host does
    // not provide checker-backed type ids for syntax-only keyword nodes.
    #[test]
    fn reports_duplicate_primitive_keyword_without_checker_fact() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 24 },
            "childLists": {
                "types": [
                    { "kind": "TSStringKeyword", "range": { "start": 9, "end": 15 } },
                    { "kind": "TSStringKeyword", "range": { "start": 18, "end": 24 } }
                ]
            }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "duplicate");
        assert_eq!(diagnostics[0].range.start, 18);
        assert_eq!(diagnostics[0].range.end, 24);
    }

    // `type T = true & true;` -> reports duplicate on intersection.
    #[test]
    fn reports_duplicate_intersection() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 20 },
            "childLists": {
                "types": [
                    keyword("TSLiteralType", 9, 13, "true"),
                    keyword("TSLiteralType", 16, 20, "true"),
                ]
            }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "duplicate");
    }

    // `(a?: string | undefined) => {};` -> explicit undefined is unnecessary.
    #[test]
    fn reports_unnecessary_undefined_on_optional_param() {
        let undefined_node = json!({
            "kind": "TSUndefinedKeyword",
            "range": { "start": 20, "end": 29 },
            "fields": { "__isUndefinedType": true, "__resolvedTypeId": "undefined" }
        });
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 11, "end": 29 },
            "fields": { "__parentOptionalParam": true },
            "childLists": {
                "types": [
                    keyword("TSStringKeyword", 11, 17, "string"),
                    undefined_node,
                ]
            }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "unnecessary");
    }

    // `type T = A | A;` with A unresolved (error type) -> NOT reported.
    #[test]
    fn does_not_report_unresolved_alias_duplicates() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 14 },
            "childLists": {
                "types": [
                    // No __resolvedTypeId => error type => never duplicates.
                    json!({ "kind": "TSTypeReference", "range": { "start": 9, "end": 10 } }),
                    json!({ "kind": "TSTypeReference", "range": { "start": 13, "end": 14 } }),
                ]
            }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert!(diagnostics.is_empty());
    }

    fn number_literal(value: i64, start: u32, end: u32) -> serde_json::Value {
        json!({
            "kind": "TSLiteralType",
            "range": { "start": start, "end": end },
            "fields": { "__resolvedTypeId": value.to_string() },
            "children": {
                "literal": {
                    "kind": "Literal",
                    "range": { "start": start, "end": end },
                    "fields": { "value": value, "raw": value.to_string() }
                }
            }
        })
    }

    // `type T = 1 | 2;` -> distinct types, NOT reported.
    #[test]
    fn does_not_report_distinct_union() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 14 },
            "childLists": {
                "types": [
                    number_literal(1, 9, 10),
                    number_literal(2, 13, 14),
                ]
            }
        }))
        .unwrap();

        assert!(run(&node).is_empty());
    }

    // `type T = A | A;` under `{ "ignoreUnions": true }` -> skipped.
    #[test]
    fn respects_ignore_unions_option() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 14 },
            "fields": { "__ruleOptions": [{ "ignoreUnions": true }] },
            "childLists": {
                "types": [
                    constituent(9, 10, "shared"),
                    constituent(13, 14, "shared"),
                ]
            }
        }))
        .unwrap();

        assert!(run(&node).is_empty());
    }

    // Nested same-kind union reached through parentheses is flattened:
    // `type A = (number | string) | number | string;` -> two duplicates.
    #[test]
    fn flattens_parenthesized_same_kind_constituents() {
        let paren = json!({
            "kind": "TSParenthesizedType",
            "range": { "start": 9, "end": 26 },
            "children": {
                "typeAnnotation": {
                    "kind": "TSUnionType",
                    "range": { "start": 10, "end": 25 },
                    "childLists": {
                        "types": [
                            keyword("TSNumberKeyword", 10, 16, "number"),
                            keyword("TSStringKeyword", 19, 25, "string"),
                        ]
                    }
                }
            }
        });
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 45 },
            "childLists": {
                "types": [
                    paren,
                    keyword("TSNumberKeyword", 29, 35, "number"),
                    keyword("TSStringKeyword", 38, 44, "string"),
                ]
            }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().all(|d| d.message_id == "duplicate"));
    }

    // A nested same-kind union should be skipped at its own listener invocation.
    #[test]
    fn skips_nested_same_kind_union() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 10, "end": 25 },
            "fields": { "__sameKindAncestor": true },
            "childLists": {
                "types": [
                    constituent(10, 11, "shared"),
                    constituent(14, 15, "shared"),
                ]
            }
        }))
        .unwrap();

        assert!(run(&node).is_empty());
    }

    fn type_literal(start: u32, end: u32, type_id: &str) -> serde_json::Value {
        json!({
            "kind": "TSTypeLiteral",
            "range": { "start": start, "end": end },
            "text": "{ a: string }",
            "fields": { "__resolvedTypeId": type_id },
            "childLists": { "members": [ {
                "kind": "TSPropertySignature",
                "range": { "start": start + 2, "end": end - 2 },
                "fields": { "computed": false, "optional": false, "readonly": false, "__parentKind": "TSTypeLiteral" },
                "children": {
                    "key": { "kind": "Identifier", "range": { "start": start + 2, "end": start + 3 }, "fields": { "name": "a" } },
                    "typeAnnotation": {
                        "kind": "TSTypeAnnotation",
                        "range": { "start": start + 3, "end": end - 2 },
                        "children": { "typeAnnotation": { "kind": "TSStringKeyword", "range": { "start": start + 5, "end": end - 2 } } }
                    }
                }
            } ] }
        })
    }

    // `type T = { a: string } | { a: string };` each type literal is its own
    // checker type, but the second is the same AST as the first.
    #[test]
    fn reports_same_ast_type_literals() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 38 },
            "childLists": { "types": [
                type_literal(9, 22, "1"),
                type_literal(25, 38, "2"),
            ] }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].range.start, 25);
        assert_eq!(
            diagnostics[0].message,
            "Union type constituent is duplicated with { a: string }."
        );
    }

    // `type T = Missing | Missing;` the host marks unresolved names as error
    // types: neither the type nor the AST comparison sees them.
    #[test]
    fn skips_host_error_types() {
        let missing = |start: u32| {
            json!({
                "kind": "TSTypeReference",
                "range": { "start": start, "end": start + 7 },
                "fields": { "__isErrorType": true },
                "children": { "typeName": { "kind": "Identifier", "range": { "start": start, "end": start + 7 }, "fields": { "name": "Missing" } } }
            })
        };
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 26 },
            "childLists": { "types": [missing(9), missing(19)] }
        }))
        .unwrap();

        assert!(run(&node).is_empty());
    }

    // A nested union whose TS-ESTree parent (from `__ancestorFacts`) is a
    // union is flattened by that parent, so it is not checked on its own.
    #[test]
    fn skips_union_nested_in_union_by_ancestor_facts() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 14, "end": 19 },
            "fields": { "__ancestorFacts": [
                { "kind": "TSTypeAliasDeclaration" },
                { "kind": "TSUnionType", "keyInParent": "typeAnnotation" }
            ] },
            "childLists": { "types": [
                constituent(14, 15, "shared"),
                constituent(18, 19, "shared"),
            ] }
        }))
        .unwrap();

        assert!(run(&node).is_empty());
    }

    // `function f(a?: string | undefined) {}` read off `__ancestorFacts`.
    #[test]
    fn reports_unnecessary_undefined_by_ancestor_facts() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 15, "end": 33 },
            "fields": { "__ancestorFacts": [
                { "kind": "Program" },
                { "kind": "FunctionDeclaration", "keyInParent": "body" },
                { "kind": "Identifier", "keyInParent": "params", "optional": true },
                { "kind": "TSTypeAnnotation", "keyInParent": "typeAnnotation" }
            ] },
            "childLists": { "types": [
                keyword("TSStringKeyword", 15, 21, "string"),
                {
                    "kind": "TSUndefinedKeyword",
                    "range": { "start": 24, "end": 33 },
                    "fields": { "__isUndefinedType": true, "__resolvedTypeId": "undefined" }
                }
            ] }
        }))
        .unwrap();

        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "unnecessary");
        assert_eq!(diagnostics[0].range.start, 24);
    }

    // `let a: string | undefined;` is not a parameter.
    #[test]
    fn ignores_undefined_outside_optional_parameters() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 7, "end": 25 },
            "fields": { "__ancestorFacts": [
                { "kind": "VariableDeclarator" },
                { "kind": "Identifier", "keyInParent": "id" },
                { "kind": "TSTypeAnnotation", "keyInParent": "typeAnnotation" }
            ] },
            "childLists": { "types": [
                keyword("TSStringKeyword", 7, 13, "string"),
                keyword("TSUndefinedKeyword", 16, 25, "undefined"),
            ] }
        }))
        .unwrap();

        assert!(run(&node).is_empty());
    }
}
