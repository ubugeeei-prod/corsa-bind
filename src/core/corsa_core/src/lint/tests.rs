use std::collections::BTreeMap;

use serde_json::json;

use super::{LintNode, LintRuleRegistry, TextRange};

#[test]
fn reports_array_delete_with_splice_suggestion() {
    let diagnostics = registry()
        .run_rule("no-array-delete", &array_delete_node())
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-array-delete");
    assert_eq!(diagnostics[0].message_id, "unexpected");
    assert_eq!(diagnostics[0].range, TextRange::new(0, 20));
    assert_eq!(diagnostics[0].suggestions.len(), 1);
    assert_eq!(diagnostics[0].suggestions[0].message_id, "useSplice");
    assert_eq!(diagnostics[0].suggestions[0].fixes.len(), 3);
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[0].range,
        TextRange::new(0, 7)
    );
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[1].range,
        TextRange::new(13, 14)
    );
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[2].range,
        TextRange::new(19, 20)
    );
}

#[test]
fn ignores_non_array_member_delete() {
    let mut node = array_delete_node();
    node.children
        .get_mut("argument")
        .unwrap()
        .children
        .get_mut("object")
        .unwrap()
        .type_texts = vec!["{ value: number }".to_owned()];

    let diagnostics = registry().run_rule("no-array-delete", &node).unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_for_in_array() {
    let diagnostics = registry()
        .run_rule("no-for-in-array", &for_in_array_node("readonly string[]"))
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-for-in-array");
    assert_eq!(diagnostics[0].message_id, "unexpected");
}

#[test]
fn ignores_for_in_record() {
    let diagnostics = registry()
        .run_rule("no-for-in-array", &for_in_array_node("{ value: number }"))
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_for_in_array_literal() {
    let mut node = for_in_array_node("");
    node.children.get_mut("right").unwrap().kind = "ArrayExpression".to_owned();

    let diagnostics = registry().run_rule("no-for-in-array", &node).unwrap();

    assert_eq!(diagnostics.len(), 1);
}

#[test]
fn reports_base_to_string_template_object() {
    let diagnostics = registry()
        .run_rule(
            "no-base-to-string",
            &node_with_child_list(
                "TemplateLiteral",
                TextRange::new(0, 24),
                "expressions",
                vec![node("ObjectExpression", TextRange::new(17, 29))],
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-base-to-string");
    assert_eq!(diagnostics[0].message_id, "unexpected");
    assert_eq!(diagnostics[0].range, TextRange::new(17, 29));
}

#[test]
fn ignores_base_to_string_known_safe_type() {
    let mut argument = node("Identifier", TextRange::new(7, 12));
    argument.type_texts = vec!["Date".to_owned()];
    let diagnostics = registry()
        .run_rule(
            "no-base-to-string",
            &call_node(
                node_with_field("Identifier", TextRange::new(0, 6), "name", json!("String")),
                vec![argument],
            ),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_unsafe_assignment_from_any() {
    let mut init = node("Identifier", TextRange::new(30, 35));
    init.type_texts = vec!["Set<any>".to_owned()];
    let mut id = node("Identifier", TextRange::new(6, 12));
    id.type_texts = vec!["Set<string>".to_owned()];
    id.children.insert(
        "typeAnnotation".to_owned(),
        node("TSTypeAnnotation", TextRange::new(12, 25)),
    );
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-assignment",
            &node_with_children(
                "VariableDeclarator",
                TextRange::new(6, 35),
                [("id", id), ("init", init)],
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-unsafe-assignment");
    assert_eq!(diagnostics[0].message_id, "unsafe");
}

#[test]
fn ignores_unsafe_assignment_to_unknown() {
    let mut init = node("Identifier", TextRange::new(30, 35));
    init.type_texts = vec!["any".to_owned()];
    let mut id = node("Identifier", TextRange::new(6, 12));
    id.type_texts = vec!["unknown".to_owned()];
    id.children.insert(
        "typeAnnotation".to_owned(),
        node("TSTypeAnnotation", TextRange::new(12, 21)),
    );
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-assignment",
            &node_with_children(
                "VariableDeclarator",
                TextRange::new(6, 35),
                [("id", id), ("init", init)],
            ),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn lists_default_rule_meta() {
    let registry = registry();
    assert_eq!(
        registry.rule_names().collect::<Vec<_>>(),
        vec![
            "no-array-delete",
            "no-for-in-array",
            "no-base-to-string",
            "await-thenable",
            "no-implied-eval",
            "no-mixed-enums",
            "no-unsafe-assignment",
            "no-unsafe-unary-minus",
            "only-throw-error",
            "prefer-find",
            "prefer-includes",
            "prefer-regexp-exec",
            "use-unknown-in-catch-callback-variable"
        ]
    );
    let metas = registry.metas();
    assert_eq!(metas[0].name, "no-array-delete");
    assert_eq!(metas[0].listeners, vec!["UnaryExpression"]);
    assert_eq!(
        metas[0].messages.get("unexpected").unwrap(),
        "Do not delete elements from an array-like value."
    );
    assert_eq!(metas[1].name, "no-for-in-array");
    assert_eq!(metas[1].listeners, vec!["ForInStatement"]);
}

fn registry() -> LintRuleRegistry {
    LintRuleRegistry::with_default_type_aware_rules()
}

fn node(kind: &str, range: TextRange) -> LintNode {
    LintNode {
        kind: kind.to_owned(),
        range,
        text: None,
        type_texts: Vec::new(),
        property_names: Vec::new(),
        fields: BTreeMap::new(),
        children: BTreeMap::new(),
        child_lists: BTreeMap::new(),
    }
}

fn node_with_field(kind: &str, range: TextRange, key: &str, value: serde_json::Value) -> LintNode {
    let mut node = node(kind, range);
    node.fields.insert(key.to_owned(), value);
    node
}

fn node_with_children<const N: usize>(
    kind: &str,
    range: TextRange,
    children: [(&str, LintNode); N],
) -> LintNode {
    let mut node = node(kind, range);
    node.children = children
        .into_iter()
        .map(|(key, child)| (key.to_owned(), child))
        .collect();
    node
}

fn node_with_child_list(
    kind: &str,
    range: TextRange,
    key: &str,
    children: Vec<LintNode>,
) -> LintNode {
    let mut node = node(kind, range);
    node.child_lists.insert(key.to_owned(), children);
    node
}

fn call_node(callee: LintNode, arguments: Vec<LintNode>) -> LintNode {
    let mut node = node_with_children(
        "CallExpression",
        TextRange::new(0, 16),
        [("callee", callee)],
    );
    node.child_lists.insert("arguments".to_owned(), arguments);
    node
}

fn array_delete_node() -> LintNode {
    LintNode {
        kind: "UnaryExpression".to_owned(),
        range: TextRange::new(0, 20),
        text: None,
        type_texts: Vec::new(),
        property_names: Vec::new(),
        fields: BTreeMap::from([("operator".to_owned(), json!("delete"))]),
        children: BTreeMap::from([(
            "argument".to_owned(),
            LintNode {
                kind: "MemberExpression".to_owned(),
                range: TextRange::new(7, 20),
                text: None,
                type_texts: Vec::new(),
                property_names: Vec::new(),
                fields: BTreeMap::from([("computed".to_owned(), json!(true))]),
                children: BTreeMap::from([
                    (
                        "object".to_owned(),
                        LintNode {
                            kind: "Identifier".to_owned(),
                            range: TextRange::new(7, 13),
                            text: Some("values".to_owned()),
                            type_texts: vec!["number[]".to_owned()],
                            property_names: Vec::new(),
                            fields: BTreeMap::new(),
                            children: BTreeMap::new(),
                            child_lists: BTreeMap::new(),
                        },
                    ),
                    (
                        "property".to_owned(),
                        LintNode {
                            kind: "Identifier".to_owned(),
                            range: TextRange::new(14, 19),
                            text: Some("index".to_owned()),
                            type_texts: Vec::new(),
                            property_names: Vec::new(),
                            fields: BTreeMap::new(),
                            children: BTreeMap::new(),
                            child_lists: BTreeMap::new(),
                        },
                    ),
                ]),
                child_lists: BTreeMap::new(),
            },
        )]),
        child_lists: BTreeMap::new(),
    }
}

fn for_in_array_node(right_type_text: &str) -> LintNode {
    LintNode {
        kind: "ForInStatement".to_owned(),
        range: TextRange::new(0, 42),
        text: None,
        type_texts: Vec::new(),
        property_names: Vec::new(),
        fields: BTreeMap::new(),
        children: BTreeMap::from([(
            "right".to_owned(),
            LintNode {
                kind: "Identifier".to_owned(),
                range: TextRange::new(18, 24),
                text: Some("values".to_owned()),
                type_texts: vec![right_type_text.to_owned()],
                property_names: Vec::new(),
                fields: BTreeMap::new(),
                children: BTreeMap::new(),
                child_lists: BTreeMap::new(),
            },
        )]),
        child_lists: BTreeMap::new(),
    }
}
