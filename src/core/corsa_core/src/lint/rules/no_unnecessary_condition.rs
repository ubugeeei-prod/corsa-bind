use super::super::type_shape::{StaticValue, TypeShape};
use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule, TextRange};
use crate::utils::split_type_text;

use super::super::helpers::rule_option_bool;

mod checked;
mod compare;

use checked::{Settings, Truthiness};

/// Type-aware rule that flags conditions that are always truthy, always falsy,
/// `never`, always nullish, unnecessary optional chains, and comparisons whose
/// result is fixed.
///
/// Port of typescript-eslint `no-unnecessary-condition`. When the host stamps
/// a `__typeShape` fact (constrained type flags, literal values, union parts)
/// the verdicts follow the upstream `TypeFlags` logic exactly; otherwise the
/// rule falls back to rendered type texts for the truthiness and literal
/// comparison checks.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnnecessaryConditionRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "alwaysTruthy",
        description: "Unnecessary conditional, value is always truthy.",
    },
    RuleMessage {
        id: "alwaysFalsy",
        description: "Unnecessary conditional, value is always falsy.",
    },
    RuleMessage {
        id: "never",
        description: "Unnecessary conditional, value is `never`.",
    },
    RuleMessage {
        id: "alwaysTruthyFunc",
        description: "This callback should return a conditional, but return is always truthy.",
    },
    RuleMessage {
        id: "alwaysFalsyFunc",
        description: "This callback should return a conditional, but return is always falsy.",
    },
    RuleMessage {
        id: "neverNullish",
        description: "Unnecessary conditional, expected left-hand side of `??` operator to be possibly null or undefined.",
    },
    RuleMessage {
        id: "neverOptionalChain",
        description: "Unnecessary optional chain on a non-nullish value.",
    },
    RuleMessage {
        id: "noStrictNullCheck",
        description: "This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.",
    },
    RuleMessage {
        id: "comparisonBetweenLiteralTypes",
        description: "Unnecessary conditional, comparison is always {{trueOrFalse}}, since `{{left}} {{operator}} {{right}}` is {{trueOrFalse}}.",
    },
    RuleMessage {
        id: "noOverlapBooleanExpression",
        description: "Unnecessary conditional, the types have no overlap.",
    },
    RuleMessage {
        id: "alwaysNullish",
        description: "Unnecessary conditional, left-hand side of `??` operator is always `null` or `undefined`.",
    },
    RuleMessage {
        id: "typeGuardAlreadyIsType",
        description: "Unnecessary conditional, expression already has the type being checked by the {{typeGuardOrAssertionFunction}}.",
    },
];

const LISTENERS: &[&str] = &[
    "IfStatement",
    "WhileStatement",
    "DoWhileStatement",
    "ForStatement",
    "ConditionalExpression",
    "LogicalExpression",
    "AssignmentExpression",
    "BinaryExpression",
    "SwitchStatement",
    "MemberExpression",
    "CallExpression",
];

/// `ARRAY_PREDICATE_FUNCTIONS` from `isArrayMethodCallWithPredicate`.
const ARRAY_PREDICATE_FUNCTIONS: &[&str] = &[
    "every",
    "filter",
    "find",
    "findIndex",
    "findLast",
    "findLastIndex",
    "some",
];

impl RustLintRule for NoUnnecessaryConditionRule {
    fn name(&self) -> &'static str {
        "no-unnecessary-condition"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow conditions that are always truthy, always falsy, never, or always nullish."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        let settings = Settings::of(node);
        match node.kind.as_str() {
            "IfStatement" | "ConditionalExpression" => {
                check_node(ctx, node.child("test"), false, true, settings);
            }
            "WhileStatement" | "DoWhileStatement" | "ForStatement" => {
                check_loop(ctx, node, node.child("test"), settings);
            }
            "LogicalExpression" => match node.field_str("operator") {
                Some("??") => check_node_for_nullish(ctx, node.child("left"), settings),
                Some(operator) => {
                    // The left operand is only used for truthiness when this is
                    // `&&`, or when the whole expression is.
                    let truthiness = operator == "&&" || is_only_used_for_truthiness(node);
                    check_node(ctx, node.child("left"), false, truthiness, settings);
                }
                None => {}
            },
            "AssignmentExpression" => match node.field_str("operator") {
                Some("&&=") | Some("||=") => {
                    check_node(ctx, node.child("left"), false, false, settings);
                }
                Some("??=") => check_node_for_nullish(ctx, node.child("left"), settings),
                _ => {}
            },
            "BinaryExpression" => {
                if let Some(operator) = node.field_str("operator").filter(|operator| {
                    matches!(
                        *operator,
                        "<" | ">" | "<=" | ">=" | "==" | "===" | "!=" | "!=="
                    )
                }) {
                    check_comparison(ctx, node, node.child("left"), node.child("right"), operator);
                }
            }
            "SwitchStatement" => {
                // Each `case` clause is equivalent to `discriminant === test`.
                let Some(discriminant) = node.child("discriminant") else {
                    return;
                };
                for case in node.child_list("cases").unwrap_or(&[]) {
                    if let Some(test) = case.child("test") {
                        check_comparison(ctx, test, Some(discriminant), Some(test), "===");
                    }
                }
            }
            "MemberExpression" => {
                check_optional_chain(ctx, node, node.child("object"), settings);
            }
            "CallExpression" => {
                if rule_option_bool(node, "checkTypePredicates") == Some(true) {
                    check_type_predicate(ctx, node, settings);
                }
                check_optional_chain(ctx, node, node.child("callee"), settings);
                check_array_predicate(ctx, node, settings);
            }
            _ => {}
        }
    }
}

/// Upstream `isOnlyUsedForTruthiness`, evaluated over the host's
/// `__ancestorChain` (closest ancestor first). Without the chain the rule
/// assumes the value is used, which reports less.
fn is_only_used_for_truthiness(node: &LintNode) -> bool {
    let Some(chain) = node
        .fields
        .get("__ancestorChain")
        .and_then(serde_json::Value::as_array)
    else {
        return false;
    };
    let flag = |entry: &serde_json::Value, key: &str| {
        entry.get(key).and_then(serde_json::Value::as_bool) == Some(true)
    };
    for entry in chain {
        let kind = entry
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("");
        let operator = entry.get("operator").and_then(serde_json::Value::as_str);
        match kind {
            "ConditionalExpression"
            | "DoWhileStatement"
            | "ForStatement"
            | "IfStatement"
            | "WhileStatement" => return flag(entry, "childIsTest"),
            "LogicalExpression" => {
                if operator == Some("&&") && flag(entry, "childIsLeft") {
                    return true;
                }
            }
            "UnaryExpression" => return operator == Some("!"),
            _ => return false,
        }
    }
    false
}

/// Mirrors the upstream loop-condition handling, honouring
/// `allowConstantLoopConditions` (default `"never"`).
fn check_loop(
    ctx: &mut RuleContext<'_>,
    owner: &LintNode,
    test: Option<&LintNode>,
    settings: Settings,
) {
    let Some(test) = test else { return };
    let mode = allow_constant_loop_conditions(owner);
    if mode == "only-allowed-literals" && is_allowed_constant_literal(test) {
        return;
    }
    if mode == "always" {
        let true_literal = match TypeShape::of(test) {
            Some(shape) => shape.static_value() == Some(StaticValue::Boolean(true)),
            None => is_true_keyword(test) || is_true_literal_type(&test.type_texts),
        };
        if true_literal {
            return;
        }
    }
    check_node(ctx, Some(test), false, true, settings);
}

/// Port of upstream `checkNode`. `used_for_truthiness` is
/// `isOnlyUsedForTruthiness(expression)`, which decides whether the right
/// operand of a nested `&&`/`||` is checked.
fn check_node(
    ctx: &mut RuleContext<'_>,
    expression: Option<&LintNode>,
    is_unary_not_argument: bool,
    used_for_truthiness: bool,
    settings: Settings,
) {
    let Some(expression) = expression else { return };
    check_node_reporting(
        ctx,
        expression,
        is_unary_not_argument,
        used_for_truthiness,
        settings,
        expression.range,
    );
}

fn check_node_reporting(
    ctx: &mut RuleContext<'_>,
    expression: &LintNode,
    is_unary_not_argument: bool,
    used_for_truthiness: bool,
    settings: Settings,
    report: TextRange,
) {
    // `!expr` flips the meaning; descend into the operand but keep reporting
    // the outer node.
    if expression.kind == "UnaryExpression" && expression.field_str("operator") == Some("!") {
        if let Some(argument) = expression.child("argument") {
            check_node_reporting(
                ctx,
                argument,
                !is_unary_not_argument,
                true,
                settings,
                report,
            );
        }
        return;
    }

    // Array index signatures do not model out-of-bounds reads.
    if !settings.no_unchecked_indexed_access
        && checked::is_array_index_expression(expression, settings)
    {
        return;
    }

    // `a && b` / `a || b`: the left side is checked by its own listener; the
    // right side only matters when the whole expression is a truthiness test.
    if expression.kind == "LogicalExpression" && expression.field_str("operator") != Some("??") {
        if used_for_truthiness {
            if let Some(right) = expression.child("right") {
                check_node_reporting(ctx, right, false, true, settings, right.range);
            }
        }
        return;
    }

    let verdict = match checked::truthiness(expression) {
        Some(verdict) => verdict,
        None => text_truthiness(expression),
    };
    let message = match verdict {
        Some(Truthiness::Never) => "never",
        Some(Truthiness::Falsy) if is_unary_not_argument => "alwaysTruthy",
        Some(Truthiness::Falsy) => "alwaysFalsy",
        Some(Truthiness::Truthy) if is_unary_not_argument => "alwaysFalsy",
        Some(Truthiness::Truthy) => "alwaysTruthy",
        None => return,
    };
    ctx.report(message, report);
}

/// Rendered-type-text fallback for hosts without `__typeShape`.
fn text_truthiness(expression: &LintNode) -> Option<Truthiness> {
    let type_texts = &expression.type_texts;
    if type_texts.is_empty() || is_conditional_always_necessary(type_texts) {
        return None;
    }
    if is_never_type(type_texts) {
        return Some(Truthiness::Never);
    }
    // The host may render the same type more than once (the narrowed literal
    // plus its widened base). Each text describes the SAME type, so the first
    // rendering that yields a definite verdict wins.
    let (is_truthy, is_falsy) = type_texts
        .iter()
        .map(|text| check_type_condition(std::slice::from_ref(text)))
        .find(|(truthy, falsy)| *truthy || *falsy)
        .unwrap_or((false, false));
    if is_falsy {
        Some(Truthiness::Falsy)
    } else if is_truthy {
        Some(Truthiness::Truthy)
    } else {
        None
    }
}

/// Port of upstream `checkNodeForNullish` (the `??` / `??=` path).
fn check_node_for_nullish(ctx: &mut RuleContext<'_>, node: Option<&LintNode>, settings: Settings) {
    let Some(node) = node else { return };
    let message = match checked::nullish(node, settings) {
        Some(message) => message,
        None => text_nullish(node),
    };
    if let Some(message) = message {
        ctx.report(message, node.range);
    }
}

fn text_nullish(node: &LintNode) -> Option<&'static str> {
    let type_texts = &node.type_texts;
    if type_texts.is_empty() || is_conditional_always_necessary(type_texts) {
        return None;
    }
    if is_never_type(type_texts) {
        return Some("never");
    }
    if is_always_nullish_type(type_texts) {
        return Some("alwaysNullish");
    }
    if !is_nullish_type(type_texts) {
        return Some("neverNullish");
    }
    None
}

/// Port of upstream `checkIfBoolExpressionIsNecessaryConditional`.
fn check_comparison(
    ctx: &mut RuleContext<'_>,
    report: &LintNode,
    left: Option<&LintNode>,
    right: Option<&LintNode>,
    operator: &str,
) {
    let (Some(left), Some(right)) = (left, right) else {
        return;
    };
    if let (Some(left_shape), Some(right_shape)) = (TypeShape::of(left), TypeShape::of(right)) {
        if let (Some(left_value), Some(right_value)) =
            (left_shape.static_value(), right_shape.static_value())
        {
            let Some(result) = compare::evaluate(&left_value, operator, &right_value) else {
                return;
            };
            let outcome = if result { "true" } else { "false" };
            let message = [
                "Unnecessary conditional, comparison is always ",
                outcome,
                ", since `",
                &static_text(left, left_shape, &left_value),
                " ",
                operator,
                " ",
                &static_text(right, right_shape, &right_value),
                "` is ",
                outcome,
                ".",
            ]
            .concat();
            ctx.report_with_message("comparisonBetweenLiteralTypes", message, report.range);
            return;
        }
        if report.field_bool("__strictNullChecks") != Some(false)
            && checked::has_no_overlap(left, right, operator) == Some(true)
        {
            ctx.report("noOverlapBooleanExpression", report.range);
        }
        return;
    }
    if left.type_texts.is_empty() || right.type_texts.is_empty() {
        return;
    }
    if is_static_value(&left.type_texts) && is_static_value(&right.type_texts) {
        // Hosts without checker type shapes: read the literal values from the
        // type texts so the message's placeholders are still filled in.
        let left_text = &type_parts(&left.type_texts)[0];
        let right_text = &type_parts(&right.type_texts)[0];
        let outcome = parse_static_atom(left_text)
            .zip(parse_static_atom(right_text))
            .and_then(|(left_value, right_value)| {
                compare::evaluate(&left_value, operator, &right_value)
            });
        let Some(outcome) = outcome else {
            return;
        };
        ctx.report_with_data(
            "comparisonBetweenLiteralTypes",
            report.range,
            &[
                ("trueOrFalse", if outcome { "true" } else { "false" }),
                ("left", left_text),
                ("operator", operator),
                ("right", right_text),
            ],
        );
    }
}

/// The literal value a static type-text atom (see [`is_static_atom`]) names.
fn parse_static_atom(part: &str) -> Option<StaticValue> {
    match part {
        "true" => return Some(StaticValue::Boolean(true)),
        "false" => return Some(StaticValue::Boolean(false)),
        "null" => return Some(StaticValue::Null),
        "undefined" => return Some(StaticValue::Undefined),
        _ => {}
    }
    if is_string_literal_atom(part) {
        if part.starts_with('"') {
            if let Ok(serde_json::Value::String(text)) = serde_json::from_str(part) {
                return Some(StaticValue::String(text));
            }
        }
        return Some(StaticValue::String(part[1..part.len() - 1].to_owned()));
    }
    if is_bigint_literal_atom(part) {
        let digits = part[..part.len() - 1].parse::<i128>().ok()?;
        return Some(StaticValue::BigInt(digits.to_string()));
    }
    part.parse::<f64>().ok().map(StaticValue::Number)
}

/// `checker.typeToString` of a literal type: the host's rendering when it
/// describes the same (unconstrained) type, else the value itself.
fn static_text(
    node: &LintNode,
    shape: TypeShape<'_>,
    value: &super::super::type_shape::StaticValue,
) -> String {
    match node.type_texts.first() {
        Some(text) if shape.raw_flags() == shape.flags() && !text.contains('|') => text.clone(),
        _ => compare::render(value),
    }
}

/// The `checkTypePredicates` branch of upstream `checkCallExpression`, over
/// the host's `predicate` entry in the call's `__typeShape`:
/// `asserts x` checks `x` like a condition, and `x is T` / `asserts x is T`
/// reports an argument whose type already satisfies the predicate.
fn check_type_predicate(ctx: &mut RuleContext<'_>, node: &LintNode, settings: Settings) {
    let Some(fact) = node
        .fields
        .get("__typeShape")
        .and_then(|shape| shape.get("predicate"))
    else {
        return;
    };
    let Some(index) = fact
        .get("argument")
        .and_then(serde_json::Value::as_u64)
        .and_then(|index| usize::try_from(index).ok())
    else {
        return;
    };
    let Some(argument) = node
        .child_list("arguments")
        .and_then(|arguments| arguments.get(index))
    else {
        return;
    };
    let flag = |key: &str| fact.get(key).and_then(serde_json::Value::as_bool) == Some(true);
    if let Some(shape) = fact.get("shape") {
        // `findTruthinessAssertedArgument`: the asserted argument is a
        // condition whose value is used (its parent is the call).
        let mut asserted = argument.clone();
        asserted
            .fields
            .insert("__typeShape".to_owned(), shape.clone());
        check_node(ctx, Some(&asserted), false, false, settings);
        return;
    }
    let argument_flags = fact
        .get("argumentFlags")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let any_or_unknown =
        u64::from(super::super::type_shape::flags::ANY | super::super::type_shape::flags::UNKNOWN);
    if argument_flags & any_or_unknown == 0
        && flag("assignable")
        && (flag("reverseAssignable") || flag("predicateIsUnion"))
    {
        let kind = if flag("asserts") {
            "assertion function"
        } else {
            "type guard"
        };
        let message = [
            "Unnecessary conditional, expression already has the type being checked by the ",
            kind,
            ".",
        ]
        .concat();
        ctx.report_with_message("typeGuardAlreadyIsType", message, argument.range);
    }
}

/// Port of upstream `checkOptionalChain` for `MemberExpression[optional]` and
/// `CallExpression[optional]`.
fn check_optional_chain(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    before: Option<&LintNode>,
    settings: Settings,
) {
    if node.field_bool("optional") != Some(true) {
        return;
    }
    let Some(before) = before else { return };
    if !settings.no_unchecked_indexed_access
        && checked::option_chain_contains_option_array_index(node, settings)
    {
        return;
    }
    // Without a shape there is no checker verdict; stay silent.
    if checked::is_optionable_expression(before, settings) != Some(false) {
        return;
    }
    let Some(range) = question_dot_range(node, before) else {
        return;
    };
    ctx.report("neverOptionalChain", range);
}

/// The `?.` token after `before`, located in the node's source text.
fn question_dot_range(node: &LintNode, before: &LintNode) -> Option<TextRange> {
    let text = node.text.as_deref()?;
    let offset = before.range.end.checked_sub(node.range.start)? as usize;
    let tail = text.get(offset..)?;
    let mut index = 0;
    let bytes = tail.as_bytes();
    // Skip whitespace, comments and closing parentheses between the operand
    // and the `?.` token.
    while index < bytes.len() {
        match bytes.get(index..index + 2) {
            Some(b"?.") => {
                let start = before.range.end + index as u32;
                return Some(TextRange::new(start, start + 2));
            }
            Some(b"//") => {
                index += tail.get(index..)?.find('\n')?;
            }
            Some(b"/*") => {
                index += tail.get(index..)?.find("*/")? + 2;
            }
            _ => index += 1,
        }
    }
    None
}

/// Port of the array-predicate branch of upstream `checkCallExpression`:
/// `arr.filter(x => /* condition */)`.
fn check_array_predicate(ctx: &mut RuleContext<'_>, node: &LintNode, settings: Settings) {
    let Some(callee) = node.child("callee") else {
        return;
    };
    if callee.kind != "MemberExpression" {
        return;
    }
    let Some(name) = static_member_name(callee) else {
        return;
    };
    if !ARRAY_PREDICATE_FUNCTIONS.contains(&name.as_str()) {
        return;
    }
    if !callee
        .child("object")
        .is_some_and(checked::is_array_or_tuple)
    {
        return;
    }
    let Some(callback) = node.child_list("arguments").and_then(<[LintNode]>::first) else {
        return;
    };
    if matches!(
        callback.kind.as_str(),
        "ArrowFunctionExpression" | "FunctionExpression"
    ) {
        if let Some(body) = callback.child("body") {
            if body.kind != "BlockStatement" {
                check_node(ctx, Some(body), false, false, settings);
                return;
            }
            let statements = body.child_list("body").unwrap_or(&[]);
            if let [statement] = statements {
                if statement.kind == "ReturnStatement" {
                    if let Some(argument) = statement.child("argument") {
                        check_node(ctx, Some(argument), false, false, settings);
                        return;
                    }
                }
            }
        }
    }
    let Some((truthy, falsy)) = checked::callback_returns(callback) else {
        return;
    };
    if !falsy {
        ctx.report("alwaysTruthyFunc", callback.range);
    } else if !truthy {
        ctx.report("alwaysFalsyFunc", callback.range);
    }
}

/// `getStaticMemberAccessValue` for identifiers and string literals.
fn static_member_name(member: &LintNode) -> Option<String> {
    let property = member.child("property")?;
    if member.field_bool("computed") == Some(true) {
        return property.field_str("value").map(str::to_owned);
    }
    property.field_str("name").map(str::to_owned)
}

// ---------------------------------------------------------------------------
// Type-text predicates (ports of the upstream checker.Type_flags helpers).
// ---------------------------------------------------------------------------

/// Splits each rendered type text into its top-level union/intersection parts.
fn type_parts(type_texts: &[String]) -> Vec<String> {
    let mut parts = Vec::new();
    for text in type_texts {
        for part in split_type_text(text) {
            let trimmed = part.trim().trim_start_matches("readonly ").trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_owned());
            }
        }
    }
    parts
}

/// Port of upstream `isConditionalAlwaysNecessary`: `any`, `unknown`, or a
/// type variable means the truthiness cannot be determined statically.
fn is_conditional_always_necessary(type_texts: &[String]) -> bool {
    type_parts(type_texts)
        .iter()
        .any(|part| is_indeterminate_atom(part))
}

/// Port of upstream `isIndeterminateType`: `any`, `unknown`, type parameters,
/// and `keyof T` index types cannot be statically resolved. We treat a single
/// capitalised identifier (with no recognised primitive meaning) as a possible
/// type parameter, mirroring the conservative upstream behaviour.
fn is_indeterminate_atom(part: &str) -> bool {
    let part = part.trim();
    if part == "any" || part == "unknown" {
        return true;
    }
    if part.starts_with("keyof ") {
        return true;
    }
    // A bare single-letter uppercase identifier (T, K, U ...) is most likely a
    // type parameter whose constraint we cannot see from the rendered text.
    let is_bare_ident = !part.is_empty()
        && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && part.chars().next().is_some_and(|c| c.is_ascii_uppercase());
    is_bare_ident && part.len() <= 2 && !is_known_object_like_atom(part)
}

fn is_never_type(type_texts: &[String]) -> bool {
    // `never` collapses a union to nothing; if any rendered text is exactly
    // `never`, or every part is `never`, treat it as `never`.
    let parts = type_parts(type_texts);
    if parts.is_empty() {
        return false;
    }
    parts.iter().all(|part| part == "never")
}

/// Port of upstream `isAlwaysNullishType`: the type can only be nullish.
fn is_always_nullish_type(type_texts: &[String]) -> bool {
    let parts = type_parts(type_texts);
    if parts.is_empty() {
        return false;
    }
    parts
        .iter()
        .all(|part| matches!(part.as_str(), "null" | "undefined" | "void"))
}

/// Port of upstream `isNullishType`: any union member can be nullish.
fn is_nullish_type(type_texts: &[String]) -> bool {
    type_parts(type_texts)
        .iter()
        .any(|part| matches!(part.as_str(), "null" | "undefined" | "void"))
}

/// Port of upstream `toStaticValue`: the type has a single static value
/// (boolean/string/number/bigint literal, or `null`/`undefined`).
fn is_static_value(type_texts: &[String]) -> bool {
    let parts = type_parts(type_texts);
    parts.len() == 1 && is_static_atom(&parts[0])
}

fn is_static_atom(part: &str) -> bool {
    matches!(part, "true" | "false" | "null" | "undefined")
        || is_string_literal_atom(part)
        || is_number_literal_atom(part)
        || is_bigint_literal_atom(part)
}

/// Port of upstream `checkTypeCondition`: returns `(is_truthy, is_falsy)`.
fn check_type_condition(type_texts: &[String]) -> (bool, bool) {
    let parts = type_parts(type_texts);
    if parts.is_empty() {
        return (false, false);
    }

    // Union semantics: all parts must agree for the whole to be truthy/falsy.
    // Intersection of literal-narrowing brands (e.g. `string & {}`) is handled
    // by treating the textual `&` split the same way the upstream walks union
    // parts: each atom is evaluated and the overall result is the conjunction.
    let mut all_truthy = true;
    let mut all_falsy = true;
    for part in &parts {
        let (part_truthy, part_falsy) = atom_condition(part);
        if !part_truthy {
            all_truthy = false;
        }
        if !part_falsy {
            all_falsy = false;
        }
    }
    (all_truthy, all_falsy)
}

/// Truthiness of a single atomic type text.
fn atom_condition(part: &str) -> (bool, bool) {
    let part = part.trim();
    match part {
        "never" => return (false, true),
        "null" | "undefined" | "void" => return (false, true),
        "true" => return (true, false),
        "false" => return (false, true),
        "object" => return (true, false),
        "0" | "0n" | "-0" | "NaN" => return (false, true),
        "\"\"" | "''" | "``" => return (false, true),
        // Generic primitive types are indeterminate.
        "string" | "number" | "bigint" | "boolean" | "symbol" | "any" | "unknown" => {
            return (false, false);
        }
        _ => {}
    }

    if is_string_literal_atom(part) {
        // Non-empty string literal (empty handled above).
        return (true, false);
    }
    if is_number_literal_atom(part) {
        return number_atom_condition(part);
    }
    if is_bigint_literal_atom(part) {
        let digits = &part[..part.len() - 1];
        if digits == "0" {
            return (false, true);
        }
        return (true, false);
    }

    // Object/array/function/branded types render as structural text and are
    // always truthy in JavaScript.
    if is_known_object_like_atom(part) {
        return (true, false);
    }

    (false, false)
}

fn number_atom_condition(part: &str) -> (bool, bool) {
    match part.parse::<f64>() {
        Ok(value) if value == 0.0 || value.is_nan() => (false, true),
        Ok(_) => (true, false),
        Err(_) => (false, false),
    }
}

fn is_known_object_like_atom(part: &str) -> bool {
    let part = part.trim();
    part.starts_with('{')
        || part.starts_with('[')
        || part.starts_with('(')
        || part.ends_with("[]")
        || part.starts_with("Array<")
        || part.starts_with("ReadonlyArray<")
        || part.contains("=>")
        // A branded/object intersection like `string & {}` keeps the object
        // atom; structural names (PascalCase with a recognised shape) are
        // treated as object-like only when they clearly are.
        || (part.chars().next().is_some_and(|c| c.is_ascii_uppercase())
            && part.len() > 2
            && part != "Function")
}

fn is_string_literal_atom(part: &str) -> bool {
    let bytes = part.as_bytes();
    part.len() >= 2
        && ((bytes[0] == b'"' && part.ends_with('"'))
            || (bytes[0] == b'\'' && part.ends_with('\''))
            || (bytes[0] == b'`' && part.ends_with('`')))
}

fn is_number_literal_atom(part: &str) -> bool {
    !part.is_empty() && part.parse::<f64>().is_ok()
}

fn is_bigint_literal_atom(part: &str) -> bool {
    part.ends_with('n') && part.len() > 1 && part[..part.len() - 1].parse::<i128>().is_ok()
}

fn is_true_literal_type(type_texts: &[String]) -> bool {
    let parts = type_parts(type_texts);
    parts.len() == 1 && parts[0] == "true"
}

// ---------------------------------------------------------------------------
// Loop-condition option handling.
// ---------------------------------------------------------------------------

/// Reads `allowConstantLoopConditions` from `__ruleOptions`. Accepts the legacy
/// boolean form (`true` -> "always") and the string form. Defaults to "never".
fn allow_constant_loop_conditions(node: &LintNode) -> String {
    let Some(options) = node
        .fields
        .get("__ruleOptions")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
    else {
        return "never".to_owned();
    };
    match options.get("allowConstantLoopConditions") {
        Some(serde_json::Value::String(value)) => value.clone(),
        Some(serde_json::Value::Bool(true)) => "always".to_owned(),
        _ => "never".to_owned(),
    }
}

fn is_true_keyword(node: &LintNode) -> bool {
    node.kind == "Literal" && node.field_bool("value") == Some(true)
}

/// Port of upstream `isAllowedConstantLiteral`: `true`, `false`, `0`, `1`.
fn is_allowed_constant_literal(node: &LintNode) -> bool {
    if node.kind != "Literal" {
        return false;
    }
    if let Some(value) = node.field_bool("value") {
        let _ = value;
        return true;
    }
    matches!(node.field_f64("value"), Some(v) if v == 0.0 || v == 1.0)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintNode, RuleContext, RustLintRule};
    use super::NoUnnecessaryConditionRule;

    fn run(node: &LintNode) -> Vec<super::super::super::LintDiagnostic> {
        // Construct the rule directly rather than through the registry, since
        // the staged file is not yet wired into `with_default_type_aware_rules`.
        let rule = NoUnnecessaryConditionRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
    }

    fn if_node(test_kind: &str, test_type: &str) -> LintNode {
        serde_json::from_value(json!({
            "kind": "IfStatement",
            "range": { "start": 0, "end": 20 },
            "children": {
                "test": {
                    "kind": test_kind,
                    "range": { "start": 4, "end": 10 },
                    "typeTexts": [test_type],
                }
            }
        }))
        .unwrap()
    }

    #[test]
    fn reports_always_truthy_object_condition() {
        let diagnostics = run(&if_node("Identifier", "object"));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "alwaysTruthy");
        assert_eq!(
            diagnostics[0].range,
            super::super::super::TextRange::new(4, 10)
        );
    }

    #[test]
    fn reports_always_falsy_condition() {
        let diagnostics = run(&if_node("Identifier", "undefined"));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "alwaysFalsy");
    }

    #[test]
    fn reports_never_condition() {
        let diagnostics = run(&if_node("Identifier", "never"));
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "never");
    }

    #[test]
    fn does_not_report_boolean_condition() {
        let diagnostics = run(&if_node("Identifier", "boolean"));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn does_not_report_union_with_object_and_nullish() {
        // `null | object` is neither always truthy nor always falsy.
        let diagnostics = run(&if_node("Identifier", "null | object"));
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn unary_not_flips_truthiness() {
        // `!alwaysTruthy` is always falsy.
        let node: LintNode = serde_json::from_value(json!({
            "kind": "IfStatement",
            "range": { "start": 0, "end": 20 },
            "children": {
                "test": {
                    "kind": "UnaryExpression",
                    "range": { "start": 4, "end": 11 },
                    "fields": { "operator": "!" },
                    "children": {
                        "argument": {
                            "kind": "Identifier",
                            "range": { "start": 5, "end": 11 },
                            "typeTexts": ["object"],
                        }
                    }
                }
            }
        }))
        .unwrap();
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "alwaysFalsy");
    }

    #[test]
    fn reports_never_nullish_on_nullish_coalescing() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "LogicalExpression",
            "range": { "start": 0, "end": 12 },
            "fields": { "operator": "??" },
            "children": {
                "left": {
                    "kind": "Identifier",
                    "range": { "start": 0, "end": 3 },
                    "typeTexts": ["string"],
                },
                "right": {
                    "kind": "Literal",
                    "range": { "start": 7, "end": 12 },
                    "typeTexts": ["\"x\""],
                }
            }
        }))
        .unwrap();
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "neverNullish");
    }

    #[test]
    fn does_not_report_nullable_nullish_coalescing() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "LogicalExpression",
            "range": { "start": 0, "end": 12 },
            "fields": { "operator": "??" },
            "children": {
                "left": {
                    "kind": "Identifier",
                    "range": { "start": 0, "end": 3 },
                    "typeTexts": ["string | undefined"],
                },
                "right": {
                    "kind": "Literal",
                    "range": { "start": 7, "end": 12 },
                    "typeTexts": ["\"x\""],
                }
            }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }

    #[test]
    fn reports_comparison_between_literal_types() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "BinaryExpression",
            "range": { "start": 0, "end": 9 },
            "fields": { "operator": "===" },
            "children": {
                "left": {
                    "kind": "Literal",
                    "range": { "start": 0, "end": 1 },
                    "typeTexts": ["1"],
                },
                "right": {
                    "kind": "Literal",
                    "range": { "start": 6, "end": 7 },
                    "typeTexts": ["2"],
                }
            }
        }))
        .unwrap();
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].message_id, "comparisonBetweenLiteralTypes");
        // Without checker shapes the type texts still fill the placeholders.
        assert_eq!(
            diagnostics[0].message,
            "Unnecessary conditional, comparison is always false, since `1 === 2` is false."
        );
        assert_eq!(
            diagnostics[0].data.get("trueOrFalse").map(String::as_str),
            Some("false")
        );
    }

    #[test]
    fn does_not_report_comparison_with_non_literal() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "BinaryExpression",
            "range": { "start": 0, "end": 9 },
            "fields": { "operator": "===" },
            "children": {
                "left": {
                    "kind": "Identifier",
                    "range": { "start": 0, "end": 1 },
                    "typeTexts": ["number"],
                },
                "right": {
                    "kind": "Literal",
                    "range": { "start": 6, "end": 7 },
                    "typeTexts": ["2"],
                }
            }
        }))
        .unwrap();
        assert!(run(&node).is_empty());
    }
}
