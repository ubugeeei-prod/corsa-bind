//! Rules reading the constrained view of the host `__type` fact and its
//! `__typeContext` (TypeScript 7 `TypeFlags`).
//!
//! The fixtures describe what typescript-eslint's helpers see: the
//! constrained type's `flags` and `value`, its `union` parts (each with its
//! `intersection` parts and position facts), `rawFlags` and `raw` parts of the
//! unconstrained type. [`hosted`] writes them the way the host sends them.

use serde_json::{Value, json};

use super::{LintDiagnostic, LintNode, LintRuleRegistry, TextRange};

const UNDEFINED: u32 = 1 << 2;
const NULL: u32 = 1 << 3;
const STRING: u32 = 1 << 5;
const NUMBER: u32 = 1 << 6;
const BOOLEAN: u32 = 1 << 8;
const STRING_LITERAL: u32 = 1 << 10;
const NUMBER_LITERAL: u32 = 1 << 11;
const BOOLEAN_LITERAL: u32 = 1 << 13;
const TYPE_PARAMETER: u32 = 1 << 19;
const OBJECT: u32 = 1 << 20;
const UNION: u32 = 1 << 27;
const INTERSECTION: u32 = 1 << 28;

fn run(rule: &str, node: Value) -> Vec<LintDiagnostic> {
    let node: LintNode = serde_json::from_value(hosted(node)).unwrap();
    LintRuleRegistry::with_default_type_aware_rules()
        .run_rule(rule, &node)
        .unwrap()
}

/// Replaces each fixture `__typeShape` in `node` by the host's `__type` and
/// `__typeContext`.
fn hosted(mut node: Value) -> Value {
    if let Some(fields) = node.get_mut("fields").and_then(Value::as_object_mut)
        && let Some(shape) = fields.remove("__typeShape")
    {
        let (ty, context) = host_type(&shape);
        fields.insert("__type".to_owned(), ty);
        fields.insert("__typeContext".to_owned(), context);
    }
    for key in ["children", "childLists"] {
        if let Some(children) = node.get_mut(key).and_then(Value::as_object_mut) {
            for child in children.values_mut() {
                let hosted_child = |child: &mut Value| *child = hosted(child.take());
                match child {
                    Value::Array(items) => items.iter_mut().for_each(hosted_child),
                    child => hosted_child(child),
                }
            }
        }
    }
    node
}

/// One fixture part (or intersection member) as a `__type` tree.
fn host_part(part: &Value) -> Value {
    let mut ty = json!({ "flags": part["flags"] });
    for key in ["value", "array", "tuple"] {
        if let Some(value) = part.get(key) {
            ty[key] = value.clone();
        }
    }
    if let Some(members) = part.get("intersection").and_then(Value::as_array) {
        ty["flags"] = json!(part["flags"].as_u64().unwrap_or(0) as u32 | INTERSECTION);
        ty["types"] = Value::Array(members.iter().map(host_part).collect());
    }
    ty
}

/// The position facts of a fixture part.
fn part_context(part: &Value) -> Value {
    let mut context = json!({});
    for key in ["member", "keyed", "indexKeys", "callReturnsNullable"] {
        if let Some(value) = part.get(key) {
            context[key] = value.clone();
        }
    }
    context
}

/// `(__type, __typeContext)` for a fixture shape.
fn host_type(shape: &Value) -> (Value, Value) {
    let flags = shape["flags"].as_u64().unwrap_or(0) as u32;
    let parts = shape["union"].as_array().cloned().unwrap_or_default();
    let mut constrained = match parts.as_slice() {
        [single] if flags & UNION == 0 => host_part(single),
        _ => json!({ "types": parts.iter().map(host_part).collect::<Vec<_>>() }),
    };
    constrained["flags"] = json!(flags);
    if let Some(value) = shape.get("value") {
        constrained["value"] = value.clone();
    }
    let mut context = part_context(shape);
    if flags & UNION != 0 {
        context["parts"] = Value::Array(parts.iter().map(part_context).collect());
    } else if let Some(single) = parts.first() {
        for (key, value) in part_context(single)
            .as_object()
            .cloned()
            .unwrap_or_default()
        {
            context[key.as_str()] = value;
        }
    }
    if let Some(keys) = shape.get("keys") {
        context["keys"] = keys.clone();
    }
    if let Some(returns) = shape.get("returns").and_then(Value::as_array) {
        context["returns"] = Value::Array(returns.iter().map(|value| host_type(value).0).collect());
    }
    if let Some(predicate) = shape.get("predicate") {
        let mut predicate = predicate.clone();
        if let Some(asserted) = predicate.get("shape") {
            predicate["shape"] = host_type(asserted).0;
        }
        context["predicate"] = predicate;
    }
    let constrained_away = shape.get("constrained").and_then(Value::as_bool) == Some(true);
    if !constrained_away {
        return (constrained, context);
    }
    let raw = shape.get("raw");
    let mut ty = json!({ "flags": shape.get("rawFlags").cloned().unwrap_or(json!(flags)) });
    if let Some(raw_parts) = raw.and_then(|raw| raw["union"].as_array()) {
        if ty["flags"].as_u64().unwrap_or(0) as u32 & UNION != 0 {
            ty["types"] = Value::Array(raw_parts.iter().map(host_part).collect());
        } else if let Some(single) = raw_parts.first() {
            let mut single = host_part(single);
            single["flags"] = ty["flags"].clone();
            ty = single;
        }
    }
    ty["constraint"] = constrained;
    (ty, context)
}

fn part(flags: u32) -> Value {
    json!({ "flags": flags })
}

fn literal(flags: u32, value: Value) -> Value {
    json!({ "flags": flags, "value": value })
}

/// A shape whose constrained type is `parts` (a union when more than one).
fn shape(parts: Vec<Value>) -> Value {
    let flags = if parts.len() > 1 {
        UNION
    } else {
        parts[0]["flags"].as_u64().unwrap() as u32
    };
    let mut shape = json!({ "flags": flags, "rawFlags": flags, "union": parts.clone() });
    if parts.len() == 1 {
        if let Some(value) = parts[0].get("value") {
            shape["value"] = value.clone();
        }
    }
    shape
}

fn expression(kind: &str, start: u32, end: u32, shape: Value) -> Value {
    json!({
        "kind": kind,
        "range": { "start": start, "end": end },
        "fields": { "__typeShape": shape },
    })
}

fn if_test(test: Value) -> Value {
    json!({
        "kind": "IfStatement",
        "range": { "start": 0, "end": 20 },
        "children": { "test": test },
    })
}

#[test]
fn condition_reports_object_shape_as_always_truthy() {
    let diagnostics = run(
        "no-unnecessary-condition",
        if_test(expression("Identifier", 4, 5, shape(vec![part(OBJECT)]))),
    );
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "alwaysTruthy");
}

#[test]
fn condition_ignores_branded_primitive_intersection() {
    // `(string | number) & { __brand: string }` stays possibly falsy.
    let branded = |primitive| {
        json!({
            "flags": INTERSECTION,
            "intersection": [part(primitive), part(OBJECT)],
        })
    };
    let diagnostics = run(
        "no-unnecessary-condition",
        if_test(expression(
            "Identifier",
            4,
            5,
            shape(vec![branded(STRING), branded(NUMBER)]),
        )),
    );
    assert!(diagnostics.is_empty());
}

#[test]
fn condition_ignores_unconstrained_type_parameter() {
    let diagnostics = run(
        "no-unnecessary-condition",
        if_test(expression(
            "Identifier",
            4,
            5,
            shape(vec![part(TYPE_PARAMETER)]),
        )),
    );
    assert!(diagnostics.is_empty());
}

#[test]
fn condition_reads_falsy_literal_values() {
    let falsy = shape(vec![
        literal(STRING_LITERAL, json!("")),
        literal(NUMBER_LITERAL, json!(0)),
        literal(BOOLEAN_LITERAL, json!(false)),
    ]);
    let diagnostics = run(
        "no-unnecessary-condition",
        if_test(expression("Identifier", 4, 5, falsy)),
    );
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "alwaysFalsy");
}

fn logical(operator: &str, left: Value, right: Value, chain: Value) -> Value {
    json!({
        "kind": "LogicalExpression",
        "range": { "start": 0, "end": 30 },
        "fields": { "operator": operator, "__ancestorChain": chain },
        "children": { "left": left, "right": right },
    })
}

#[test]
fn condition_checks_nested_right_operand_only_in_truthiness_context() {
    // `(b && 'b') || x`: the inner `'b'` is a value, not a condition.
    let inner = json!({
        "kind": "LogicalExpression",
        "range": { "start": 1, "end": 10 },
        "fields": { "operator": "&&" },
        "children": {
            "left": expression("Identifier", 1, 2, shape(vec![part(BOOLEAN)])),
            "right": expression("Literal", 6, 9, shape(vec![literal(STRING_LITERAL, json!("b"))])),
        },
    });
    let other = expression("Identifier", 15, 16, shape(vec![part(BOOLEAN)]));
    let statement = json!([{ "kind": "ExpressionStatement" }]);
    let diagnostics = run(
        "no-unnecessary-condition",
        logical("||", inner.clone(), other.clone(), statement),
    );
    assert!(diagnostics.is_empty());

    // Inside an `if` test the right operand is a condition.
    let test = json!([{ "kind": "IfStatement", "childIsTest": true }]);
    let diagnostics = run(
        "no-unnecessary-condition",
        logical("||", inner, other, test),
    );
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].range, TextRange::new(6, 9));
}

fn nullish(left: Value) -> Value {
    json!({
        "kind": "LogicalExpression",
        "range": { "start": 0, "end": 20 },
        "fields": { "operator": "??" },
        "children": {
            "left": left,
            "right": expression("Literal", 15, 18, shape(vec![literal(STRING_LITERAL, json!("x"))])),
        },
    })
}

#[test]
fn condition_reports_never_nullish_and_always_nullish() {
    let diagnostics = run(
        "no-unnecessary-condition",
        nullish(expression("Identifier", 0, 1, shape(vec![part(STRING)]))),
    );
    assert_eq!(diagnostics[0].message_id, "neverNullish");

    let diagnostics = run(
        "no-unnecessary-condition",
        nullish(expression("Identifier", 0, 1, shape(vec![part(NULL)]))),
    );
    assert_eq!(diagnostics[0].message_id, "alwaysNullish");
}

fn computed_member(object_shape: Value, member_shape: Value) -> Value {
    json!({
        "kind": "MemberExpression",
        "range": { "start": 0, "end": 8 },
        "fields": { "computed": true, "optional": false, "__typeShape": member_shape },
        "children": {
            "object": expression("Identifier", 0, 3, object_shape),
            "property": expression("Identifier", 4, 7, shape(vec![literal(STRING_LITERAL, json!("baz"))])),
        },
    })
}

#[test]
fn condition_reads_optional_computed_keys_for_nullish_coalescing() {
    // `foo[key] ?? 'x'` where `key: 'baz'` names an optional property.
    let mut object = shape(vec![part(OBJECT)]);
    object["keys"] = json!([{ "key": "baz", "typeName": "string" }]);
    object["keyed"] =
        json!([{ "found": true, "optional": true, "nullable": true, "nonNullish": true }]);
    object["indexKeys"] = json!([]);
    let diagnostics = run(
        "no-unnecessary-condition",
        nullish(computed_member(object.clone(), shape(vec![part(NUMBER)]))),
    );
    assert!(diagnostics.is_empty());

    // Every key reads an always-nullish property: `alwaysNullish`.
    object["keyed"] =
        json!([{ "found": true, "optional": true, "nullable": true, "nonNullish": false }]);
    let diagnostics = run(
        "no-unnecessary-condition",
        nullish(computed_member(object, shape(vec![part(UNDEFINED)]))),
    );
    assert_eq!(diagnostics[0].message_id, "alwaysNullish");
}

fn optional_member(object: Value) -> Value {
    json!({
        "kind": "MemberExpression",
        "range": { "start": 0, "end": 6 },
        "text": "foo?.a",
        "fields": { "optional": true, "computed": false },
        "children": {
            "object": object,
            "property": { "kind": "Identifier", "range": { "start": 5, "end": 6 }, "fields": { "name": "a" } },
        },
    })
}

#[test]
fn condition_reports_unnecessary_optional_chain_on_the_question_dot() {
    let diagnostics = run(
        "no-unnecessary-condition",
        optional_member(expression("Identifier", 0, 3, shape(vec![part(OBJECT)]))),
    );
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "neverOptionalChain");
    assert_eq!(diagnostics[0].range, TextRange::new(3, 5));

    let diagnostics = run(
        "no-unnecessary-condition",
        optional_member(expression(
            "Identifier",
            0,
            3,
            shape(vec![part(OBJECT), part(NULL)]),
        )),
    );
    assert!(diagnostics.is_empty());
}

#[test]
fn condition_traces_optional_chain_nullability_to_the_object() {
    // `foo?.bar?.baz` with `foo: { bar: {...} } | null`: `foo?.bar` is only
    // nullable because of `foo`, so the second `?.` is unnecessary.
    let mut foo = shape(vec![part(NULL), part(OBJECT)]);
    foo["union"][0]["member"] = json!({ "found": false });
    foo["union"][1]["member"] = json!({ "found": true, "optional": false, "nullable": false });
    let inner = json!({
        "kind": "MemberExpression",
        "range": { "start": 0, "end": 8 },
        "fields": { "optional": true, "computed": false, "__typeShape": shape(vec![part(UNDEFINED), part(OBJECT)]) },
        "children": {
            "object": expression("Identifier", 0, 3, foo),
            "property": { "kind": "Identifier", "range": { "start": 5, "end": 8 }, "fields": { "name": "bar" } },
        },
    });
    let outer = json!({
        "kind": "MemberExpression",
        "range": { "start": 0, "end": 13 },
        "text": "foo?.bar?.baz",
        "fields": { "optional": true, "computed": false },
        "children": {
            "object": inner,
            "property": { "kind": "Identifier", "range": { "start": 10, "end": 13 }, "fields": { "name": "baz" } },
        },
    });
    let diagnostics = run("no-unnecessary-condition", outer);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].range, TextRange::new(8, 10));
}

fn binary(operator: &str, left: Value, right: Value) -> Value {
    json!({
        "kind": "BinaryExpression",
        "range": { "start": 0, "end": 13 },
        "fields": { "operator": operator },
        "children": { "left": left, "right": right },
    })
}

#[test]
fn condition_reports_literal_comparisons_with_their_result() {
    let null = || expression("Literal", 0, 4, shape(vec![part(NULL)]));
    let diagnostics = run("no-unnecessary-condition", binary("!==", null(), null()));
    assert_eq!(diagnostics[0].message_id, "comparisonBetweenLiteralTypes");
    assert_eq!(
        diagnostics[0].message,
        "Unnecessary conditional, comparison is always false, since `null !== null` is false."
    );
}

#[test]
fn condition_reports_no_overlap_with_nullish_literals() {
    let value = expression("Identifier", 0, 1, shape(vec![part(STRING)]));
    let undefined = expression("Identifier", 6, 15, shape(vec![part(UNDEFINED)]));
    let diagnostics = run(
        "no-unnecessary-condition",
        binary("===", value.clone(), undefined.clone()),
    );
    assert_eq!(diagnostics[0].message_id, "noOverlapBooleanExpression");

    // Loose equality with `undefined` also matches `null`, still no overlap
    // for `string`; a nullable operand overlaps.
    let nullable = expression("Identifier", 0, 1, shape(vec![part(STRING), part(NULL)]));
    let diagnostics = run(
        "no-unnecessary-condition",
        binary("==", nullable, undefined),
    );
    assert!(diagnostics.is_empty());
}

fn element_access(no_unchecked: bool) -> Value {
    let mut array = shape(vec![part(OBJECT)]);
    array["union"][0]["array"] = json!(true);
    let mut test = json!({
        "kind": "MemberExpression",
        "range": { "start": 4, "end": 10 },
        "fields": { "computed": true, "__typeShape": shape(vec![part(OBJECT)]) },
        "children": {
            "object": expression("Identifier", 4, 7, array),
            "property": expression("Literal", 8, 9, shape(vec![literal(NUMBER_LITERAL, json!(0))])),
        },
    });
    let mut node = if_test(test.take());
    if no_unchecked {
        node["fields"] = json!({ "__noUncheckedIndexedAccess": true });
    }
    node
}

#[test]
fn condition_skips_array_index_without_no_unchecked_indexed_access() {
    assert!(run("no-unnecessary-condition", element_access(false)).is_empty());
    assert_eq!(
        run("no-unnecessary-condition", element_access(true)).len(),
        1
    );
}

fn trivial_template(expression_shape: Value) -> Value {
    json!({
        "kind": "TemplateLiteral",
        "range": { "start": 0, "end": 6 },
        "text": "`${x}`",
        "childLists": {
            "quasis": [
                { "kind": "TemplateElement", "range": { "start": 0, "end": 3 }, "fields": { "value": { "raw": "", "cooked": "" } } },
                { "kind": "TemplateElement", "range": { "start": 4, "end": 6 }, "fields": { "value": { "raw": "", "cooked": "" } } },
            ],
            "expressions": [expression("Identifier", 3, 4, expression_shape)],
        },
    })
}

#[test]
fn template_reports_only_types_that_are_already_strings() {
    let diagnostics = run(
        "no-unnecessary-template-expression",
        trivial_template(shape(vec![part(STRING)])),
    );
    assert_eq!(diagnostics.len(), 1);

    // `string | undefined` is not a string yet (#12881).
    let diagnostics = run(
        "no-unnecessary-template-expression",
        trivial_template(shape(vec![part(STRING), part(UNDEFINED)])),
    );
    assert!(diagnostics.is_empty());

    // `T extends string` is judged on its constraint.
    let mut constrained = shape(vec![part(STRING)]);
    constrained["rawFlags"] = json!(TYPE_PARAMETER);
    constrained["constrained"] = json!(true);
    let diagnostics = run(
        "no-unnecessary-template-expression",
        trivial_template(constrained),
    );
    assert_eq!(diagnostics.len(), 1);
}

fn literal_span_template(text: &str, expression: Value, next_raw: &str) -> Value {
    let end = text.len() as u32;
    json!({
        "kind": "TemplateLiteral",
        "range": { "start": 0, "end": end },
        "text": text,
        "childLists": {
            "quasis": [
                { "kind": "TemplateElement", "range": { "start": 0, "end": 3 }, "fields": { "value": { "raw": "", "cooked": "" } } },
                { "kind": "TemplateElement", "range": { "start": expression["__close"].as_u64().unwrap(), "end": end }, "fields": { "value": { "raw": next_raw, "cooked": next_raw } } },
            ],
            "expressions": [expression["node"].clone()],
        },
    })
}

#[test]
fn template_keeps_commented_interpolations() {
    // `${/* c */ 'bar'}`
    let text = "`${/* c */ 'bar'}`";
    let node = literal_span_template(
        text,
        json!({
            "__close": 16,
            "node": { "kind": "Literal", "range": { "start": 11, "end": 16 }, "fields": { "value": "bar" } },
        }),
        "",
    );
    assert!(run("no-unnecessary-template-expression", node).is_empty());
}

#[test]
fn template_keeps_whitespace_before_a_unicode_line_separator() {
    let text = "`${' '}\u{2028}`";
    let node = literal_span_template(
        text,
        json!({
            "__close": 7,
            "node": { "kind": "Literal", "range": { "start": 3, "end": 6 }, "fields": { "value": " " } },
        }),
        "\u{2028}",
    );
    assert!(run("no-unnecessary-template-expression", node).is_empty());
}

fn conversion_call(callee: &str, argument_shape: Value, global: bool) -> Value {
    json!({
        "kind": "CallExpression",
        "range": { "start": 0, "end": 9 },
        "fields": { "__calleeIsGlobalBuiltin": global },
        "children": {
            "callee": { "kind": "Identifier", "range": { "start": 0, "end": 6 }, "fields": { "name": callee }, "text": callee },
        },
        "childLists": {
            "arguments": [{
                "kind": "Identifier",
                "range": { "start": 7, "end": 8 },
                "text": "x",
                "fields": { "__typeShape": argument_shape },
            }],
        },
    })
}

#[test]
fn conversion_judges_calls_on_the_constrained_type() {
    let mut constrained = shape(vec![part(STRING)]);
    constrained["rawFlags"] = json!(TYPE_PARAMETER);
    constrained["constrained"] = json!(true);
    let diagnostics = run(
        "no-unnecessary-type-conversion",
        conversion_call("String", constrained, true),
    );
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
        diagnostics[0].message,
        "Passing a string to String() does not change the type or value of the string."
    );

    let diagnostics = run(
        "no-unnecessary-type-conversion",
        conversion_call("String", shape(vec![part(STRING)]), false),
    );
    assert!(diagnostics.is_empty());
}

fn unary(operator: &str, start: u32, argument: Value) -> Value {
    json!({
        "kind": "UnaryExpression",
        "range": { "start": start, "end": 7 },
        "fields": { "operator": operator, "prefix": true },
        "children": { "argument": argument },
    })
}

#[test]
fn conversion_reports_doubled_operators_from_the_outer_node() {
    let bang = unary(
        "!",
        0,
        unary(
            "!",
            1,
            expression(
                "Literal",
                2,
                6,
                shape(vec![literal(BOOLEAN_LITERAL, json!(true))]),
            ),
        ),
    );
    let diagnostics = run("no-unnecessary-type-conversion", bang);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].range, TextRange::new(0, 2));

    let tilde = |value| {
        unary(
            "~",
            0,
            unary(
                "~",
                1,
                expression("Literal", 2, 6, shape(vec![literal(NUMBER_LITERAL, value)])),
            ),
        )
    };
    assert_eq!(
        run("no-unnecessary-type-conversion", tilde(json!(3))).len(),
        1
    );
    assert!(run("no-unnecessary-type-conversion", tilde(json!(1.5))).is_empty());
}

#[test]
fn boolean_literal_compare_reads_type_parameter_constraints() {
    let mut constrained = shape(vec![
        literal(BOOLEAN_LITERAL, json!(false)),
        literal(BOOLEAN_LITERAL, json!(true)),
    ]);
    constrained["flags"] = json!(UNION | BOOLEAN);
    constrained["rawFlags"] = json!(TYPE_PARAMETER);
    constrained["constrained"] = json!(true);
    let node = binary(
        "===",
        expression("Identifier", 0, 1, constrained),
        json!({ "kind": "Literal", "range": { "start": 6, "end": 10 }, "fields": { "value": true } }),
    );
    let diagnostics = run("no-unnecessary-boolean-literal-compare", node);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "direct");

    let mut unconstrained = shape(vec![part(TYPE_PARAMETER)]);
    unconstrained["rawFlags"] = json!(TYPE_PARAMETER);
    let node = binary(
        "===",
        expression("Identifier", 0, 1, unconstrained),
        json!({ "kind": "Literal", "range": { "start": 6, "end": 10 }, "fields": { "value": true } }),
    );
    assert!(run("no-unnecessary-boolean-literal-compare", node).is_empty());
}

fn predicate_call(predicate: Value, options: Value) -> Value {
    json!({
        "kind": "CallExpression",
        "range": { "start": 0, "end": 12 },
        "fields": {
            "__ruleOptions": options,
            "__typeShape": { "flags": BOOLEAN, "union": [part(BOOLEAN)], "predicate": predicate },
        },
        "children": {
            "callee": { "kind": "Identifier", "range": { "start": 0, "end": 6 }, "fields": { "name": "assert" } },
        },
        "childLists": {
            "arguments": [{ "kind": "Identifier", "range": { "start": 7, "end": 11 }, "fields": { "name": "flag" } }],
        },
    })
}

#[test]
fn condition_checks_type_predicates_only_when_enabled() {
    // `assert(flag)` with `asserts value` and an always-truthy argument.
    let truthiness = json!({ "argument": 0, "asserts": true, "shape": shape(vec![part(OBJECT)]) });
    let enabled = json!([{ "checkTypePredicates": true }]);
    let diagnostics = run(
        "no-unnecessary-condition",
        predicate_call(truthiness.clone(), enabled.clone()),
    );
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].message_id, "alwaysTruthy");
    assert_eq!(diagnostics[0].range, TextRange::new(7, 11));
    assert!(
        run(
            "no-unnecessary-condition",
            predicate_call(truthiness, json!([{}]))
        )
        .is_empty()
    );

    // `isString(text)` where `text: string` already is the guarded type.
    let guard = json!({
        "argument": 0,
        "asserts": false,
        "argumentFlags": STRING,
        "assignable": true,
        "reverseAssignable": true,
        "predicateIsUnion": false,
    });
    let diagnostics = run(
        "no-unnecessary-condition",
        predicate_call(guard.clone(), enabled.clone()),
    );
    assert_eq!(diagnostics[0].message_id, "typeGuardAlreadyIsType");
    assert_eq!(
        diagnostics[0].message,
        "Unnecessary conditional, expression already has the type being checked by the type guard."
    );

    // A wider argument is a meaningful guard.
    let mut wider = guard;
    wider["reverseAssignable"] = json!(false);
    wider["assignable"] = json!(false);
    assert!(run("no-unnecessary-condition", predicate_call(wider, enabled)).is_empty());
}

#[test]
fn template_text_fallback_needs_every_union_member_to_be_a_string() {
    let mut node = trivial_template(shape(vec![part(STRING)]));
    let expression = &mut node["childLists"]["expressions"][0];
    expression["fields"] = json!({});
    expression["typeTexts"] = json!(["string | undefined"]);
    assert!(run("no-unnecessary-template-expression", node.clone()).is_empty());
    node["childLists"]["expressions"][0]["typeTexts"] = json!(["string & { __brand: 1 }"]);
    assert_eq!(run("no-unnecessary-template-expression", node).len(), 1);
}
