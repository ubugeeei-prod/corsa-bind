use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::checker_types::{
    CallParameters, EnumValueKind, FunctionReturns, TypeDetail, TypePart, flags,
};

/// Type-aware rule that rejects non-enum values flowing into enum-typed
/// locations (typescript-eslint `no-unsafe-enum-assignment`).
#[derive(Clone, Copy, Debug, Default)]
pub struct NoUnsafeEnumAssignmentRule;

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unsafeEnumArgument",
        description: "The argument passed here does not have a shared enum type with the expected enum {{enumNames}}.",
    },
    RuleMessage {
        id: "unsafeEnumAssertion",
        description: "The value asserted here does not have a shared enum type with the expected enum {{enumNames}}.",
    },
    RuleMessage {
        id: "unsafeEnumAssignment",
        description: "The value assigned here does not have a shared enum type with the expected enum {{enumNames}}.",
    },
    RuleMessage {
        id: "unsafeEnumMutation",
        description: "This mutation can produce a value outside of the expected enum {{enumNames}}.",
    },
    RuleMessage {
        id: "unsafeEnumReturn",
        description: "The value returned here does not have a shared enum type with the expected enum {{enumNames}}.",
    },
];
const LISTENERS: &[&str] = &[
    "AccessorProperty",
    "ArrayExpression",
    "ArrowFunctionExpression",
    "AssignmentExpression",
    "AssignmentPattern",
    "CallExpression",
    "NewExpression",
    "ObjectExpression",
    "PropertyDefinition",
    "ReturnStatement",
    "TSAsExpression",
    "TSTypeAssertion",
    "TaggedTemplateExpression",
    "UpdateExpression",
    "VariableDeclarator",
];
/// Bound on the type-argument recursion of [`has_enum_mismatch`].
const MAX_DEPTH: usize = 5;

impl RustLintRule for NoUnsafeEnumAssignmentRule {
    fn name(&self) -> &'static str {
        "no-unsafe-enum-assignment"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow assigning non-enum values to enum typed locations."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        match node.kind.as_str() {
            "VariableDeclarator" => {
                if let (Some(id), Some(init)) = (node.child("id"), node.child("init")) {
                    check_assignment(ctx, TypeDetail::of(id), init, node, "unsafeEnumAssignment");
                }
            }
            "AssignmentExpression" => check_assignment_expression(ctx, node),
            "AssignmentPattern" => {
                if let (Some(left), Some(right)) = (node.child("left"), node.child("right")) {
                    check_assignment(
                        ctx,
                        TypeDetail::of(left),
                        right,
                        node,
                        "unsafeEnumAssignment",
                    );
                }
            }
            "UpdateExpression" => {
                if let Some(argument) = node.child("argument") {
                    check_mutation(ctx, argument, node);
                }
            }
            "PropertyDefinition" | "AccessorProperty" => {
                if let (Some(key), Some(value)) = (node.child("key"), node.child("value")) {
                    check_assignment(
                        ctx,
                        TypeDetail::of(key),
                        value,
                        node,
                        "unsafeEnumAssignment",
                    );
                }
            }
            "TSAsExpression" | "TSTypeAssertion" => {
                if let Some(expression) = node.child("expression") {
                    check_assignment(
                        ctx,
                        TypeDetail::of(node),
                        expression,
                        node,
                        "unsafeEnumAssertion",
                    );
                }
            }
            "CallExpression" | "NewExpression" | "TaggedTemplateExpression" => {
                check_arguments(ctx, node);
            }
            "ReturnStatement" => {
                if let Some(argument) = node.child("argument") {
                    check_return(ctx, node, argument, node);
                }
            }
            "ArrowFunctionExpression" => {
                if let Some(body) = node
                    .child("body")
                    .filter(|body| body.kind != "BlockStatement")
                {
                    check_return(ctx, node, body, body);
                }
            }
            "ArrayExpression" => {
                for element in node.child_list("elements").unwrap_or(&[]) {
                    check_assignment(
                        ctx,
                        contextual_type(element),
                        element,
                        element,
                        "unsafeEnumAssignment",
                    );
                }
            }
            "ObjectExpression" => check_object(ctx, node),
            _ => {}
        }
    }
}

const ASSIGNING_OPERATORS: &[&str] = &["=", "&&=", "&=", "??=", "^=", "|=", "||="];

fn check_assignment_expression(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let (Some(left), Some(right)) = (node.child("left"), node.child("right")) else {
        return;
    };
    let operator = node.field_str("operator").unwrap_or_default();
    if ASSIGNING_OPERATORS.contains(&operator) {
        check_assignment(
            ctx,
            TypeDetail::of(left),
            right,
            node,
            "unsafeEnumAssignment",
        );
    } else {
        check_mutation(ctx, left, node);
    }
}

/// The checker's contextual type for a node, as the host stamped it.
fn contextual_type(node: &LintNode) -> Option<TypeDetail<'_>> {
    node.fields
        .get("__contextualType")
        .filter(|value| !value.is_null())
        .and_then(|value| value.get("detail"))
        .and_then(TypeDetail::from_value)
}

fn check_object(ctx: &mut RuleContext<'_>, node: &LintNode) {
    for property in node.child_list("properties").unwrap_or(&[]) {
        let (receiver, sender) = if property.kind == "SpreadElement" {
            (contextual_type(node), property.child("argument"))
        } else {
            let value = property.child("value");
            (value.and_then(contextual_type), value)
        };
        if let Some(sender) = sender {
            check_assignment(ctx, receiver, sender, property, "unsafeEnumAssignment");
        }
    }
}

/// Reports `sender` flowing into `receiver`. Array and object literals are
/// judged per element and property by their own listeners instead.
fn check_assignment(
    ctx: &mut RuleContext<'_>,
    receiver: Option<TypeDetail<'_>>,
    sender: &LintNode,
    report_node: &LintNode,
    message_id: &'static str,
) {
    if matches!(sender.kind.as_str(), "ArrayExpression" | "ObjectExpression") {
        return;
    }
    let (Some(receiver), Some(sender_detail)) = (receiver, TypeDetail::of(sender)) else {
        return;
    };
    check_types(
        ctx,
        receiver,
        sender_detail,
        sender,
        report_node,
        message_id,
    );
}

fn check_types(
    ctx: &mut RuleContext<'_>,
    receiver: TypeDetail<'_>,
    sender_detail: TypeDetail<'_>,
    sender: &LintNode,
    report_node: &LintNode,
    message_id: &'static str,
) {
    if has_enum_mismatch(sender_detail, receiver, 0) && !is_safe_bitwise(sender, receiver) {
        report(ctx, message_id, report_node, receiver);
    }
}

fn report(
    ctx: &mut RuleContext<'_>,
    message_id: &'static str,
    node: &LintNode,
    receiver: TypeDetail<'_>,
) {
    let names = describe_enums(receiver);
    ctx.report_with_data(message_id, node.range, &[("enumNames", names.as_str())]);
}

/// typescript-eslint `describeEnumTypes`: `'Fruit', 'Vegetable'`, sorted, from
/// the receiver and its type arguments.
fn describe_enums(receiver: TypeDetail<'_>) -> String {
    let mut names = Vec::new();
    collect_enum_names(receiver.constrained(), &mut names, 0);
    names.sort_unstable();
    names.dedup();
    names
        .iter()
        .map(|name| format!("'{name}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn collect_enum_names<'a>(detail: TypeDetail<'a>, names: &mut Vec<&'a str>, depth: usize) {
    names.extend(detail.enum_names());
    if depth < MAX_DEPTH {
        for argument in detail.type_arguments() {
            collect_enum_names(argument.constrained(), names, depth + 1);
        }
    }
}

/// `x += 1`, `x++`: any arithmetic on an enum-typed target can leave the enum.
fn check_mutation(ctx: &mut RuleContext<'_>, target: &LintNode, report_node: &LintNode) {
    let Some(detail) = TypeDetail::of(target) else {
        return;
    };
    if !detail.constrained().enum_ids().is_empty() {
        report(ctx, "unsafeEnumMutation", report_node, detail);
    }
}

fn check_arguments(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(parameters) = CallParameters::of(node) else {
        return;
    };
    let is_tagged_template = node.kind == "TaggedTemplateExpression";
    let arguments = if is_tagged_template {
        node.child("quasi")
            .and_then(|quasi| quasi.child_list("expressions"))
            .unwrap_or(&[])
    } else {
        node.child_list("arguments").unwrap_or(&[])
    };
    // The template strings array takes the first parameter of a tag.
    let mut position = usize::from(is_tagged_template);
    for argument in arguments {
        let parameter = |position: usize| {
            parameters
                .at(position)
                .and_then(|parameter| parameter.detail())
        };
        if argument.kind != "SpreadElement" {
            check_assignment(
                ctx,
                parameter(position),
                argument,
                argument,
                "unsafeEnumArgument",
            );
            position += 1;
            continue;
        }
        let Some(spread) = argument.child("argument").and_then(TypeDetail::of) else {
            return;
        };
        if !spread.is_tuple() {
            // An array spread fills one parameter here and the rest of the call
            // cannot be lined up any more.
            return;
        }
        let mut mismatched = None;
        for element in spread.type_arguments() {
            if let Some(receiver) = parameter(position) {
                if mismatched.is_none() && has_enum_mismatch(element, receiver, 0) {
                    mismatched = Some(receiver);
                }
            }
            position += 1;
        }
        if let Some(receiver) = mismatched {
            report(ctx, "unsafeEnumArgument", argument, receiver);
        }
        if spread
            .reference_text()
            .is_none_or(|text| text.contains("..."))
        {
            return;
        }
    }
}

/// Against the return type of the function's own signature, awaited for an
/// `async` function.
fn check_return(
    ctx: &mut RuleContext<'_>,
    owner: &LintNode,
    returned: &LintNode,
    report_node: &LintNode,
) {
    let Some(returns) = FunctionReturns::of(owner) else {
        return;
    };
    let Some(receiver) = returns
        .own_signatures
        .first()
        .and_then(|signature| signature.detail())
    else {
        return;
    };
    let Some(sender) = TypeDetail::of(returned) else {
        return;
    };
    if matches!(
        returned.kind.as_str(),
        "ArrayExpression" | "ObjectExpression"
    ) {
        return;
    }
    let (receiver, sender) = if returns.is_async {
        (receiver.awaited(), sender.awaited())
    } else {
        (receiver, sender)
    };
    check_types(
        ctx,
        receiver,
        sender,
        returned,
        report_node,
        "unsafeEnumReturn",
    );
}

/// typescript-eslint `hasDeepEnumAssignmentMismatch`, following type
/// arguments of references to the same generic (`Set<number>` into
/// `Set<Fruit>`). Object members are not followed.
fn has_enum_mismatch(sender: TypeDetail<'_>, receiver: TypeDetail<'_>, depth: usize) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    let sender = sender.constrained();
    let receiver = receiver.constrained();
    if sender.id().is_some_and(|id| !id.is_empty()) && sender.id() == receiver.id() {
        return false;
    }
    if is_mismatched_enum_assignment(sender, receiver) {
        return true;
    }
    if !sender.is_reference() || !receiver.is_reference() {
        return false;
    }
    let sender_arguments = sender.type_arguments();
    let receiver_arguments = receiver.type_arguments();
    sender_arguments.len() == receiver_arguments.len()
        && sender_arguments
            .into_iter()
            .zip(receiver_arguments)
            .any(|(sender, receiver)| has_enum_mismatch(sender, receiver, depth + 1))
}

/// typescript-eslint `isMismatchedEnumAssignmentTypes`: a number- or
/// string-like sender constituent that shares no enum with an enum receiver of
/// that kind and fits none of the receiver's non-enum constituents.
fn is_mismatched_enum_assignment(sender: TypeDetail<'_>, receiver: TypeDetail<'_>) -> bool {
    let receiver_enums = receiver.enum_ids();
    let receiver_parts = receiver.parts();
    let kinds = receiver_parts
        .iter()
        .filter_map(|part| part.enum_value_kind())
        .collect::<Vec<_>>();
    if kinds.is_empty() {
        return false;
    }
    let non_enum = receiver_parts
        .iter()
        .filter(|part| part.flags & flags::ENUM_LITERAL == 0)
        .collect::<Vec<_>>();
    sender.parts().iter().any(|part| {
        let kind_matches = (kinds.contains(&EnumValueKind::Number)
            && part.member_flags & flags::NUMBER_LIKE != 0)
            || (kinds.contains(&EnumValueKind::String)
                && part.member_flags & flags::STRING_LIKE != 0);
        kind_matches
            && !part
                .enum_id
                .is_some_and(|enum_id| receiver_enums.contains(&enum_id))
            && !non_enum
                .iter()
                .any(|receiver| may_be_assignable(*part, **receiver))
    })
}

/// Assignability of a number- or string-like constituent to a non-enum one,
/// decided on flags. Receivers the flags cannot settle (objects, generics, ...)
/// count as assignable, so they never produce a report.
fn may_be_assignable(sender: TypePart<'_>, receiver: TypePart<'_>) -> bool {
    const DEFINITELY_NOT: u32 = (1 << 2) // Undefined
        | (1 << 3) // Null
        | (1 << 4) // Void
        | (1 << 8) // Boolean
        | (1 << 9) // ESSymbol
        | (1 << 13) // BooleanLiteral
        | (1 << 14) // UniqueESSymbol
        | flags::NEVER;
    const LITERAL: u32 = (1 << 10) | (1 << 11) | (1 << 12); // String/Number/BigInt literal
    if !sender.id.is_empty() && sender.id == receiver.id {
        return true;
    }
    if receiver.flags & (flags::ANY | flags::UNKNOWN) != 0 {
        return true;
    }
    if receiver.flags & (1 << 6) != 0 {
        // number
        return sender.member_flags & flags::NUMBER_LIKE != 0;
    }
    if receiver.flags & (1 << 5) != 0 {
        // string
        return sender.member_flags & flags::STRING_LIKE != 0;
    }
    if receiver.flags & (1 << 7) != 0 {
        // bigint
        return false;
    }
    receiver.flags & (DEFINITELY_NOT | LITERAL) == 0
}

/// Bitwise combinations of an enum's own members are its flags:
/// `Flags.Read | Flags.Write`, `~Flags.Write`.
fn is_safe_bitwise(node: &LintNode, receiver: TypeDetail<'_>) -> bool {
    let safe_operand = |operand: &LintNode| {
        is_safe_bitwise(operand, receiver)
            || TypeDetail::of(operand)
                .is_some_and(|detail| !is_mismatched_enum_assignment(detail, receiver))
    };
    match node.kind.as_str() {
        "BinaryExpression" => {
            matches!(node.field_str("operator"), Some("&" | "^" | "|"))
                && node.child("left").is_some_and(safe_operand)
                && node.child("right").is_some_and(safe_operand)
        }
        "UnaryExpression" => {
            node.field_str("operator") == Some("~")
                && node.child("argument").is_some_and(safe_operand)
        }
        _ => false,
    }
}
