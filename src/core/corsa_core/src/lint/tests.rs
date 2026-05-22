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
fn reports_floating_promise_with_suggestions() {
    let mut node = node_with_children(
        "ExpressionStatement",
        TextRange::new(0, 19),
        [(
            "expression",
            promise_member_call_node("resolve", Vec::new()),
        )],
    );
    node.fields
        .insert("__nearestFunctionAsync".to_owned(), json!(true));

    let diagnostics = registry().run_rule("no-floating-promises", &node).unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-floating-promises");
    assert_eq!(diagnostics[0].message_id, "unexpected");
    assert_eq!(diagnostics[0].suggestions.len(), 2);
    assert_eq!(diagnostics[0].suggestions[0].message_id, "floatingVoid");
    assert_eq!(diagnostics[0].suggestions[1].message_id, "floatingAwait");
}

#[test]
fn ignores_handled_promise_chain() {
    let catch_call = call_node(
        node_with_children(
            "MemberExpression",
            TextRange::new(0, 25),
            [
                ("object", promise_member_call_node("resolve", Vec::new())),
                (
                    "property",
                    node_with_field("Identifier", TextRange::new(24, 29), "name", json!("catch")),
                ),
            ],
        ),
        vec![node("ArrowFunctionExpression", TextRange::new(30, 38))],
    );
    let node = node_with_children(
        "ExpressionStatement",
        TextRange::new(0, 39),
        [("expression", catch_call)],
    );

    let diagnostics = registry().run_rule("no-floating-promises", &node).unwrap();

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
fn reports_unsafe_assignment_from_annotation_text() {
    let mut init = node("Identifier", TextRange::new(29, 34));
    init.type_texts = vec!["any".to_owned()];
    let mut id = node("Identifier", TextRange::new(6, 12));
    id.fields
        .insert("__typeAnnotationText".to_owned(), json!("string"));
    id.children.insert(
        "typeAnnotation".to_owned(),
        node("TSTypeAnnotation", TextRange::new(12, 20)),
    );
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-assignment",
            &node_with_children(
                "VariableDeclarator",
                TextRange::new(6, 34),
                [("id", id), ("init", init)],
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
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
fn reports_unsafe_call_from_any() {
    let mut callee = node_with_field("Identifier", TextRange::new(0, 5), "name", json!("value"));
    callee.type_texts = vec!["any".to_owned()];

    let diagnostics = registry()
        .run_rule("no-unsafe-call", &call_node(callee, Vec::new()))
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-unsafe-call");
    assert_eq!(diagnostics[0].message_id, "unsafeCall");
    assert_eq!(diagnostics[0].range, TextRange::new(0, 5));
}

#[test]
fn reports_unsafe_new_and_template_tag_from_any() {
    let mut callee = node_with_field("Identifier", TextRange::new(4, 9), "name", json!("Ctor"));
    callee.type_texts = vec!["any".to_owned()];
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-call",
            &node_with_children("NewExpression", TextRange::new(0, 11), [("callee", callee)]),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeNew");
    assert_eq!(diagnostics[0].range, TextRange::new(0, 11));

    let mut tag = node_with_field("Identifier", TextRange::new(0, 3), "name", json!("tag"));
    tag.type_texts = vec!["Function".to_owned()];
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-call",
            &node_with_children(
                "TaggedTemplateExpression",
                TextRange::new(0, 10),
                [("tag", tag)],
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeTemplateTag");
    assert_eq!(diagnostics[0].range, TextRange::new(0, 3));
}

#[test]
fn reports_unsafe_member_access_from_any() {
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-member-access",
            &member_expression_node(
                typed_node("Identifier", TextRange::new(0, 5), "any"),
                node_with_field("Identifier", TextRange::new(6, 10), "name", json!("prop")),
                false,
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-unsafe-member-access");
    assert_eq!(diagnostics[0].message_id, "unsafeMemberExpression");
    assert_eq!(diagnostics[0].range, TextRange::new(6, 10));
}

#[test]
fn reports_unsafe_computed_member_access_from_any_key() {
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-member-access",
            &member_expression_node(
                typed_node("Identifier", TextRange::new(0, 6), "{ value: string }"),
                typed_node("Identifier", TextRange::new(7, 10), "any"),
                true,
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeComputedMemberAccess");
    assert_eq!(diagnostics[0].range, TextRange::new(7, 10));
}

#[test]
fn respects_unsafe_member_optional_chain_option() {
    let mut node = member_expression_node(
        typed_node("Identifier", TextRange::new(0, 5), "any"),
        node_with_field("Identifier", TextRange::new(7, 11), "name", json!("prop")),
        false,
    );
    node.fields.insert("optional".to_owned(), json!(true));
    node.fields.insert(
        "__ruleOptions".to_owned(),
        json!([{ "allowOptionalChaining": true }]),
    );

    let diagnostics = registry()
        .run_rule("no-unsafe-member-access", &node)
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_meaningless_void_operator() {
    let diagnostics = registry()
        .run_rule(
            "no-meaningless-void-operator",
            &void_operator_node(typed_node("CallExpression", TextRange::new(5, 13), "void")),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-meaningless-void-operator");
    assert_eq!(diagnostics[0].message_id, "meaninglessVoidOperator");
    assert_eq!(diagnostics[0].suggestions.len(), 1);
    assert_eq!(diagnostics[0].suggestions[0].message_id, "removeVoid");
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[0].range,
        TextRange::new(0, 5)
    );
}

#[test]
fn ignores_meaningless_void_operator_on_non_void_type() {
    let diagnostics = registry()
        .run_rule(
            "no-meaningless-void-operator",
            &void_operator_node(typed_node("Identifier", TextRange::new(5, 10), "number")),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn respects_meaningless_void_operator_check_never_option() {
    let mut node = void_operator_node(typed_node("Identifier", TextRange::new(5, 10), "never"));
    assert!(
        registry()
            .run_rule("no-meaningless-void-operator", &node)
            .unwrap()
            .is_empty()
    );

    node.fields
        .insert("__ruleOptions".to_owned(), json!([{ "checkNever": true }]));
    let diagnostics = registry()
        .run_rule("no-meaningless-void-operator", &node)
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "meaninglessVoidOperator");
}

#[test]
fn ignores_dynamic_import_call() {
    let mut callee = node("Import", TextRange::new(0, 6));
    callee.type_texts = vec!["any".to_owned()];

    let diagnostics = registry()
        .run_rule("no-unsafe-call", &call_node(callee, Vec::new()))
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_unsafe_return_from_any() {
    let mut argument = node("Identifier", TextRange::new(55, 60));
    argument.type_texts = vec!["any".to_owned()];
    let mut node = node_with_children(
        "ReturnStatement",
        TextRange::new(48, 61),
        [("argument", argument)],
    );
    node.fields
        .insert("__returnTypeTexts".to_owned(), json!(["string"]));

    let diagnostics = registry().run_rule("no-unsafe-return", &node).unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-unsafe-return");
    assert_eq!(diagnostics[0].message_id, "unsafe");
    assert_eq!(diagnostics[0].range, TextRange::new(55, 60));
}

#[test]
fn reports_unsafe_type_assertion_from_any() {
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-type-assertion",
            &as_expression_node(
                typed_node("Identifier", TextRange::new(0, 5), "any"),
                "string",
                TextRange::new(0, 15),
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "no-unsafe-type-assertion");
    assert_eq!(diagnostics[0].message_id, "unsafeOfAnyTypeAssertion");
}

#[test]
fn reports_unsafe_type_assertion_to_any() {
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-type-assertion",
            &as_expression_node(
                typed_node("Identifier", TextRange::new(0, 5), "unknown"),
                "any",
                TextRange::new(0, 12),
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeToAnyTypeAssertion");
}

#[test]
fn reports_unsafe_type_assertion_union_narrowing() {
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-type-assertion",
            &as_expression_node(
                typed_node("Identifier", TextRange::new(0, 5), "string | number"),
                "string",
                TextRange::new(0, 15),
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeTypeAssertion");
}

#[test]
fn allows_unsafe_type_assertion_union_widening() {
    let diagnostics = registry()
        .run_rule(
            "no-unsafe-type-assertion",
            &as_expression_node(
                typed_node("Identifier", TextRange::new(0, 5), "string"),
                "string | number",
                TextRange::new(0, 24),
            ),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_promise_reject_string_reason() {
    let diagnostics = registry()
        .run_rule(
            "prefer-promise-reject-errors",
            &promise_member_call_node(
                "reject",
                vec![node_with_field(
                    "Literal",
                    TextRange::new(15, 21),
                    "value",
                    json!("boom"),
                )],
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "prefer-promise-reject-errors");
    assert_eq!(diagnostics[0].message_id, "rejectAnError");
}

#[test]
fn allows_error_like_promise_reject_reason() {
    let diagnostics = registry()
        .run_rule(
            "prefer-promise-reject-errors",
            &promise_member_call_node(
                "reject",
                vec![node_with_children(
                    "NewExpression",
                    TextRange::new(15, 32),
                    [(
                        "callee",
                        node_with_field(
                            "Identifier",
                            TextRange::new(19, 24),
                            "name",
                            json!("Error"),
                        ),
                    )],
                )],
            ),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_array_sort_without_compare() {
    let diagnostics = registry()
        .run_rule(
            "require-array-sort-compare",
            &sort_call_node("number[]", Vec::new()),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "require-array-sort-compare");
    assert_eq!(diagnostics[0].message_id, "requireCompare");
}

#[test]
fn respects_array_sort_string_option() {
    let default_diagnostics = registry()
        .run_rule(
            "require-array-sort-compare",
            &sort_call_node("string[]", Vec::new()),
        )
        .unwrap();
    assert!(default_diagnostics.is_empty());

    let mut node = sort_call_node("string[]", Vec::new());
    node.fields.insert(
        "__ruleOptions".to_owned(),
        json!([{ "ignoreStringArrays": false }]),
    );

    let diagnostics = registry()
        .run_rule("require-array-sort-compare", &node)
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
}

#[test]
fn reports_prefer_reduce_type_parameter_array_assertion() {
    let diagnostics = registry()
        .run_rule(
            "prefer-reduce-type-parameter",
            &reduce_call_node(
                "number[]",
                as_expression_node(
                    node("ArrayExpression", TextRange::new(42, 44)),
                    "number[]",
                    TextRange::new(42, 56),
                ),
                false,
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "prefer-reduce-type-parameter");
    assert_eq!(diagnostics[0].message_id, "preferTypeParameter");
    assert_eq!(diagnostics[0].range, TextRange::new(42, 56));
    assert_eq!(diagnostics[0].suggestions.len(), 1);
    assert_eq!(
        diagnostics[0].suggestions[0].message_id,
        "moveTypeParameter"
    );
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[0].range,
        TextRange::new(44, 56)
    );
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[1].range,
        TextRange::new(13, 13)
    );
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[1].replacement_text,
        "<number[]>"
    );
}

#[test]
fn reports_prefer_reduce_type_parameter_existing_type_arg_without_insert() {
    let diagnostics = registry()
        .run_rule(
            "prefer-reduce-type-parameter",
            &reduce_call_node(
                "string[]",
                as_expression_node(
                    typed_node(
                        "CallExpression",
                        TextRange::new(39, 50),
                        "string | undefined",
                    ),
                    "string | undefined",
                    TextRange::new(39, 72),
                ),
                true,
            ),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].suggestions[0].fixes.len(), 1);
    assert_eq!(
        diagnostics[0].suggestions[0].fixes[0].range,
        TextRange::new(50, 72)
    );
}

#[test]
fn ignores_prefer_reduce_type_parameter_for_non_array_reduce() {
    let diagnostics = registry()
        .run_rule(
            "prefer-reduce-type-parameter",
            &reduce_call_node(
                "{ reduce(callback: unknown, initial: unknown): unknown }",
                as_expression_node(
                    node("ArrayExpression", TextRange::new(42, 44)),
                    "number[]",
                    TextRange::new(42, 56),
                ),
                false,
            ),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn ignores_prefer_reduce_type_parameter_for_bare_type_parameter() {
    let diagnostics = registry()
        .run_rule(
            "prefer-reduce-type-parameter",
            &reduce_call_node(
                "string[]",
                as_expression_node(
                    node("ObjectExpression", TextRange::new(42, 44)),
                    "T",
                    TextRange::new(42, 49),
                ),
                false,
            ),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_manual_string_starts_with_check() {
    let diagnostics = registry()
        .run_rule("prefer-string-starts-ends-with", &starts_with_binary_node())
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "prefer-string-starts-ends-with");
    assert_eq!(diagnostics[0].message_id, "startsWith");
}

#[test]
fn reports_restricted_plus_operands_option_mismatch() {
    let mut node = binary_plus_node("string", "number");
    node.fields.insert(
        "__ruleOptions".to_owned(),
        json!([{ "allowNumberAndString": false }]),
    );

    let diagnostics = registry()
        .run_rule("restrict-plus-operands", &node)
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "restrict-plus-operands");
    assert_eq!(diagnostics[0].message_id, "mismatched");
}

#[test]
fn allows_default_string_number_plus() {
    let diagnostics = registry()
        .run_rule(
            "restrict-plus-operands",
            &binary_plus_node("string", "number"),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn reports_restricted_template_expression_object() {
    let diagnostics = registry()
        .run_rule(
            "restrict-template-expressions",
            &template_node(vec![typed_node(
                "ObjectExpression",
                TextRange::new(17, 29),
                "{ value: number }",
            )]),
        )
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].rule_name, "restrict-template-expressions");
    assert_eq!(diagnostics[0].message_id, "invalidType");
    assert_eq!(diagnostics[0].range, TextRange::new(17, 29));
}

#[test]
fn allows_restricted_template_expression_default_primitives() {
    let diagnostics = registry()
        .run_rule(
            "restrict-template-expressions",
            &template_node(vec![
                typed_node("Identifier", TextRange::new(9, 14), "number"),
                typed_node("Identifier", TextRange::new(17, 21), "boolean | null"),
            ]),
        )
        .unwrap();

    assert!(diagnostics.is_empty());
}

#[test]
fn respects_restricted_template_expression_boolean_option() {
    let mut node = template_node(vec![typed_node(
        "Identifier",
        TextRange::new(17, 21),
        "boolean",
    )]);
    node.fields.insert(
        "__ruleOptions".to_owned(),
        json!([{ "allowBoolean": false }]),
    );

    let diagnostics = registry()
        .run_rule("restrict-template-expressions", &node)
        .unwrap();

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "invalidType");
}

#[test]
fn ignores_tagged_template_expressions() {
    let mut node = template_node(vec![typed_node(
        "ObjectExpression",
        TextRange::new(5, 17),
        "{ value: number }",
    )]);
    node.fields
        .insert("__taggedTemplate".to_owned(), json!(true));

    let diagnostics = registry()
        .run_rule("restrict-template-expressions", &node)
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
            "no-floating-promises",
            "await-thenable",
            "no-implied-eval",
            "no-meaningless-void-operator",
            "no-mixed-enums",
            "no-unsafe-assignment",
            "no-unsafe-call",
            "no-unsafe-member-access",
            "no-unsafe-return",
            "no-unsafe-type-assertion",
            "no-unsafe-unary-minus",
            "only-throw-error",
            "prefer-find",
            "prefer-includes",
            "prefer-promise-reject-errors",
            "prefer-reduce-type-parameter",
            "prefer-regexp-exec",
            "prefer-string-starts-ends-with",
            "require-array-sort-compare",
            "restrict-plus-operands",
            "restrict-template-expressions",
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

fn sort_call_node(object_type_text: &str, arguments: Vec<LintNode>) -> LintNode {
    let mut object = node_with_field("Identifier", TextRange::new(0, 6), "name", json!("values"));
    object.text = Some("values".to_owned());
    object.type_texts = vec![object_type_text.to_owned()];
    call_node(
        node_with_children(
            "MemberExpression",
            TextRange::new(0, 11),
            [
                ("object", object),
                (
                    "property",
                    node_with_field("Identifier", TextRange::new(7, 11), "name", json!("sort")),
                ),
            ],
        ),
        arguments,
    )
}

fn reduce_call_node(
    object_type_text: &str,
    initial_value: LintNode,
    has_type_args: bool,
) -> LintNode {
    let mut object = node_with_field("Identifier", TextRange::new(0, 6), "name", json!("values"));
    object.text = Some("values".to_owned());
    object.type_texts = vec![object_type_text.to_owned()];
    let mut call = call_node(
        node_with_children(
            "MemberExpression",
            TextRange::new(0, 13),
            [
                ("object", object),
                (
                    "property",
                    node_with_field("Identifier", TextRange::new(7, 13), "name", json!("reduce")),
                ),
            ],
        ),
        vec![
            node("ArrowFunctionExpression", TextRange::new(14, 38)),
            initial_value,
        ],
    );
    if has_type_args {
        call.children.insert(
            "typeArguments".to_owned(),
            node("TSTypeParameterInstantiation", TextRange::new(13, 21)),
        );
    }
    call
}

fn as_expression_node(expression: LintNode, type_annotation: &str, range: TextRange) -> LintNode {
    let mut node = node_with_children("TSAsExpression", range, [("expression", expression)]);
    node.fields
        .insert("__typeAnnotationText".to_owned(), json!(type_annotation));
    node
}

fn promise_member_call_node(method_name: &str, arguments: Vec<LintNode>) -> LintNode {
    call_node(
        node_with_children(
            "MemberExpression",
            TextRange::new(0, 8 + method_name.len() as u32),
            [
                (
                    "object",
                    node_with_field("Identifier", TextRange::new(0, 7), "name", json!("Promise")),
                ),
                (
                    "property",
                    node_with_field(
                        "Identifier",
                        TextRange::new(8, 8 + method_name.len() as u32),
                        "name",
                        json!(method_name),
                    ),
                ),
            ],
        ),
        arguments,
    )
}

fn starts_with_binary_node() -> LintNode {
    let left = call_node(
        node_with_children(
            "MemberExpression",
            TextRange::new(0, 12),
            [
                (
                    "object",
                    node_with_field("Identifier", TextRange::new(0, 4), "name", json!("text")),
                ),
                (
                    "property",
                    node_with_field(
                        "Identifier",
                        TextRange::new(5, 12),
                        "name",
                        json!("indexOf"),
                    ),
                ),
            ],
        ),
        vec![node_with_field(
            "Identifier",
            TextRange::new(13, 19),
            "name",
            json!("prefix"),
        )],
    );
    let mut node = node_with_children(
        "BinaryExpression",
        TextRange::new(0, 26),
        [
            ("left", left),
            (
                "right",
                node_with_field("Literal", TextRange::new(25, 26), "value", json!(0)),
            ),
        ],
    );
    node.fields.insert("operator".to_owned(), json!("==="));
    node
}

fn binary_plus_node(left_type_text: &str, right_type_text: &str) -> LintNode {
    let mut left = node_with_field("Identifier", TextRange::new(0, 4), "name", json!("left"));
    left.type_texts = vec![left_type_text.to_owned()];
    let mut right = node_with_field("Identifier", TextRange::new(7, 12), "name", json!("right"));
    right.type_texts = vec![right_type_text.to_owned()];
    let mut node = node_with_children(
        "BinaryExpression",
        TextRange::new(0, 12),
        [("left", left), ("right", right)],
    );
    node.fields.insert("operator".to_owned(), json!("+"));
    node
}

fn typed_node(kind: &str, range: TextRange, type_text: &str) -> LintNode {
    let mut node = node(kind, range);
    node.type_texts = vec![type_text.to_owned()];
    node
}

fn template_node(expressions: Vec<LintNode>) -> LintNode {
    node_with_child_list(
        "TemplateLiteral",
        TextRange::new(0, 32),
        "expressions",
        expressions,
    )
}

fn member_expression_node(object: LintNode, property: LintNode, computed: bool) -> LintNode {
    let mut node = node_with_children(
        "MemberExpression",
        TextRange::new(0, 12),
        [("object", object), ("property", property)],
    );
    node.fields.insert("computed".to_owned(), json!(computed));
    node.fields.insert("optional".to_owned(), json!(false));
    node
}

fn void_operator_node(argument: LintNode) -> LintNode {
    let mut node = node_with_children(
        "UnaryExpression",
        TextRange::new(0, argument.range.end),
        [("argument", argument)],
    );
    node.fields.insert("operator".to_owned(), json!("void"));
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
