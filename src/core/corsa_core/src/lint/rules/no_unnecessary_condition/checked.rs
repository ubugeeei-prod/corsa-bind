//! Checker-flag verdicts for no-unnecessary-condition, read off `__typeShape`.
//!
//! Each function mirrors the typescript-eslint helper named in its doc comment.
//! They answer `None` when a node lacks the shape fact, so the caller can fall
//! back to rendered type texts.

use super::super::super::LintNode;
use super::super::super::type_shape::{TypeShape, flags};

/// Options and compiler settings that change the rule's verdicts.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Settings {
    /// `compilerOptions.noUncheckedIndexedAccess`.
    pub(super) no_unchecked_indexed_access: bool,
}

impl Settings {
    pub(super) fn of(node: &LintNode) -> Self {
        Self {
            no_unchecked_indexed_access: node.field_bool("__noUncheckedIndexedAccess")
                == Some(true),
        }
    }
}

/// `checkNode`'s type verdict: `"never"`, `"alwaysFalsy"`, `"alwaysTruthy"` or
/// nothing. `Some(None)` means the shape was read and nothing is reported.
pub(super) fn truthiness(expression: &LintNode) -> Option<Option<Truthiness>> {
    let shape = TypeShape::of(expression)?;
    if shape.is_conditional_always_necessary() {
        return Some(None);
    }
    if shape.has(flags::NEVER) {
        return Some(Some(Truthiness::Never));
    }
    if !shape.is_possibly_truthy() {
        return Some(Some(Truthiness::Falsy));
    }
    if !shape.is_possibly_falsy() {
        return Some(Some(Truthiness::Truthy));
    }
    Some(None)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Truthiness {
    Never,
    Falsy,
    Truthy,
}

/// `checkNodeForNullish`. Returns the message id, `Some(None)` when nothing is
/// reported, and `None` without a shape.
pub(super) fn nullish(node: &LintNode, settings: Settings) -> Option<Option<&'static str>> {
    let shape = TypeShape::of(node)?;
    if shape.has(
        flags::ANY
            | flags::UNKNOWN
            | flags::TYPE_PARAMETER
            | flags::TYPE_VARIABLE
            | flags::CONDITIONAL,
    ) {
        return Some(None);
    }
    if shape.has(flags::NEVER) {
        return Some(Some("never"));
    }
    if !shape.is_possibly_nullish()
        && !(node.kind == "MemberExpression" && is_nullable_member_expression(node))
    {
        let chain_has_array_index = node.kind == "ChainExpression"
            && node.child("expression").is_some_and(|expression| {
                expression.kind != "TSNonNullExpression"
                    && option_chain_contains_option_array_index(expression, settings)
            });
        if settings.no_unchecked_indexed_access
            || (!is_array_index_expression(node, settings) && !chain_has_array_index)
        {
            return Some(Some("neverNullish"));
        }
        return Some(None);
    }
    if shape.is_always_nullish() && !has_possibly_non_nullish_computed_member_property(node) {
        return Some(Some("alwaysNullish"));
    }
    Some(None)
}

/// `isNullableMemberExpression`. A computed access without per-key facts
/// counts as nullable, which keeps `neverNullish` quiet.
fn is_nullable_member_expression(node: &LintNode) -> bool {
    let Some(object) = node.child("object").and_then(TypeShape::of) else {
        return node.field_bool("computed") == Some(true);
    };
    if node.field_bool("computed") == Some(true) {
        return object
            .keys()
            .and_then(|keys| object.root().is_nullable_property_type(&keys))
            .unwrap_or(true);
    }
    object
        .member()
        .is_some_and(|member| member.found && member.optional)
}

/// `hasPossiblyNonNullishComputedMemberProperty` over
/// `getComputedMemberPropertyTypes`. Without per-key facts a computed member is
/// assumed to have one, which keeps `alwaysNullish` quiet.
fn has_possibly_non_nullish_computed_member_property(node: &LintNode) -> bool {
    if node.kind != "MemberExpression" || node.field_bool("computed") != Some(true) {
        return false;
    }
    let Some(object) = node.child("object").and_then(TypeShape::of) else {
        return true;
    };
    let (Some(keys), Some(keyed)) = (object.keys(), object.root().keyed()) else {
        return true;
    };
    let mut property_types = Vec::with_capacity(keys.len());
    for (index, key) in keys.iter().enumerate() {
        if key.literal.is_none() {
            return false;
        }
        match keyed.get(index).copied().flatten() {
            Some(member) if member.found => property_types.push(member),
            _ => return false,
        }
    }
    property_types.iter().any(|member| member.non_nullish)
}

/// `isArrayIndexExpression`, gated on `noUncheckedIndexedAccess` by callers.
pub(super) fn is_array_index_expression(node: &LintNode, _settings: Settings) -> bool {
    if node.kind != "MemberExpression" || node.field_bool("computed") != Some(true) {
        return false;
    }
    let Some(object) = node.child("object").and_then(TypeShape::of) else {
        return false;
    };
    let parts = object.union();
    let property_is_literal = node
        .child("property")
        .is_some_and(|property| property.kind == "Literal");
    parts.iter().any(|part| part.is_array())
        || (parts.iter().any(|part| part.is_tuple()) && !property_is_literal)
}

/// `optionChainContainsOptionArrayIndex`.
pub(super) fn option_chain_contains_option_array_index(
    node: &LintNode,
    settings: Settings,
) -> bool {
    let lhs = if node.kind == "CallExpression" {
        node.child("callee")
    } else {
        node.child("object")
    };
    let Some(lhs) = lhs else {
        return false;
    };
    if node.field_bool("optional") == Some(true) && is_array_index_expression(lhs, settings) {
        return true;
    }
    if matches!(lhs.kind.as_str(), "MemberExpression" | "CallExpression") {
        return option_chain_contains_option_array_index(lhs, settings);
    }
    false
}

/// `isOptionableExpression`: `None` without a shape on `node`.
pub(super) fn is_optionable_expression(node: &LintNode, settings: Settings) -> Option<bool> {
    let shape = TypeShape::of(node)?;
    let is_own_nullable = match node.kind.as_str() {
        "MemberExpression" => !is_member_expression_nullable_origin_from_object(node, settings),
        "CallExpression" => !is_call_expression_nullable_origin_from_callee(node),
        _ => true,
    };
    Some(shape.is_conditional_always_necessary() || (is_own_nullable && shape.is_nullable()))
}

/// `isMemberExpressionNullableOriginFromObject`. Missing per-part facts count
/// as the property's own nullability, which reports less.
fn is_member_expression_nullable_origin_from_object(node: &LintNode, settings: Settings) -> bool {
    let Some(previous) = node.child("object").and_then(TypeShape::of) else {
        return false;
    };
    let property_is_identifier = node
        .child("property")
        .is_some_and(|property| property.kind == "Identifier");
    if !previous.is_union() || !property_is_identifier {
        return false;
    }
    if node.field_bool("computed") == Some(true) {
        let Some(keys) = previous.keys() else {
            return false;
        };
        let mut is_own_nullable = false;
        for part in previous.union() {
            let Some(nullable) = part.is_nullable_property_type(&keys) else {
                return false;
            };
            is_own_nullable |= nullable;
        }
        return !is_own_nullable && previous.is_nullable();
    }
    let mut is_own_nullable = false;
    for part in previous.union() {
        let Some(member) = part.member() else {
            return false;
        };
        let nullable = if member.found {
            member.nullable
        } else {
            member
                .string_index_nullable
                .is_some_and(|nullable| nullable || settings.no_unchecked_indexed_access)
        };
        is_own_nullable |= nullable;
    }
    !is_own_nullable && previous.is_nullable()
}

/// `isCallExpressionNullableOriginFromCallee`.
fn is_call_expression_nullable_origin_from_callee(node: &LintNode) -> bool {
    let Some(previous) = node.child("callee").and_then(TypeShape::of) else {
        return false;
    };
    if !previous.is_union() {
        return false;
    }
    let mut is_own_nullable = false;
    for part in previous.union() {
        let Some(returns_nullable) = part.call_returns_nullable() else {
            return false;
        };
        is_own_nullable |= returns_nullable;
    }
    !is_own_nullable && previous.is_nullable()
}

/// `checkIfBoolExpressionIsNecessaryConditional`'s no-overlap branch
/// (strictNullChecks on).
pub(super) fn has_no_overlap(left: &LintNode, right: &LintNode, operator: &str) -> Option<bool> {
    let left = TypeShape::of(left)?;
    let right = TypeShape::of(right)?;
    let loose = matches!(operator, "==" | "!=");
    let comparable = |shape: TypeShape<'_>, mut mask: u32| {
        mask |= flags::ANY
            | flags::UNKNOWN
            | flags::TYPE_PARAMETER
            | flags::TYPE_VARIABLE
            | flags::CONDITIONAL;
        if loose {
            mask |= flags::NULL | flags::UNDEFINED | flags::VOID;
        }
        shape.has(mask)
    };
    Some(
        (left.flags() == flags::UNDEFINED && !comparable(right, flags::UNDEFINED | flags::VOID))
            || (right.flags() == flags::UNDEFINED
                && !comparable(left, flags::UNDEFINED | flags::VOID))
            || (left.flags() == flags::NULL && !comparable(right, flags::NULL))
            || (right.flags() == flags::NULL && !comparable(left, flags::NULL)),
    )
}

/// `isArrayMethodCallWithPredicate`'s type test on the callee object.
pub(super) fn is_array_or_tuple(node: &LintNode) -> bool {
    TypeShape::of(node).is_some_and(|shape| {
        shape
            .union()
            .iter()
            .flat_map(|part| part.intersection())
            .any(|part| part.is_array() || part.is_tuple())
    })
}

/// Truthiness of a callback's call-signature return types
/// (`hasTruthyReturnTypes`, `hasFalsyReturnTypes`), or `None` when any return
/// type is unknown, `any`, missing, or the callback has no signatures.
pub(super) fn callback_returns(callback: &LintNode) -> Option<(bool, bool)> {
    let returns = crate::lint::type_tree::context(callback)?
        .get("returns")?
        .as_array()?;
    if returns.is_empty() {
        return None;
    }
    let mut falsy = false;
    let mut truthy = false;
    for value in returns {
        let shape = TypeShape::from_value(value)?;
        if shape.has(flags::ANY | flags::UNKNOWN) || shape.flags() & flags::TYPE_PARAMETER != 0 {
            return None;
        }
        falsy |= shape.is_possibly_falsy();
        truthy |= shape.is_possibly_truthy();
        if falsy && truthy {
            return Some((true, true));
        }
    }
    Some((truthy, falsy))
}
