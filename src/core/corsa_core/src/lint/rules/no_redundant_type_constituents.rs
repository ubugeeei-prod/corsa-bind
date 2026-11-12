use std::collections::BTreeMap;

use serde_json::Value;

use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    ancestor_fact, ancestor_facts, ancestor_kind, is_function_or_function_type,
};

/// Type-aware rule that flags union/intersection constituents made redundant by
/// other constituents (top/bottom types and primitive-over-literal overrides).
///
/// Faithful port of the tsgolint Go rule `no-redundant-type-constituents`.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoRedundantTypeConstituentsRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "errorTypeOverrides",
        description: "Constituent is an 'error' type that acts as 'any' and overrides all other types.",
    },
    RuleMessage {
        id: "literalOverridden",
        description: "Literal constituent is overridden by a primitive in this union type.",
    },
    RuleMessage {
        id: "overridden",
        description: "Constituent is overridden by other types in this type.",
    },
    RuleMessage {
        id: "overrides",
        description: "Constituent overrides all other types in this type.",
    },
    RuleMessage {
        id: "primitiveOverridden",
        description: "Primitive constituent is overridden by literals in this intersection type.",
    },
];

const LISTENERS: &[&str] = &["TSUnionType", "TSIntersectionType"];

impl RustLintRule for NoRedundantTypeConstituentsRule {
    fn name(&self) -> &'static str {
        "no-redundant-type-constituents"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow members of unions and intersections that do nothing or override type information."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "TSIntersectionType" => check_intersection(ctx, node),
            "TSUnionType" => check_union(ctx, node),
            _ => {}
        }
    }
}

/// Type-flag classification of a single resolved type part, mirroring the subset
/// of `checker.TypeFlags` the Go rule branches on.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PartFlag {
    Any,
    /// An `error` type that acts as `any` (e.g. unresolved type reference).
    Error,
    Never,
    Unknown,
    BigInt,
    Boolean,
    Number,
    String,
    BigIntLiteral,
    BooleanLiteral,
    NumberLiteral,
    StringLiteral,
    TemplateLiteral,
    /// Anything else (`null`, `undefined`, objects, ...) that the rule ignores.
    Other,
}

/// One resolved type part: its flag and the rendered text used in messages.
#[derive(Clone, Debug)]
struct TypePart {
    flag: PartFlag,
    /// Raw TypeScript 7 `TypeFlags` of the part when the host supplied them.
    /// Union checks test primitive bits with `&` (a `boolean` alias is
    /// `Boolean | Union`), while every other check compares flags exactly.
    raw_flags: Option<u32>,
    /// How upstream names the part in messages (`describeLiteralType`):
    /// `"a"`, `1`, `-1n`, `true`, `any`, `template literal type`, ...
    text: String,
}

/// A type node that resolved to two or more parts (definitely a union).
struct SeenUnion<'a> {
    parts: Vec<TypePart>,
    node: &'a LintNode,
}

/// Returns the rendered text for an AST keyword / literal part.
fn keyword_text(kind: &str) -> &'static str {
    match kind {
        "TSAnyKeyword" => "any",
        "TSBooleanKeyword" => "boolean",
        "TSNeverKeyword" => "never",
        "TSNumberKeyword" => "number",
        "TSStringKeyword" => "string",
        "TSUnknownKeyword" => "unknown",
        "TSBigIntKeyword" => "bigint",
        _ => "literal type",
    }
}

// TypeScript 7 `TypeFlags` (microsoft/typescript-go internal/checker/types.go).
const TS_ANY: u32 = 1;
const TS_UNKNOWN: u32 = 1 << 1;
const TS_STRING: u32 = 1 << 5;
const TS_NUMBER: u32 = 1 << 6;
const TS_BIGINT: u32 = 1 << 7;
const TS_BOOLEAN: u32 = 1 << 8;
const TS_STRING_LITERAL: u32 = 1 << 10;
const TS_NUMBER_LITERAL: u32 = 1 << 11;
const TS_BIGINT_LITERAL: u32 = 1 << 12;
const TS_BOOLEAN_LITERAL: u32 = 1 << 13;
const TS_NEVER: u32 = 1 << 18;
const TS_TEMPLATE_LITERAL: u32 = 1 << 22;

impl TypePart {
    fn syntactic(flag: PartFlag, text: String) -> Self {
        Self {
            flag,
            raw_flags: None,
            text,
        }
    }

    /// Whether the part carries `primitive`'s flag bit, as the upstream union
    /// check tests `(typeFlags & primitiveTypeFlag) !== 0`.
    fn has_primitive_bit(&self, primitive: PartFlag) -> bool {
        match self.raw_flags {
            Some(flags) => {
                let bit = match primitive {
                    PartFlag::BigInt => TS_BIGINT,
                    PartFlag::Boolean => TS_BOOLEAN,
                    PartFlag::Number => TS_NUMBER,
                    PartFlag::String => TS_STRING,
                    _ => return false,
                };
                flags & bit != 0
            }
            None => self.flag == primitive,
        }
    }
}

/// Classifies raw flags the way upstream compares them: by exact equality.
/// `error` types share `any`'s flags, so the host label decides between them.
fn flag_from_raw(flags: u32, label: PartFlag) -> PartFlag {
    match flags {
        TS_ANY if label == PartFlag::Error => PartFlag::Error,
        TS_ANY => PartFlag::Any,
        TS_UNKNOWN => PartFlag::Unknown,
        TS_NEVER => PartFlag::Never,
        TS_STRING => PartFlag::String,
        TS_NUMBER => PartFlag::Number,
        TS_BIGINT => PartFlag::BigInt,
        TS_BOOLEAN => PartFlag::Boolean,
        TS_STRING_LITERAL => PartFlag::StringLiteral,
        TS_NUMBER_LITERAL => PartFlag::NumberLiteral,
        TS_BIGINT_LITERAL => PartFlag::BigIntLiteral,
        TS_BOOLEAN_LITERAL => PartFlag::BooleanLiteral,
        TS_TEMPLATE_LITERAL => PartFlag::TemplateLiteral,
        _ => PartFlag::Other,
    }
}

/// Maps a TS type-flag label (raw `__typePartFlags` fact) to a [`PartFlag`].
fn flag_from_label(label: &str) -> PartFlag {
    match label {
        "any" => PartFlag::Any,
        "error" => PartFlag::Error,
        "never" => PartFlag::Never,
        "unknown" => PartFlag::Unknown,
        "bigint" => PartFlag::BigInt,
        "boolean" => PartFlag::Boolean,
        "number" => PartFlag::Number,
        "string" => PartFlag::String,
        "bigintLiteral" => PartFlag::BigIntLiteral,
        "booleanLiteral" => PartFlag::BooleanLiteral,
        "numberLiteral" => PartFlag::NumberLiteral,
        "stringLiteral" => PartFlag::StringLiteral,
        "templateLiteral" => PartFlag::TemplateLiteral,
        _ => PartFlag::Other,
    }
}

/// Skips wrapping `TSParenthesizedType` nodes.
fn skip_parens(mut node: &LintNode) -> &LintNode {
    while node.kind == "TSParenthesizedType" {
        let Some(inner) = node.child("typeAnnotation") else {
            break;
        };
        node = inner;
    }
    node
}

/// Returns the rendered literal text for a `TSLiteralType` node, matching the
/// Go `ToString` behaviour for AST literal nodes.
fn literal_type_text(node: &LintNode) -> (PartFlag, String) {
    let Some(literal) = node.child("literal") else {
        return (PartFlag::Other, "literal type".to_owned());
    };
    // Template literal types: ESTree models them as TSTemplateLiteralType, or a
    // TSLiteralType whose literal is a TemplateLiteral.
    if literal.kind == "TemplateLiteral" || literal.kind == "TSTemplateLiteralType" {
        return (
            PartFlag::TemplateLiteral,
            "template literal type".to_owned(),
        );
    }
    match literal.kind.as_str() {
        "Literal" => match literal.fields.get("value") {
            Some(Value::Bool(value)) => (PartFlag::BooleanLiteral, value.to_string()),
            Some(Value::Number(value)) => (PartFlag::NumberLiteral, value.to_string()),
            Some(Value::String(value)) => (
                PartFlag::StringLiteral,
                Value::String(value.clone()).to_string(),
            ),
            _ => {
                // bigint literals carry a `bigint` field in ESTree.
                if let Some(bigint) = literal.field_str("bigint") {
                    (PartFlag::BigIntLiteral, format!("{bigint}n"))
                } else if literal.field_bool("value") == Some(true) {
                    (PartFlag::BooleanLiteral, "true".to_owned())
                } else {
                    (PartFlag::Other, "literal type".to_owned())
                }
            }
        },
        // `true` / `false` keywords occasionally surface directly.
        "TSTrueKeyword" => (PartFlag::BooleanLiteral, "true".to_owned()),
        "TSFalseKeyword" => (PartFlag::BooleanLiteral, "false".to_owned()),
        _ => (PartFlag::Other, "literal type".to_owned()),
    }
}

/// Reads the raw `__typePartFlags` checker fact for nodes the AST cannot resolve
/// locally (type references, mapped/indexed types, ...). Each entry is the flag
/// label and rendered text of one resolved union member, plus (optionally) the
/// member's raw TypeScript 7 `flags`.
fn fact_type_parts(node: &LintNode) -> Option<Vec<TypePart>> {
    let array = node.fields.get("__typePartFlags")?.as_array()?;
    let mut parts = Vec::with_capacity(array.len());
    for entry in array {
        let label = entry
            .get("flag")
            .and_then(Value::as_str)
            .map(flag_from_label)
            .unwrap_or(PartFlag::Other);
        let raw_flags = entry
            .get("flags")
            .and_then(Value::as_u64)
            .and_then(|flags| u32::try_from(flags).ok());
        let flag = raw_flags.map_or(label, |flags| flag_from_raw(flags, label));
        let text = entry
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        parts.push(TypePart {
            flag,
            raw_flags,
            text,
        });
    }
    Some(parts)
}

/// Port of `getTypeNodeTypePartFlags`: returns the resolved type parts for a type
/// node, recursing into unions and consulting the checker fact when necessary.
fn type_node_part_flags(node: &LintNode) -> Vec<TypePart> {
    let node = skip_parens(node);

    if let Some(flag) = keyword_part_flag(node.kind.as_str()) {
        return vec![TypePart::syntactic(
            flag,
            keyword_text(node.kind.as_str()).to_owned(),
        )];
    }

    // Upstream reads only `TSLiteralType` nodes holding a plain `Literal` off
    // the AST; template literals ask the checker (`${string}` is `string`).
    let template = node.kind == "TSTemplateLiteralType"
        || (node.kind == "TSLiteralType"
            && node.child("literal").is_some_and(|literal| {
                literal.kind == "TemplateLiteral" || literal.kind == "TSTemplateLiteralType"
            }));
    if node.kind == "TSLiteralType" && !template {
        let (flag, text) = literal_type_text(node);
        if flag != PartFlag::Other {
            return vec![TypePart::syntactic(flag, text)];
        }
    }

    if node.kind == "TSUnionType" {
        let mut result = Vec::new();
        for sub in node.child_list("types").unwrap_or(&[]) {
            result.extend(type_node_part_flags(sub));
        }
        return result;
    }

    // Fall back to the checker-provided fact (type references and friends).
    if let Some(parts) = fact_type_parts(node) {
        return parts;
    }

    // Template literal types without a checker fact.
    if template {
        return vec![TypePart::syntactic(
            PartFlag::TemplateLiteral,
            "template literal type".to_owned(),
        )];
    }

    // No type info available: treat as an opaque non-redundant constituent.
    vec![TypePart::syntactic(
        PartFlag::Other,
        node.field_str("__typeText")
            .or_else(|| node.type_texts.first().map(String::as_str))
            .unwrap_or("")
            .to_owned(),
    )]
}

fn keyword_part_flag(kind: &str) -> Option<PartFlag> {
    match kind {
        "TSAnyKeyword" => Some(PartFlag::Any),
        "TSBigIntKeyword" => Some(PartFlag::BigInt),
        "TSBooleanKeyword" => Some(PartFlag::Boolean),
        "TSNeverKeyword" => Some(PartFlag::Never),
        "TSNumberKeyword" => Some(PartFlag::Number),
        "TSStringKeyword" => Some(PartFlag::String),
        "TSUnknownKeyword" => Some(PartFlag::Unknown),
        _ => None,
    }
}

/// Returns whether the union/intersection node sits in a function return type.
///
/// Upstream `isNodeInsideReturnType`: the parent is a `TSTypeAnnotation` whose
/// parent is a function or function type. With `__ancestorFacts` the host
/// supplies both levels; otherwise `__parentKind` alone is trusted to name the
/// function.
fn is_inside_return_type(node: &LintNode) -> bool {
    if let Some(ancestors) = ancestor_facts(node) {
        let kind_at = |depth| ancestor_fact(ancestors, depth).and_then(ancestor_kind);
        return kind_at(1) == Some("TSTypeAnnotation")
            && kind_at(2).is_some_and(is_function_or_function_type);
    }
    node.field_str("__parentKind").is_some_and(|kind| {
        // Hosts reporting the method wrapper in place of its function value.
        kind == "MethodDefinition" || is_function_or_function_type(kind)
    })
}

/// Reports bottom/top types for an intersection constituent. Returns whether a
/// diagnostic was emitted (so the caller skips literal/primitive bookkeeping).
fn check_intersection_bottom_top(
    ctx: &mut RuleContext<'_>,
    part: &TypePart,
    type_node: &LintNode,
) -> bool {
    let message_id = match part.flag {
        // "any" overrides; an error type (acts as any) gets its own message.
        PartFlag::Any | PartFlag::Never => "overrides",
        PartFlag::Error => "errorTypeOverrides",
        PartFlag::Unknown => "overridden",
        _ => return false,
    };
    report_part(ctx, message_id, part, "intersection", type_node);
    true
}

fn check_intersection(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let constituents = node.child_list("types").unwrap_or(&[]);

    let mut seen_bigint_literal: Vec<TypePart> = Vec::new();
    let mut seen_boolean_literal: Vec<TypePart> = Vec::new();
    let mut seen_number_literal: Vec<TypePart> = Vec::new();
    let mut seen_string_literal: Vec<TypePart> = Vec::new();

    let mut seen_bigint_primitive: Vec<&LintNode> = Vec::new();
    let mut seen_boolean_primitive: Vec<&LintNode> = Vec::new();
    let mut seen_number_primitive: Vec<&LintNode> = Vec::new();
    let mut seen_string_primitive: Vec<&LintNode> = Vec::new();

    let mut seen_unions: Vec<SeenUnion<'_>> = Vec::new();

    for type_node in constituents {
        let parts = type_node_part_flags(type_node);

        // 2+ parts on a single type node => it is definitely a union reference.
        if parts.len() >= 2 {
            seen_unions.push(SeenUnion {
                parts: parts.clone(),
                node: type_node,
            });
        }

        for part in &parts {
            if check_intersection_bottom_top(ctx, part, type_node) {
                continue;
            }

            if seen_unions.is_empty() {
                match part.flag {
                    PartFlag::BigIntLiteral => seen_bigint_literal.push(part.clone()),
                    PartFlag::BooleanLiteral => seen_boolean_literal.push(part.clone()),
                    PartFlag::NumberLiteral => seen_number_literal.push(part.clone()),
                    PartFlag::StringLiteral | PartFlag::TemplateLiteral => {
                        seen_string_literal.push(part.clone());
                    }
                    _ => {}
                }
            }

            match part.flag {
                PartFlag::BigInt => seen_bigint_primitive.push(type_node),
                PartFlag::Boolean => seen_boolean_primitive.push(type_node),
                PartFlag::Number => seen_number_primitive.push(type_node),
                PartFlag::String => seen_string_primitive.push(type_node),
                _ => {}
            }
        }
    }

    // Union member overridden by a primitive elsewhere in the intersection.
    if !seen_unions.is_empty()
        && (!seen_bigint_primitive.is_empty()
            || !seen_boolean_primitive.is_empty()
            || !seen_number_primitive.is_empty()
            || !seen_string_primitive.is_empty())
    {
        for union_type in &seen_unions {
            let mut primitive_matched = true;
            for value in &union_type.parts {
                let ok = match value.flag {
                    PartFlag::BigIntLiteral => !seen_bigint_primitive.is_empty(),
                    PartFlag::BooleanLiteral => !seen_boolean_primitive.is_empty(),
                    PartFlag::NumberLiteral => !seen_number_primitive.is_empty(),
                    PartFlag::StringLiteral | PartFlag::TemplateLiteral => {
                        !seen_string_primitive.is_empty()
                    }
                    _ => false,
                };
                if !ok {
                    primitive_matched = false;
                    break;
                }
            }
            let primitive = union_type
                .parts
                .last()
                .and_then(|part| literal_primitive_name(part.flag));
            if let (true, Some(primitive)) = (primitive_matched, primitive) {
                report_primitive_overridden(ctx, &union_type.parts, primitive, union_type.node);
            }
        }
    }

    if !seen_unions.is_empty() {
        return;
    }

    report_literals_override_primitive(ctx, &seen_bigint_literal, &seen_bigint_primitive, "bigint");
    report_literals_override_primitive(
        ctx,
        &seen_boolean_literal,
        &seen_boolean_primitive,
        "boolean",
    );
    report_literals_override_primitive(ctx, &seen_number_literal, &seen_number_primitive, "number");
    report_literals_override_primitive(ctx, &seen_string_literal, &seen_string_primitive, "string");
}

fn report_literals_override_primitive(
    ctx: &mut RuleContext<'_>,
    literal_types: &[TypePart],
    primitive_nodes: &[&LintNode],
    primitive: &str,
) {
    if literal_types.is_empty() {
        return;
    }
    for type_node in primitive_nodes {
        report_primitive_overridden(ctx, literal_types, primitive, type_node);
    }
}

/// `{{primitive}} is overridden by the {{literal}} in this intersection type.`
fn report_primitive_overridden(
    ctx: &mut RuleContext<'_>,
    literals: &[TypePart],
    primitive: &str,
    type_node: &LintNode,
) {
    let message = format!(
        "{primitive} is overridden by the {} in this intersection type.",
        join_texts(literals)
    );
    ctx.report_formatted("primitiveOverridden", message, type_node.range, Vec::new());
}

/// Reports a top/bottom constituent with upstream's message for `message_id`.
fn report_part(
    ctx: &mut RuleContext<'_>,
    message_id: &'static str,
    part: &TypePart,
    container: &str,
    type_node: &LintNode,
) {
    let name = &part.text;
    let message = match message_id {
        "errorTypeOverrides" => format!(
            "'{name}' is an 'error' type that acts as 'any' and overrides all other types in this {container} type."
        ),
        "overridden" => {
            format!("'{name}' is overridden by other types in this {container} type.")
        }
        _ => format!("'{name}' overrides all other types in this {container} type."),
    };
    ctx.report_formatted(message_id, message, type_node.range, Vec::new());
}

/// The primitive a literal flag widens to (`literalToPrimitiveTypeFlags`).
fn literal_primitive_name(flag: PartFlag) -> Option<&'static str> {
    match flag {
        PartFlag::BigIntLiteral => Some("bigint"),
        PartFlag::BooleanLiteral => Some("boolean"),
        PartFlag::NumberLiteral => Some("number"),
        PartFlag::StringLiteral | PartFlag::TemplateLiteral => Some("string"),
        _ => None,
    }
}

fn join_texts(parts: &[TypePart]) -> String {
    parts
        .iter()
        .map(|part| part.text.as_str())
        .collect::<Vec<_>>()
        .join(" | ")
}

/// Reports bottom/top types for a union constituent. Returns whether a
/// diagnostic was emitted.
fn check_union_bottom_top(
    ctx: &mut RuleContext<'_>,
    part: &TypePart,
    type_node: &LintNode,
    union_node: &LintNode,
) -> bool {
    let message_id = match part.flag {
        PartFlag::Any | PartFlag::Unknown => "overrides",
        PartFlag::Error => "errorTypeOverrides",
        // `never` in a function return type position is intentional.
        PartFlag::Never if !is_inside_return_type(union_node) => "overridden",
        _ => return false,
    };
    report_part(ctx, message_id, part, "union", type_node);
    true
}

fn check_union(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let constituents = node.child_list("types").unwrap_or(&[]);

    // Maps from the constituent's start offset to (node, overridden literals).
    let mut overridden_bigint: BTreeMap<u32, (&LintNode, Vec<TypePart>)> = BTreeMap::new();
    let mut overridden_boolean: BTreeMap<u32, (&LintNode, Vec<TypePart>)> = BTreeMap::new();
    let mut overridden_number: BTreeMap<u32, (&LintNode, Vec<TypePart>)> = BTreeMap::new();
    let mut overridden_string: BTreeMap<u32, (&LintNode, Vec<TypePart>)> = BTreeMap::new();

    let mut seen_bigint_primitive = false;
    let mut seen_boolean_primitive = false;
    let mut seen_number_primitive = false;
    let mut seen_string_primitive = false;

    for type_node in constituents {
        let parts = type_node_part_flags(type_node);

        for part in &parts {
            if check_union_bottom_top(ctx, part, type_node, node) {
                continue;
            }

            match part.flag {
                PartFlag::BigIntLiteral => overridden_bigint
                    .entry(type_node.range.start)
                    .or_insert_with(|| (type_node, Vec::new()))
                    .1
                    .push(part.clone()),
                PartFlag::BooleanLiteral => overridden_boolean
                    .entry(type_node.range.start)
                    .or_insert_with(|| (type_node, Vec::new()))
                    .1
                    .push(part.clone()),
                PartFlag::NumberLiteral => overridden_number
                    .entry(type_node.range.start)
                    .or_insert_with(|| (type_node, Vec::new()))
                    .1
                    .push(part.clone()),
                PartFlag::StringLiteral | PartFlag::TemplateLiteral => overridden_string
                    .entry(type_node.range.start)
                    .or_insert_with(|| (type_node, Vec::new()))
                    .1
                    .push(part.clone()),
                _ => {}
            }

            seen_bigint_primitive |= part.has_primitive_bit(PartFlag::BigInt);
            seen_boolean_primitive |= part.has_primitive_bit(PartFlag::Boolean);
            seen_number_primitive |= part.has_primitive_bit(PartFlag::Number);
            seen_string_primitive |= part.has_primitive_bit(PartFlag::String);
        }
    }

    report_overridden_literals(ctx, seen_bigint_primitive, &overridden_bigint, "bigint");
    report_overridden_literals(ctx, seen_boolean_primitive, &overridden_boolean, "boolean");
    report_overridden_literals(ctx, seen_number_primitive, &overridden_number, "number");
    report_overridden_literals(ctx, seen_string_primitive, &overridden_string, "string");
}

/// `{{literal}} is overridden by {{primitive}} in this union type.`
fn report_overridden_literals(
    ctx: &mut RuleContext<'_>,
    seen_primitive: bool,
    overridden: &BTreeMap<u32, (&LintNode, Vec<TypePart>)>,
    primitive: &str,
) {
    if !seen_primitive {
        return;
    }
    for (type_node, literals) in overridden.values() {
        let message = format!(
            "{} is overridden by {primitive} in this union type.",
            join_texts(literals)
        );
        ctx.report_formatted("literalOverridden", message, type_node.range, Vec::new());
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintNode, RuleContext, RustLintRule};
    use super::NoRedundantTypeConstituentsRule;

    fn run(node: &LintNode) -> Vec<(String, (u32, u32))> {
        let rule = NoRedundantTypeConstituentsRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
            .into_iter()
            .map(|d| (d.message_id, (d.range.start, d.range.end)))
            .collect()
    }

    fn keyword(kind: &str, start: u32, end: u32) -> serde_json::Value {
        json!({ "kind": kind, "range": { "start": start, "end": end } })
    }

    fn number_literal(value: i64, start: u32, end: u32) -> serde_json::Value {
        json!({
            "kind": "TSLiteralType",
            "range": { "start": start, "end": end },
            "children": { "literal": { "kind": "Literal", "range": { "start": start, "end": end }, "fields": { "value": value } } }
        })
    }

    fn string_literal(value: &str, start: u32, end: u32) -> serde_json::Value {
        json!({
            "kind": "TSLiteralType",
            "range": { "start": start, "end": end },
            "children": { "literal": { "kind": "Literal", "range": { "start": start, "end": end }, "fields": { "value": value } } }
        })
    }

    // type T = number | any;  -> "overrides" on `any`.
    #[test]
    fn union_any_overrides() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 22 },
            "childLists": { "types": [
                keyword("TSNumberKeyword", 9, 15),
                keyword("TSAnyKeyword", 18, 21)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("overrides".to_owned(), (18, 21))]);
    }

    // type T = number | never; -> "overridden" on `never`.
    #[test]
    fn union_never_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 24 },
            "childLists": { "types": [
                keyword("TSNumberKeyword", 9, 15),
                keyword("TSNeverKeyword", 18, 23)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("overridden".to_owned(), (18, 23))]);
    }

    // type T = number | 0; -> "literalOverridden" on the literal `0`.
    #[test]
    fn union_literal_overridden_by_primitive() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 20 },
            "childLists": { "types": [
                keyword("TSNumberKeyword", 9, 15),
                number_literal(0, 18, 19)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("literalOverridden".to_owned(), (18, 19))]);
    }

    // type T = '' & string; -> "primitiveOverridden" on `string`.
    #[test]
    fn intersection_primitive_overridden_by_literal() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 21 },
            "childLists": { "types": [
                string_literal("", 9, 11),
                keyword("TSStringKeyword", 14, 20)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("primitiveOverridden".to_owned(), (14, 20))]);
    }

    // type T = number & unknown; -> "overridden" on `unknown`.
    #[test]
    fn intersection_unknown_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 26 },
            "childLists": { "types": [
                keyword("TSNumberKeyword", 9, 15),
                keyword("TSUnknownKeyword", 18, 25)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("overridden".to_owned(), (18, 25))]);
    }

    // Should NOT report: type T = number | null;
    #[test]
    fn union_number_null_ok() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 22 },
            "childLists": { "types": [
                keyword("TSNumberKeyword", 9, 15),
                keyword("TSNullKeyword", 18, 22)
            ] }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    // Should NOT report: type T = 'a' | 'b';
    #[test]
    fn union_distinct_string_literals_ok() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 18 },
            "childLists": { "types": [
                string_literal("a", 9, 12),
                string_literal("b", 15, 18)
            ] }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    // Should NOT report: type T = () => string | never;  (never in return type)
    #[test]
    fn union_never_in_return_type_ok() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 15, "end": 29 },
            "fields": { "__parentKind": "TSFunctionType" },
            "childLists": { "types": [
                keyword("TSStringKeyword", 15, 21),
                keyword("TSNeverKeyword", 24, 29)
            ] }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    // type T = B | string; where B resolves (via checker fact) to "b" literal.
    #[test]
    fn union_reference_literal_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 20 },
            "childLists": { "types": [
                {
                    "kind": "TSTypeReference",
                    "range": { "start": 9, "end": 10 },
                    "fields": { "__typePartFlags": [ { "flag": "stringLiteral", "text": "\"b\"" } ] }
                },
                keyword("TSStringKeyword", 13, 19)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("literalOverridden".to_owned(), (9, 10))]);
    }

    // type U = T & string; where T resolves to a union 'a'|'b' (>=2 parts).
    #[test]
    fn intersection_union_reference_primitive_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 20 },
            "childLists": { "types": [
                {
                    "kind": "TSTypeReference",
                    "range": { "start": 9, "end": 10 },
                    "fields": { "__typePartFlags": [
                        { "flag": "stringLiteral", "text": "\"a\"" },
                        { "flag": "stringLiteral", "text": "\"b\"" }
                    ] }
                },
                keyword("TSStringKeyword", 13, 19)
            ] }
        }))
        .unwrap();
        let out = run(&node);
        assert_eq!(out, vec![("primitiveOverridden".to_owned(), (9, 10))]);
    }

    fn reference(start: u32, end: u32, parts: serde_json::Value) -> serde_json::Value {
        json!({
            "kind": "TSTypeReference",
            "range": { "start": start, "end": end },
            "fields": { "__typePartFlags": parts }
        })
    }

    // `function _(): string | never` with TS-ESTree ancestors: the union's
    // parent is the return `TSTypeAnnotation`, whose parent is the function.
    #[test]
    fn union_never_in_return_type_annotation_ok() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 14, "end": 28 },
            "fields": {
                "__parentKind": "TSTypeAnnotation",
                "__ancestorFacts": [
                    { "kind": "Program" },
                    { "kind": "FunctionDeclaration", "keyInParent": "body" },
                    { "kind": "TSTypeAnnotation", "keyInParent": "returnType" }
                ]
            },
            "childLists": { "types": [
                keyword("TSStringKeyword", 14, 20),
                keyword("TSNeverKeyword", 23, 28)
            ] }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    // `(x: string | never) => x`: a parameter annotation is not a return type.
    #[test]
    fn union_never_in_parameter_annotation_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 4, "end": 18 },
            "fields": {
                "__ancestorFacts": [
                    { "kind": "Program" },
                    { "kind": "ArrowFunctionExpression" },
                    { "kind": "Identifier", "keyInParent": "params" },
                    { "kind": "TSTypeAnnotation", "keyInParent": "typeAnnotation" }
                ]
            },
            "childLists": { "types": [
                keyword("TSStringKeyword", 4, 10),
                keyword("TSNeverKeyword", 13, 18)
            ] }
        }))
        .unwrap();
        assert_eq!(run(&node), vec![("overridden".to_owned(), (13, 18))]);
    }

    // `type T = 'a' | ('b' & 'c');` the intersection resolves to `never`.
    #[test]
    fn union_member_resolving_to_never_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 26 },
            "childLists": { "types": [
                string_literal("a", 9, 12),
                {
                    "kind": "TSIntersectionType",
                    "range": { "start": 16, "end": 25 },
                    "fields": { "__typePartFlags": [ { "flag": "never", "flags": 262144, "text": "never" } ] }
                }
            ] }
        }))
        .unwrap();
        assert_eq!(run(&node), vec![("overridden".to_owned(), (16, 25))]);
    }

    // `type B = boolean; type T = B | false;` the alias is `Boolean | Union`,
    // which the union check matches by bit.
    #[test]
    fn union_boolean_alias_overrides_false() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 18 },
            "childLists": { "types": [
                reference(9, 10, json!([ { "flag": "boolean", "flags": (1 << 8) | (1 << 27), "text": "boolean" } ])),
                {
                    "kind": "TSLiteralType",
                    "range": { "start": 13, "end": 18 },
                    "children": { "literal": { "kind": "Literal", "range": { "start": 13, "end": 18 }, "fields": { "value": false } } }
                }
            ] }
        }))
        .unwrap();
        assert_eq!(run(&node), vec![("literalOverridden".to_owned(), (13, 18))]);
    }

    // `type B = boolean; type T = B & true;` intersections compare flags
    // exactly, so the `Boolean | Union` alias is not the `boolean` primitive.
    #[test]
    fn intersection_boolean_alias_is_not_primitive() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 17 },
            "childLists": { "types": [
                reference(9, 10, json!([ { "flag": "boolean", "flags": (1 << 8) | (1 << 27), "text": "boolean" } ])),
                {
                    "kind": "TSLiteralType",
                    "range": { "start": 13, "end": 17 },
                    "children": { "literal": { "kind": "Literal", "range": { "start": 13, "end": 17 }, "fields": { "value": true } } }
                }
            ] }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    // An enum member literal (`NumberLiteral | EnumLiteral`) is not a plain
    // number literal, so `number` does not override it.
    #[test]
    fn union_enum_literal_not_overridden() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 26 },
            "childLists": { "types": [
                reference(9, 17, json!([ { "flag": "numberLiteral", "flags": (1 << 11) | (1 << 15), "text": "E.A" } ])),
                keyword("TSNumberKeyword", 20, 26)
            ] }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    // `type T = Missing | number;` an unresolved name is an `error` type.
    #[test]
    fn union_error_type_overrides() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 25 },
            "childLists": { "types": [
                reference(9, 16, json!([ { "flag": "error", "flags": 1, "text": "Missing" } ])),
                keyword("TSNumberKeyword", 19, 25)
            ] }
        }))
        .unwrap();
        assert_eq!(run(&node), vec![("errorTypeOverrides".to_owned(), (9, 16))]);
    }

    // `` type T = `${string}` & 'a'; `` the checker resolves the template
    // literal type to `string`, so it is the overridden primitive.
    #[test]
    fn intersection_template_literal_uses_checker_flags() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 27 },
            "childLists": { "types": [
                {
                    "kind": "TSTemplateLiteralType",
                    "range": { "start": 9, "end": 21 },
                    "fields": { "__typePartFlags": [ { "flag": "string", "flags": 32, "text": "string" } ] }
                },
                string_literal("a", 24, 27)
            ] }
        }))
        .unwrap();
        assert_eq!(
            run(&node),
            vec![("primitiveOverridden".to_owned(), (9, 21))]
        );
    }

    fn messages(node: &LintNode) -> Vec<String> {
        let rule = NoRedundantTypeConstituentsRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish().into_iter().map(|d| d.message).collect()
    }

    // Messages name the constituents the way upstream does.
    #[test]
    fn messages_name_the_redundant_types() {
        let union: LintNode = serde_json::from_value(json!({
            "kind": "TSUnionType",
            "range": { "start": 9, "end": 37 },
            "childLists": { "types": [
                string_literal("a", 9, 12),
                reference(15, 16, json!([
                    { "flag": "numberLiteral", "flags": 1 << 11, "text": "1" },
                    { "flag": "numberLiteral", "flags": 1 << 11, "text": "2" }
                ])),
                keyword("TSNumberKeyword", 19, 25),
                keyword("TSStringKeyword", 28, 34),
                keyword("TSUnknownKeyword", 37, 44)
            ] }
        }))
        .unwrap();
        assert_eq!(
            messages(&union),
            vec![
                "'unknown' overrides all other types in this union type.",
                "1 | 2 is overridden by number in this union type.",
                "\"a\" is overridden by string in this union type.",
            ]
        );

        let intersection: LintNode = serde_json::from_value(json!({
            "kind": "TSIntersectionType",
            "range": { "start": 9, "end": 21 },
            "childLists": { "types": [
                string_literal("a", 9, 12),
                keyword("TSStringKeyword", 15, 21)
            ] }
        }))
        .unwrap();
        assert_eq!(
            messages(&intersection),
            vec!["string is overridden by the \"a\" in this intersection type."]
        );
    }
}
