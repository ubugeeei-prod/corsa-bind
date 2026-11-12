use serde_json::Value;

use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::{TypeDetail, is_unsafe_assignment, quoted_type};
use crate::utils::is_unsafe_assignment as is_unsafe_assignment_text;

/// Type-aware rule that rejects assigning any-typed values to specific targets.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnsafeAssignmentRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unsafe",
        description: "Unsafe assignment of an `any` value.",
    },
    RuleMessage {
        id: "unsafeAssignment",
        description: "Unsafe assignment of type {{sender}} to a variable of type {{receiver}}.",
    },
    RuleMessage {
        id: "unsafeArrayPattern",
        description: "Unsafe array destructuring of an {{sender}} array value.",
    },
    RuleMessage {
        id: "unsafeArrayPatternFromTuple",
        description: "Unsafe array destructuring of a tuple element with an {{sender}} value.",
    },
    RuleMessage {
        id: "unsafeObjectPattern",
        description: "Unsafe object destructuring of a property with an {{sender}} value.",
    },
    RuleMessage {
        id: "unsafeArraySpread",
        description: "Unsafe spread of an {{sender}} value in an array.",
    },
];
const LISTENERS: &[&str] = &[
    "AccessorProperty",
    "AssignmentExpression",
    "AssignmentPattern",
    "Property",
    "PropertyDefinition",
    "SpreadElement",
    "VariableDeclarator",
];

/// How the receiver's type is compared beyond the top-level `any` check.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Comparison {
    /// The receiver's type is inferred from the sender, so only `any` matters.
    None,
    /// The receiver is declared: compare generic type arguments too.
    Basic,
}

impl RustLintRule for NoUnsafeAssignmentRule {
    fn name(&self) -> &'static str {
        "no-unsafe-assignment"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow assigning any-typed values to more specific targets."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "AssignmentExpression" if node.field_str("operator") == Some("=") => {
                check_with_patterns(ctx, node, "left", "right");
            }
            "AssignmentPattern" => check_with_patterns(ctx, node, "left", "right"),
            "VariableDeclarator" => check_with_patterns(ctx, node, "id", "init"),
            "PropertyDefinition" | "AccessorProperty" => {
                let (Some(receiver), Some(sender)) = (node.child("key"), node.child("value"))
                else {
                    return;
                };
                let comparison = if node.child("typeAnnotation").is_some() {
                    Comparison::Basic
                } else {
                    Comparison::None
                };
                check_assignment(ctx, Receiver::Node(receiver), sender, node, comparison);
            }
            "Property" => check_property(ctx, node),
            "SpreadElement" if node.field_str("__parentKind") == Some("ArrayExpression") => {
                check_array_spread(ctx, node);
            }
            _ => {}
        }
    }
}

/// Where the receiving type comes from.
#[derive(Clone, Copy)]
enum Receiver<'a> {
    /// The type at a node.
    Node(&'a LintNode),
    /// A contextual type the host resolved (`{ texts, detail }`).
    Described(Option<TypeDetail<'a>>, Option<&'a Value>),
}

impl<'a> Receiver<'a> {
    fn detail(self) -> Option<TypeDetail<'a>> {
        match self {
            Self::Node(node) => TypeDetail::of(node),
            Self::Described(detail, _) => detail,
        }
    }

    fn texts(self) -> Vec<&'a str> {
        match self {
            Self::Node(node) => node.type_texts.iter().map(String::as_str).collect(),
            Self::Described(_, texts) => texts
                .and_then(Value::as_array)
                .map(|texts| texts.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default(),
        }
    }
}

fn check_with_patterns(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    receiver_key: &str,
    sender_key: &str,
) {
    let (Some(receiver), Some(sender)) = (node.child(receiver_key), node.child(sender_key)) else {
        return;
    };
    let comparison =
        if node.kind == "VariableDeclarator" && receiver.child("typeAnnotation").is_none() {
            Comparison::None
        } else {
            Comparison::Basic
        };
    if check_assignment(ctx, Receiver::Node(receiver), sender, node, comparison) {
        return;
    }
    let Some(detail) = TypeDetail::of(sender) else {
        return;
    };
    match receiver.kind.as_str() {
        "ArrayPattern" => {
            check_array_destructure(ctx, receiver, detail);
        }
        "ObjectPattern" => {
            check_object_destructure(ctx, receiver);
        }
        _ => {}
    }
}

/// The member type the host resolved for a pattern target.
fn destructured_type(target: &LintNode) -> Option<TypeDetail<'_>> {
    target
        .fields
        .get("__destructuredType")
        .and_then(TypeDetail::from_value)
}

/// Reports `sender` flowing into `receiver`; returns whether it reported.
fn check_assignment(
    ctx: &mut RuleContext<'_>,
    receiver: Receiver<'_>,
    sender: &LintNode,
    report_node: &LintNode,
    comparison: Comparison,
) -> bool {
    let Some(sender_detail) = TypeDetail::of(sender) else {
        return check_assignment_text(ctx, receiver, sender, report_node, comparison);
    };
    let receiver_detail = receiver.detail();
    if sender_detail.is_any() {
        if receiver_detail.is_some_and(TypeDetail::is_unknown) {
            return false;
        }
        ctx.report("unsafe", report_node.range);
        return true;
    }
    if comparison == Comparison::None {
        return false;
    }
    let Some(receiver_detail) = receiver_detail else {
        return false;
    };
    if is_unsafe_assignment(sender_detail, receiver_detail, Some(sender)) {
        let sender_name = quoted_type(&sender.type_texts);
        let receiver_name = quoted_type(&receiver.texts());
        ctx.report_with_data(
            "unsafeAssignment",
            report_node.range,
            &[
                ("sender", sender_name.as_str()),
                ("receiver", receiver_name.as_str()),
            ],
        );
        return true;
    }
    false
}

/// Fallback for hosts without checker details: rendered-text comparison.
fn check_assignment_text(
    ctx: &mut RuleContext<'_>,
    receiver: Receiver<'_>,
    sender: &LintNode,
    report_node: &LintNode,
    comparison: Comparison,
) -> bool {
    let targets = if comparison == Comparison::None {
        Vec::new()
    } else {
        receiver.texts()
    };
    if is_unsafe_assignment_text(&sender.type_texts, &targets) {
        ctx.report("unsafe", report_node.range);
        return true;
    }
    false
}

/// `[a, b] = value`: an `any[]` sender is unsafe as a whole, a tuple sender per
/// `any` element; nested patterns follow the element types. Returns whether a
/// report was made (typescript-eslint's `didReport`).
fn check_array_destructure(
    ctx: &mut RuleContext<'_>,
    pattern: &LintNode,
    sender: TypeDetail<'_>,
) -> bool {
    if sender.is_any_array() {
        ctx.report_with_data("unsafeArrayPattern", pattern.range, &[("sender", "`any`")]);
        return false;
    }
    if !sender.is_tuple() {
        return true;
    }
    let elements = sender.type_arguments();
    let Some(receivers) = pattern.child_list("elements") else {
        return false;
    };
    let mut did_report = false;
    for (receiver, element) in receivers.iter().zip(elements) {
        let element = destructured_type(receiver).unwrap_or(element);
        did_report =
            check_destructured_target(ctx, receiver, element, "unsafeArrayPatternFromTuple")
                .unwrap_or(did_report);
    }
    did_report
}

/// `{ a, b: { c } } = value`, judged per property type the host resolved.
fn check_object_destructure(ctx: &mut RuleContext<'_>, pattern: &LintNode) -> bool {
    let mut did_report = false;
    for property in pattern.child_list("properties").unwrap_or(&[]) {
        let Some(value) = property.child("value") else {
            continue;
        };
        let Some(member) = destructured_type(value) else {
            continue;
        };
        did_report = check_destructured_target(ctx, value, member, "unsafeObjectPattern")
            .unwrap_or(did_report);
    }
    did_report
}

/// Reports an `any` member at its target, or follows a nested pattern.
/// `None` leaves the running `didReport` as it was.
fn check_destructured_target(
    ctx: &mut RuleContext<'_>,
    target: &LintNode,
    member: TypeDetail<'_>,
    message_id: &'static str,
) -> Option<bool> {
    match target.kind.as_str() {
        "RestElement" => None,
        _ if member.is_any() => {
            ctx.report_with_data(message_id, target.range, &[("sender", "`any`")]);
            Some(true)
        }
        "ArrayPattern" => Some(check_array_destructure(ctx, target, member)),
        "ObjectPattern" => Some(check_object_destructure(ctx, target)),
        _ => None,
    }
}

/// `{ key: value }` outside a pattern, compared against the contextual type of
/// the key (typescript-eslint `ComparisonType.Contextual`).
fn check_property(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_str("__parentKind") == Some("ObjectPattern") {
        return;
    }
    let (Some(key), Some(value)) = (node.child("key"), node.child("value")) else {
        return;
    };
    // `{ a = 1 }` is a pattern default (TS-ESTree `AssignmentPattern`), even
    // where a parser recovers it as an assignment inside an object literal.
    let shorthand_default =
        node.field_bool("shorthand") == Some(true) && value.kind == "AssignmentExpression";
    if shorthand_default
        || matches!(
            value.kind.as_str(),
            "AssignmentPattern" | "TSEmptyBodyFunctionExpression"
        )
    {
        return;
    }
    let contextual = node.fields.get("__keyContextualType");
    let receiver = match contextual {
        Some(Value::Null) | None => Receiver::Node(key),
        Some(described) => Receiver::Described(
            described.get("detail").and_then(TypeDetail::from_value),
            described.get("texts"),
        ),
    };
    // An identifier key's contextual type decides; without the host's answer
    // an `unknown` receiver cannot be ruled out.
    if contextual.is_none() && key.kind == "Identifier" && node.field_bool("computed") != Some(true)
    {
        return;
    }
    check_assignment(ctx, receiver, value, node, Comparison::Basic);
}

fn check_array_spread(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(argument) = node.child("argument") else {
        return;
    };
    let Some(detail) = TypeDetail::of(argument) else {
        return;
    };
    if detail.is_any() || detail.is_any_array() {
        ctx.report_with_data("unsafeArraySpread", node.range, &[("sender", "`any`")]);
    }
}
