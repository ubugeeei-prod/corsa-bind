//! Rules deciding on host checker details (`__typeDetail`, `__callParameters`,
//! `__functionReturns`, contextual types) rather than rendered type text.

use serde_json::{Value, json};

use super::checker_types::{TypeDetail, is_unsafe_assignment};
use super::{LintDiagnostic, LintNode, LintRuleRegistry};

const ANY: u32 = 1;
const UNKNOWN: u32 = 2;
const STRING: u32 = 1 << 5;
const NUMBER: u32 = 1 << 6;
const STRING_LITERAL: u32 = 1 << 10;
const NUMBER_LITERAL: u32 = 1 << 11;
const ENUM_LITERAL: u32 = 1 << 15;
const TYPE_PARAMETER: u32 = 1 << 19;
const OBJECT: u32 = 1 << 20;
const UNION: u32 = 1 << 27;
const REFERENCE: u32 = 1 << 2;

fn run(rule: &str, node: &Value) -> Vec<LintDiagnostic> {
    let node: LintNode = serde_json::from_value(node.clone()).unwrap();
    LintRuleRegistry::with_default_type_aware_rules()
        .run_rule(rule, &node)
        .unwrap()
}

/// A plain (non-union) type detail.
fn simple(id: &str, flags: u32) -> Value {
    json!({ "id": id, "flags": flags, "parts": [{ "id": id, "flags": flags }] })
}

fn reference(id: &str, target: &str, text: &str, arguments: Vec<Value>) -> Value {
    json!({
        "id": id,
        "flags": OBJECT,
        "objectFlags": REFERENCE,
        "target": target,
        "text": text,
        "typeArguments": arguments,
        "parts": [{ "id": id, "flags": OBJECT }],
    })
}

/// `enum Fruit { Apple, Banana }` as the union of its members.
fn fruit() -> Value {
    let member = |id: &str| json!({ "id": id, "flags": ENUM_LITERAL | NUMBER_LITERAL, "enumId": "fruit", "enumText": "Fruit" });
    json!({ "id": "fruit", "flags": UNION | ENUM_LITERAL, "parts": [member("apple"), member("banana")] })
}

fn typed(kind: &str, start: u32, end: u32, detail: Value) -> Value {
    json!({ "kind": kind, "range": { "start": start, "end": end }, "fields": { "__typeDetail": detail } })
}

fn with(mut node: Value, key: &str, child: Value) -> Value {
    node.as_object_mut()
        .unwrap()
        .entry("children")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap()
        .insert(key.to_owned(), child);
    node
}

fn field(mut node: Value, key: &str, value: Value) -> Value {
    node["fields"]
        .as_object_mut()
        .unwrap()
        .insert(key.to_owned(), value);
    node
}

#[test]
fn unsafe_assignment_compares_type_arguments_of_the_same_generic_only() {
    let set_any = reference("s1", "Set", "Set<any>", vec![simple("any", ANY)]);
    let set_string = reference("s2", "Set", "Set<string>", vec![simple("string", STRING)]);
    let readonly_set = reference(
        "s3",
        "ReadonlySet",
        "ReadonlySet<number>",
        vec![simple("n", NUMBER)],
    );
    let sender = TypeDetail::from_value(&set_any).unwrap();

    assert!(is_unsafe_assignment(
        sender,
        TypeDetail::from_value(&set_string).unwrap(),
        None
    ));
    assert!(!is_unsafe_assignment(
        sender,
        TypeDetail::from_value(&readonly_set).unwrap(),
        None
    ));
    assert!(!is_unsafe_assignment(
        sender,
        TypeDetail::from_value(&set_any).unwrap(),
        None
    ));
}

#[test]
fn unary_minus_accepts_a_type_parameter_constrained_to_number() {
    let generic = json!({
        "id": "t", "flags": TYPE_PARAMETER, "parts": [{ "id": "t", "flags": TYPE_PARAMETER }],
        "constraint": simple("n", NUMBER),
    });
    let minus = |detail: Value| {
        with(
            json!({ "kind": "UnaryExpression", "range": { "start": 0, "end": 2 }, "fields": { "operator": "-" } }),
            "argument",
            typed("Identifier", 1, 2, detail),
        )
    };

    assert!(run("no-unsafe-unary-minus", &minus(generic)).is_empty());
    assert_eq!(
        run("no-unsafe-unary-minus", &minus(simple("s", STRING))).len(),
        1
    );
}

#[test]
fn unsafe_call_reads_any_from_flags_and_skips_an_untyped_super() {
    let call = |callee: Value| {
        with(
            json!({ "kind": "CallExpression", "range": { "start": 0, "end": 3 }, "fields": {} }),
            "callee",
            callee,
        )
    };

    assert_eq!(
        run(
            "no-unsafe-call",
            &call(typed("Identifier", 0, 1, simple("any", ANY)))
        )
        .len(),
        1
    );
    assert!(
        run(
            "no-unsafe-call",
            &call(typed("Super", 0, 5, simple("any", ANY)))
        )
        .is_empty()
    );
    let typed_super = field(
        typed("Super", 0, 5, simple("any", ANY)),
        "__typedFromSuperClass",
        json!(true),
    );
    assert_eq!(run("no-unsafe-call", &call(typed_super)).len(), 1);
}

#[test]
fn unsafe_call_trusts_signatures_of_a_function_named_type() {
    let mut callee = typed("Identifier", 0, 1, simple("f", OBJECT));
    callee["typeTexts"] = json!(["Function"]);
    let counted = |call: u32| {
        let callee = field(
            field(callee.clone(), "__callSignatureCount", json!(call)),
            "__constructSignatureCount",
            json!(0),
        );
        with(
            json!({ "kind": "CallExpression", "range": { "start": 0, "end": 3 }, "fields": {} }),
            "callee",
            callee,
        )
    };

    assert!(run("no-unsafe-call", &counted(1)).is_empty());
    assert_eq!(run("no-unsafe-call", &counted(0)).len(), 1);
}

#[test]
fn unsafe_member_access_ignores_heritage_clauses() {
    let member = with(
        json!({ "kind": "MemberExpression", "range": { "start": 0, "end": 4 }, "fields": {
            "computed": false,
            "__ancestorChain": [{ "kind": "TSClassImplements" }],
        } }),
        "object",
        typed("Identifier", 0, 2, simple("any", ANY)),
    );

    assert!(run("no-unsafe-member-access", &member).is_empty());
}

fn declarator(id: Value, init: Value) -> Value {
    with(
        with(
            json!({ "kind": "VariableDeclarator", "range": { "start": 0, "end": 20 }, "fields": {} }),
            "id",
            id,
        ),
        "init",
        init,
    )
}

#[test]
fn unsafe_assignment_without_annotation_only_reports_a_top_level_any() {
    let set_any = reference("s1", "Set", "Set<any>", vec![simple("any", ANY)]);
    let inferred = declarator(
        typed("Identifier", 0, 1, set_any.clone()),
        typed("NewExpression", 4, 18, set_any),
    );
    assert!(run("no-unsafe-assignment", &inferred).is_empty());

    let any = declarator(
        typed("Identifier", 0, 1, simple("any", ANY)),
        typed("Identifier", 4, 5, simple("any", ANY)),
    );
    assert_eq!(run("no-unsafe-assignment", &any).len(), 1);

    let to_unknown = declarator(
        typed("Identifier", 0, 1, simple("u", UNKNOWN)),
        typed("Identifier", 4, 5, simple("any", ANY)),
    );
    assert!(run("no-unsafe-assignment", &to_unknown).is_empty());
}

#[test]
fn unsafe_assignment_exempts_an_empty_map_construction() {
    let annotated = |init: Value| {
        let id = with(
            typed(
                "Identifier",
                0,
                1,
                reference(
                    "m1",
                    "Map",
                    "Map<string, string>",
                    vec![simple("s", STRING), simple("s", STRING)],
                ),
            ),
            "typeAnnotation",
            json!({ "kind": "TSTypeAnnotation", "range": { "start": 1, "end": 5 } }),
        );
        declarator(id, init)
    };
    let map_any = reference(
        "m2",
        "Map",
        "Map<any, any>",
        vec![simple("any", ANY), simple("any", ANY)],
    );
    let empty_map = with(
        typed("NewExpression", 8, 17, map_any.clone()),
        "callee",
        json!({
            "kind": "Identifier", "range": { "start": 12, "end": 15 }, "fields": { "name": "Map" }
        }),
    );
    assert!(run("no-unsafe-assignment", &annotated(empty_map)).is_empty());
    assert_eq!(
        run(
            "no-unsafe-assignment",
            &annotated(typed("Identifier", 8, 9, map_any))
        )
        .len(),
        1
    );
}

#[test]
fn unsafe_assignment_reports_any_tuple_elements_in_array_patterns() {
    let tuple = json!({
        "id": "t", "flags": OBJECT, "objectFlags": REFERENCE, "isTuple": true,
        "typeArguments": [simple("any", ANY)], "parts": [{ "id": "t", "flags": OBJECT }],
    });
    let pattern = json!({ "kind": "ArrayPattern", "range": { "start": 0, "end": 3 }, "fields": {},
        "childLists": { "elements": [{ "kind": "Identifier", "range": { "start": 1, "end": 2 } }] } });
    let diagnostics = run(
        "no-unsafe-assignment",
        &declarator(pattern, typed("TSAsExpression", 6, 20, tuple)),
    );

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeArrayPatternFromTuple");
    assert_eq!(diagnostics[0].range.start, 1);
}

fn returning(returned: Value, signature: Value, has_return_type: bool, is_async: bool) -> Value {
    with(
        json!({ "kind": "ReturnStatement", "range": { "start": 0, "end": 10 }, "fields": {
            "__functionReturns": { "contextual": false, "signatures": [{ "texts": [], "detail": signature }] },
            "__functionHasReturnType": has_return_type,
            "__functionIsAsync": is_async,
        } }),
        "argument",
        returned,
    )
}

#[test]
fn unsafe_return_follows_the_declared_signature() {
    let any = || typed("Identifier", 7, 8, simple("any", ANY));
    assert!(
        run(
            "no-unsafe-return",
            &returning(any(), simple("any", ANY), true, false)
        )
        .is_empty()
    );
    assert!(
        run(
            "no-unsafe-return",
            &returning(any(), simple("u", UNKNOWN), true, false)
        )
        .is_empty()
    );
    assert_eq!(
        run(
            "no-unsafe-return",
            &returning(any(), simple("n", NUMBER), true, false)
        )
        .len(),
        1
    );

    let promise_any = reference("p", "Promise", "Promise<any>", vec![simple("any", ANY)]);
    let object = simple("o", OBJECT);
    assert!(
        run(
            "no-unsafe-return",
            &returning(
                typed("CallExpression", 7, 9, promise_any),
                object,
                true,
                false
            )
        )
        .is_empty()
    );
}

#[test]
fn unsafe_argument_checks_the_resolved_parameter_type() {
    let call = with(
        json!({ "kind": "CallExpression", "range": { "start": 0, "end": 12 }, "fields": {
            "__callParameters": { "parameterCount": 1, "hasRest": false,
                "positions": [{ "texts": ["number"], "detail": simple("n", NUMBER) }] },
        }, "childLists": { "arguments": [typed("TSAsExpression", 4, 11, simple("any", ANY))] } }),
        "callee",
        typed("Identifier", 0, 3, simple("f", OBJECT)),
    );
    let diagnostics = run("no-unsafe-argument", &call);

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].range.start, 4);
}

fn comparison(left: Value, right: Value) -> Value {
    with(
        with(
            json!({ "kind": "BinaryExpression", "range": { "start": 0, "end": 9 }, "fields": { "operator": "===" } }),
            "left",
            left,
        ),
        "right",
        right,
    )
}

#[test]
fn unsafe_enum_comparison_reads_enum_identity_from_details() {
    let fruit_value = || typed("Identifier", 0, 1, fruit());
    let one = typed("Literal", 6, 7, simple("1", NUMBER_LITERAL));
    assert_eq!(
        run("no-unsafe-enum-comparison", &comparison(fruit_value(), one)).len(),
        1
    );
    assert!(
        run(
            "no-unsafe-enum-comparison",
            &comparison(fruit_value(), fruit_value())
        )
        .is_empty()
    );
    let text = typed("Literal", 6, 9, simple("a", STRING_LITERAL));
    assert!(
        run(
            "no-unsafe-enum-comparison",
            &comparison(fruit_value(), text)
        )
        .is_empty()
    );
}

#[test]
fn unsafe_enum_assignment_names_the_receiving_enum() {
    let node = declarator(
        typed("Identifier", 0, 1, fruit()),
        typed("Literal", 10, 11, simple("1", NUMBER_LITERAL)),
    );
    let diagnostics = run("no-unsafe-enum-assignment", &node);

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
        diagnostics[0].message,
        "The value assigned here does not have a shared enum type with the expected enum 'Fruit'."
    );
    let member = declarator(
        typed("Identifier", 0, 1, fruit()),
        typed("MemberExpression", 10, 21, fruit()),
    );
    assert!(run("no-unsafe-enum-assignment", &member).is_empty());
}

#[test]
fn unsafe_enum_assignment_allows_bitwise_combinations_of_members() {
    let combined = with(
        with(
            typed("BinaryExpression", 10, 30, simple("n", NUMBER)),
            "left",
            typed("MemberExpression", 10, 19, fruit()),
        ),
        "right",
        typed("MemberExpression", 22, 30, fruit()),
    );
    let combined = field(combined, "operator", json!("|"));
    let node = declarator(typed("Identifier", 0, 1, fruit()), combined);

    assert!(run("no-unsafe-enum-assignment", &node).is_empty());
}

#[test]
fn mixed_enums_follow_an_earlier_merged_declaration() {
    let member = |start: u32, initializer: Option<Value>| {
        let member =
            json!({ "kind": "TSEnumMember", "range": { "start": start, "end": start + 5 } });
        match initializer {
            Some(initializer) => with(member, "initializer", initializer),
            None => member,
        }
    };
    let text = json!({ "kind": "Literal", "range": { "start": 24, "end": 27 }, "fields": { "value": "b" } });
    let declaration = with(
        with(
            json!({ "kind": "TSEnumDeclaration", "range": { "start": 15, "end": 30 } }),
            "body",
            json!({ "kind": "TSEnumBody", "range": { "start": 20, "end": 30 },
                "childLists": { "members": [member(20, Some(text))] } }),
        ),
        "__previousEnumFirstMember",
        member(2, None),
    );

    let diagnostics = run("no-mixed-enums", &declaration);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].range.start, 24);
}

#[test]
fn unsafe_assignment_reports_any_destructured_properties() {
    let value = field(
        json!({ "kind": "Identifier", "range": { "start": 2, "end": 3 }, "fields": {} }),
        "__destructuredType",
        simple("any", ANY),
    );
    let property = with(
        with(
            json!({ "kind": "Property", "range": { "start": 2, "end": 3 }, "fields": {} }),
            "key",
            json!({ "kind": "Identifier", "range": { "start": 2, "end": 3 }, "fields": { "name": "x" } }),
        ),
        "value",
        value,
    );
    let pattern = json!({ "kind": "ObjectPattern", "range": { "start": 0, "end": 5 },
        "childLists": { "properties": [property] } });
    let diagnostics = run(
        "no-unsafe-assignment",
        &declarator(pattern, typed("TSAsExpression", 8, 30, simple("o", OBJECT))),
    );

    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "unsafeObjectPattern");
    assert_eq!(
        diagnostics[0].message,
        "Unsafe object destructuring of a property with an `any` value."
    );
}
