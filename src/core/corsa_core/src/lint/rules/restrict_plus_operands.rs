use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::rule_option_bool;
use crate::lint::type_shape::{TypeShape, flags};
use crate::utils::{TypeTextKind, classify_type_text};

/// Type-aware rule that requires plus operands to be explicitly compatible.
#[derive(Clone, Copy, Debug, Default)]
pub struct RestrictPlusOperandsRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "invalid",
        description: "Operands of + must be compatible primitive values.",
    },
    RuleMessage {
        id: "mismatched",
        description: "Operands of + operations must be of the same type.",
    },
    RuleMessage {
        id: "bigintAndNumber",
        description: "Numeric '+' operations must either be both bigints or both numbers.",
    },
];
const LISTENERS: &[&str] = &["AssignmentExpression", "BinaryExpression"];

impl RustLintRule for RestrictPlusOperandsRule {
    fn name(&self) -> &'static str {
        "restrict-plus-operands"
    }

    fn docs_description(&self) -> &'static str {
        "Require plus operands to be explicitly compatible."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        let options = RestrictPlusOperandsOptions::from_node(node);
        match node.kind.as_str() {
            "AssignmentExpression" => {
                if options.skip_compound_assignments || node.field_str("operator") != Some("+=") {
                    return;
                }
                let Some(left) = node.child("left") else {
                    return;
                };
                let Some(right) = node.child("right") else {
                    return;
                };
                report_if_invalid(ctx, node, left, right, options);
            }
            "BinaryExpression" => {
                if node.field_str("operator") != Some("+") {
                    return;
                }
                let Some(left) = node.child("left") else {
                    return;
                };
                let Some(right) = node.child("right") else {
                    return;
                };
                report_if_invalid(ctx, node, left, right, options);
            }
            _ => {}
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct RestrictPlusOperandsOptions {
    allow_any: bool,
    allow_boolean: bool,
    allow_nullish: bool,
    allow_number_and_string: bool,
    allow_reg_exp: bool,
    skip_compound_assignments: bool,
}

impl RestrictPlusOperandsOptions {
    fn from_node(node: &LintNode) -> Self {
        Self {
            allow_any: rule_option_bool(node, "allowAny").unwrap_or(true),
            allow_boolean: rule_option_bool(node, "allowBoolean").unwrap_or(true),
            allow_nullish: rule_option_bool(node, "allowNullish").unwrap_or(true),
            allow_number_and_string: rule_option_bool(node, "allowNumberAndString").unwrap_or(true),
            allow_reg_exp: rule_option_bool(node, "allowRegExp").unwrap_or(true),
            skip_compound_assignments: rule_option_bool(node, "skipCompoundAssignments")
                .unwrap_or(false),
        }
    }
}

fn report_if_invalid(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    left: &LintNode,
    right: &LintNode,
    options: RestrictPlusOperandsOptions,
) {
    if let (Some(left_shape), Some(right_shape)) = (TypeShape::of(left), TypeShape::of(right)) {
        check_shapes(ctx, node, (left, left_shape), (right, right_shape), options);
        return;
    }
    let left_kind = classify_node_type(left);
    let right_kind = classify_node_type(right);
    if is_allowed(left_kind, right_kind, options) {
        return;
    }
    let message_id = if matches!(
        (left_kind, right_kind),
        (TypeTextKind::Other, _)
            | (_, TypeTextKind::Other)
            | (TypeTextKind::Unknown, _)
            | (_, TypeTextKind::Unknown)
    ) {
        "invalid"
    } else {
        "mismatched"
    };
    ctx.report(message_id, node.range);
}

/// typescript-eslint's `checkPlusOperands`, over checker type shapes.
fn check_shapes(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    (left, left_shape): (&LintNode, TypeShape),
    (right, right_shape): (&LintNode, TypeShape),
    options: RestrictPlusOperandsOptions,
) {
    let left_type = left_shape.constrained().base_of_literal();
    let right_type = right_shape.constrained().base_of_literal();
    if !left_type.parts_known() || !right_type.parts_known() {
        return;
    }
    if left_type.same_type(&right_type)
        && left_type.has(flags::BIGINT_LIKE | flags::NUMBER_LIKE | flags::STRING_LIKE)
    {
        return;
    }
    let string_like = string_like_description(options);
    let mut had_individual_complaint = false;
    for (base_node, base_type, other_type) in [
        (left, &left_type, &right_type),
        (right, &right_type, &left_type),
    ] {
        if base_type.has_in_union(flags::ES_SYMBOL_LIKE | flags::NEVER | flags::UNKNOWN)
            || (!options.allow_any && base_type.has_in_union(flags::ANY))
            || (!options.allow_boolean && base_type.has_in_union(flags::BOOLEAN_LIKE))
            || (!options.allow_nullish && base_type.has(flags::NULL | flags::UNDEFINED))
        {
            report_invalid(ctx, base_node, &base_type.text, &string_like);
            had_individual_complaint = true;
            continue;
        }
        for part in base_type.union_parts() {
            let invalid = if part.text == "RegExp" {
                !options.allow_reg_exp || other_type.has(flags::NUMBER_LIKE)
            } else {
                (!options.allow_any && part.has(flags::ANY)) || is_deeply_object_type(part)
            };
            if invalid {
                report_invalid(ctx, base_node, &part.text, &string_like);
                had_individual_complaint = true;
            }
        }
    }
    if had_individual_complaint {
        return;
    }
    for (base_type, other_type) in [(&left_type, &right_type), (&right_type, &left_type)] {
        if !options.allow_number_and_string
            && base_type.has_in_union(flags::STRING_LIKE)
            && other_type.has_in_union(flags::NUMBER_LIKE | flags::BIGINT_LIKE)
        {
            ctx.report_with_message(
                "mismatched",
                format!(
                    "Operands of '+' operations must be a number or {string_like}. Got `{}` + `{}`.",
                    left_type.text, right_type.text
                ),
                node.range,
            );
            return;
        }
        if base_type.has_in_union(flags::NUMBER_LIKE) && other_type.has_in_union(flags::BIGINT_LIKE)
        {
            ctx.report_with_message(
                "bigintAndNumber",
                format!(
                    "Numeric '+' operations must either be both bigints or both numbers. Got `{}` + `{}`.",
                    left_type.text, right_type.text
                ),
                node.range,
            );
            return;
        }
    }
}

fn report_invalid(
    ctx: &mut RuleContext<'_>,
    operand: &LintNode,
    type_text: &str,
    string_like: &str,
) {
    ctx.report_with_message(
        "invalid",
        format!(
            "Invalid operand for a '+' operation. Operands must each be a number or {string_like}. Got `{type_text}`."
        ),
        operand.range,
    );
}

/// `isDeeplyObjectType`: an object, or an intersection made only of objects.
fn is_deeply_object_type(shape: &TypeShape) -> bool {
    if shape.is_intersection() {
        return !shape.types.is_empty() && shape.types.iter().all(TypeShape::is_object);
    }
    shape.is_object()
}

fn string_like_description(options: RestrictPlusOperandsOptions) -> String {
    let allowed = [
        (options.allow_any, "`any`"),
        (options.allow_boolean, "`boolean`"),
        (options.allow_nullish, "`null`"),
        (options.allow_reg_exp, "`RegExp`"),
        (options.allow_nullish, "`undefined`"),
    ]
    .into_iter()
    .filter_map(|(allowed, name)| allowed.then_some(name))
    .collect::<Vec<_>>();
    match allowed.as_slice() {
        [] => "string".to_owned(),
        [only] => format!("string, allowing a string + {only}"),
        all => format!("string, allowing a string + any of: {}", all.join(", ")),
    }
}

fn classify_node_type(node: &LintNode) -> TypeTextKind {
    classify_type_text(node.type_texts.first().map(String::as_str))
}

fn is_allowed(
    left_kind: TypeTextKind,
    right_kind: TypeTextKind,
    options: RestrictPlusOperandsOptions,
) -> bool {
    if left_kind == right_kind
        && matches!(
            left_kind,
            TypeTextKind::Bigint | TypeTextKind::Number | TypeTextKind::String
        )
    {
        return true;
    }
    if options.allow_number_and_string
        && matches!(
            (left_kind, right_kind),
            (TypeTextKind::String, TypeTextKind::Number)
                | (TypeTextKind::Number, TypeTextKind::String)
        )
    {
        return true;
    }
    if left_kind == TypeTextKind::String && is_string_companion(right_kind, options) {
        return true;
    }
    if right_kind == TypeTextKind::String && is_string_companion(left_kind, options) {
        return true;
    }
    false
}

fn is_string_companion(kind: TypeTextKind, options: RestrictPlusOperandsOptions) -> bool {
    matches!(
        kind,
        TypeTextKind::Any if options.allow_any
    ) || matches!(
        kind,
        TypeTextKind::Boolean if options.allow_boolean
    ) || matches!(
        kind,
        TypeTextKind::Nullish if options.allow_nullish
    ) || matches!(
        kind,
        TypeTextKind::Regexp if options.allow_reg_exp
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintDiagnostic, LintNode, RuleContext, RustLintRule, TextRange};
    use super::RestrictPlusOperandsRule;
    use crate::lint::type_shape::flags;

    fn run(node: &LintNode) -> Vec<LintDiagnostic> {
        let rule = RestrictPlusOperandsRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
    }

    fn operand(start: u32, end: u32, shape: serde_json::Value) -> serde_json::Value {
        json!({
            "kind": "Identifier",
            "range": { "start": start, "end": end },
            "fields": { "__typeShape": shape }
        })
    }

    fn plus(left: serde_json::Value, right: serde_json::Value) -> LintNode {
        serde_json::from_value(json!({
            "kind": "BinaryExpression",
            "range": { "start": 0, "end": 12 },
            "fields": { "operator": "+" },
            "children": { "left": left, "right": right }
        }))
        .unwrap()
    }

    fn string() -> serde_json::Value {
        json!({ "id": "s", "flags": flags::STRING, "text": "string" })
    }

    fn boolean() -> serde_json::Value {
        json!({
            "id": "b", "flags": flags::BOOLEAN | flags::UNION, "text": "boolean",
            "types": [
                { "id": "f", "flags": flags::BOOLEAN_LITERAL, "text": "false" },
                { "id": "t", "flags": flags::BOOLEAN_LITERAL, "text": "true" }
            ]
        })
    }

    #[test]
    fn allows_constrained_generics_and_branded_primitives() {
        let generic = json!({
            "id": "T", "flags": flags::TYPE_PARAMETER, "text": "T",
            "constraint": { "id": "n", "flags": flags::NUMBER, "text": "number" }
        });
        let one = json!({ "id": "1", "flags": flags::NUMBER_LITERAL, "text": "1" });
        assert!(run(&plus(operand(0, 1, generic), operand(4, 5, one))).is_empty());

        let branded = json!({
            "id": "i", "flags": flags::INTERSECTION, "text": "{} & string",
            "types": [
                { "id": "o", "flags": flags::OBJECT, "text": "{}" },
                { "id": "s", "flags": flags::STRING, "text": "string" }
            ]
        });
        assert!(run(&plus(operand(0, 1, branded), operand(4, 5, string()))).is_empty());
    }

    #[test]
    fn defaults_allow_boolean_any_nullish_and_regexp() {
        let regexp = json!({ "id": "r", "flags": flags::OBJECT, "text": "RegExp" });
        assert!(run(&plus(operand(0, 1, string()), operand(4, 5, regexp))).is_empty());
        assert!(run(&plus(operand(0, 1, string()), operand(4, 5, boolean()))).is_empty());
    }

    #[test]
    fn reports_each_object_constituent_on_its_operand() {
        let objects = json!({
            "id": "u", "flags": flags::UNION, "text": "A | B",
            "types": [
                { "id": "a", "flags": flags::OBJECT, "text": "A" },
                { "id": "b", "flags": flags::OBJECT, "text": "B" }
            ]
        });
        let diagnostics = run(&plus(operand(0, 1, objects), operand(4, 6, string())));
        assert_eq!(diagnostics.len(), 2);
        assert!(
            diagnostics
                .iter()
                .all(|diagnostic| diagnostic.range == TextRange::new(0, 1))
        );
        assert!(diagnostics[0].message.ends_with("Got `A`."));
    }

    #[test]
    fn disallowed_boolean_is_reported_on_the_boolean_operand() {
        // `label + flag` with `allowBoolean: false`.
        let mut node = plus(operand(0, 5, string()), operand(8, 12, boolean()));
        node.fields.insert(
            "__ruleOptions".to_owned(),
            json!([{ "allowBoolean": false }]),
        );
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "invalid");
        assert_eq!(diagnostics[0].range, TextRange::new(8, 12));
        assert_eq!(
            diagnostics[0].message,
            "Invalid operand for a '+' operation. Operands must each be a number or string, allowing a string + any of: `any`, `null`, `RegExp`, `undefined`. Got `boolean`."
        );
    }

    #[test]
    fn reports_number_and_bigint() {
        let number = json!({ "id": "n", "flags": flags::NUMBER, "text": "number" });
        let bigint = json!({ "id": "g", "flags": flags::BIGINT, "text": "bigint" });
        let diagnostics = run(&plus(operand(0, 1, number), operand(4, 5, bigint)));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "bigintAndNumber");
        assert_eq!(diagnostics[0].range, TextRange::new(0, 12));
    }
}
