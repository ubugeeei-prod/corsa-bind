//! Reader for checker type details a host attaches as `__typeDetail` (and in
//! signature facts): TypeScript 7 `TypeFlags`, union constituents, the enum an
//! enum literal belongs to, and the base constraint of a generic type.
//!
//! typescript-eslint decides most `no-unsafe-*` and enum questions on
//! `ts.Type` flags. Rendered type text cannot tell `any` from an alias named
//! `any`-something, a string enum from a string, or a type parameter from its
//! constraint, so rules prefer these details when the host provides them.

use serde_json::Value;

use super::LintNode;

/// TypeScript 7 `TypeFlags` (microsoft/typescript-go internal/checker/types.go).
pub(super) mod flags {
    pub(in crate::lint) const ANY: u32 = 1;
    pub(in crate::lint) const UNKNOWN: u32 = 1 << 1;
    pub(in crate::lint) const NUMBER_LITERAL: u32 = 1 << 11;
    pub(in crate::lint) const ENUM_LITERAL: u32 = 1 << 15;
    pub(in crate::lint) const NEVER: u32 = 1 << 18;
    pub(in crate::lint) const NUMBER_LIKE: u32 = 67_648;
    pub(in crate::lint) const BIGINT_LIKE: u32 = 4_224;
    pub(in crate::lint) const STRING_LIKE: u32 = 12_583_968;
    pub(in crate::lint) const ENUM_LIKE: u32 = 98_304;
}

/// A type name for a message: the first rendered text in backticks (or `any`
/// when nothing was rendered), as typescript-eslint's `typeToString` data.
pub(super) fn quoted_type<T: AsRef<str>>(texts: &[T]) -> String {
    let text = texts
        .first()
        .map(|text| text.as_ref().trim())
        .filter(|text| !text.is_empty())
        .unwrap_or("any");
    format!("`{text}`")
}

/// TypeScript 7 `ObjectFlags.Reference`.
const REFERENCE: u64 = 1 << 2;
/// Nesting bound for [`is_unsafe_assignment`].
const MAX_ASSIGNMENT_DEPTH: usize = 8;

/// typescript-eslint `isUnsafeAssignment`: an `any` flowing into a receiver
/// that is neither `any` nor `unknown`, or (for two references to the same
/// generic target) such an `any` in a corresponding type argument.
/// `new Map()` without arguments is exempt, because the lib types it
/// `Map<any, any>`.
pub(super) fn is_unsafe_assignment(
    sender: TypeDetail<'_>,
    receiver: TypeDetail<'_>,
    sender_node: Option<&LintNode>,
) -> bool {
    unsafe_assignment_at(sender, receiver, sender_node, 0)
}

fn unsafe_assignment_at(
    sender: TypeDetail<'_>,
    receiver: TypeDetail<'_>,
    sender_node: Option<&LintNode>,
    depth: usize,
) -> bool {
    if sender.is_any() {
        if receiver.is_unknown() {
            return false;
        }
        if !receiver.is_any() {
            return true;
        }
    }
    if depth >= MAX_ASSIGNMENT_DEPTH || !sender.is_reference() || !receiver.is_reference() {
        return false;
    }
    if sender.target().is_none() || sender.target() != receiver.target() {
        return false;
    }
    if sender_node.is_some_and(is_empty_map_construction) {
        return false;
    }
    let receiver_arguments = receiver.type_arguments();
    sender
        .type_arguments()
        .into_iter()
        .zip(receiver_arguments)
        .any(|(sender, receiver)| unsafe_assignment_at(sender, receiver, sender_node, depth + 1))
}

fn is_empty_map_construction(node: &LintNode) -> bool {
    node.kind == "NewExpression"
        && node.child("callee").is_some_and(|callee| {
            callee.kind == "Identifier" && callee.field_str("name") == Some("Map")
        })
        && node
            .child_list("arguments")
            .is_none_or(<[LintNode]>::is_empty)
        && node.child("typeArguments").is_none()
}

/// One union constituent of a [`TypeDetail`].
#[derive(Clone, Copy, Debug)]
pub(super) struct TypePart<'a> {
    /// The constituent's own flags.
    pub flags: u32,
    /// Flags of every intersection constituent OR-ed together (the part's own
    /// flags when it is not an intersection).
    pub member_flags: u32,
    /// Checker identity of the constituent.
    pub id: &'a str,
    /// Checker identity of the enum type an enum literal belongs to.
    pub enum_id: Option<&'a str>,
    /// Rendered name of that enum type.
    pub enum_text: Option<&'a str>,
}

impl TypePart<'_> {
    /// typescript-eslint `getEnumValueType`: which primitive an enum-like
    /// constituent stands for.
    pub(super) fn enum_value_kind(self) -> Option<EnumValueKind> {
        if self.flags & flags::ENUM_LIKE == 0 {
            None
        } else if self.flags & flags::NUMBER_LITERAL != 0 {
            Some(EnumValueKind::Number)
        } else {
            Some(EnumValueKind::String)
        }
    }
}

/// Primitive kind of an enum value.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum EnumValueKind {
    Number,
    String,
}

/// A checker type detail value.
#[derive(Clone, Copy, Debug)]
pub(super) struct TypeDetail<'a> {
    value: &'a Value,
}

impl<'a> TypeDetail<'a> {
    /// The detail of the type at `node`, when the host attached one.
    pub(super) fn of(node: &'a LintNode) -> Option<Self> {
        node.fields.get("__typeDetail").and_then(Self::from_value)
    }

    /// Reads a detail object (`{ id, flags, parts, constraint? }`).
    pub(super) fn from_value(value: &'a Value) -> Option<Self> {
        value.get("flags")?.as_u64()?;
        Some(Self { value })
    }

    /// The type's own flags.
    pub(super) fn flags(self) -> u32 {
        self.value
            .get("flags")
            .and_then(Value::as_u64)
            .and_then(|flags| u32::try_from(flags).ok())
            .unwrap_or(0)
    }

    /// Checker identity of the type.
    pub(super) fn id(self) -> Option<&'a str> {
        self.value.get("id").and_then(Value::as_str)
    }

    /// Union constituents (the type itself when it is not a union).
    pub(super) fn parts(self) -> Vec<TypePart<'a>> {
        self.value
            .get("parts")
            .and_then(Value::as_array)
            .map(|parts| parts.iter().filter_map(read_part).collect())
            .unwrap_or_default()
    }

    /// typescript-eslint `getConstrainedTypeAtLocation`: the base constraint of
    /// a generic type, or the type itself.
    pub(super) fn constrained(self) -> Self {
        self.value
            .get("constraint")
            .and_then(Self::from_value)
            .unwrap_or(self)
    }

    /// Flags of every union constituent OR-ed together (typescript-eslint's
    /// `isTypeFlagSet`).
    pub(super) fn union_flags(self) -> u32 {
        self.parts()
            .iter()
            .fold(self.flags(), |flags, part| flags | part.flags)
    }

    /// typescript-eslint `isTypeAnyType`.
    pub(super) fn is_any(self) -> bool {
        self.union_flags() & flags::ANY != 0
    }

    /// typescript-eslint `isTypeUnknownType`.
    pub(super) fn is_unknown(self) -> bool {
        self.union_flags() & flags::UNKNOWN != 0
    }

    /// typescript-eslint `isNumberLike`: every union constituent has a
    /// number-like intersection constituent.
    pub(super) fn is_number_like(self) -> bool {
        self.every_part_has(flags::NUMBER_LIKE)
    }

    /// typescript-eslint `isStringLike`.
    pub(super) fn is_string_like(self) -> bool {
        self.every_part_has(flags::STRING_LIKE)
    }

    /// typescript-eslint `getEnumTypes`: the enums of the enum-literal
    /// constituents.
    pub(super) fn enum_ids(self) -> Vec<&'a str> {
        let mut ids = Vec::new();
        for part in self.parts() {
            if part.flags & flags::ENUM_LITERAL == 0 {
                continue;
            }
            if let Some(id) = part.enum_id.or(Some(part.id)) {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        ids
    }

    /// A generic instantiation (`ObjectFlags.Reference`), including arrays and
    /// tuples.
    pub(super) fn is_reference(self) -> bool {
        self.value
            .get("objectFlags")
            .and_then(Value::as_u64)
            .is_some_and(|flags| flags & REFERENCE != 0)
    }

    /// The generic target of a type reference.
    pub(super) fn target(self) -> Option<&'a str> {
        self.value.get("target").and_then(Value::as_str)
    }

    /// Type arguments of a type reference (tuple element types for a tuple).
    pub(super) fn type_arguments(self) -> Vec<TypeDetail<'a>> {
        self.value
            .get("typeArguments")
            .and_then(Value::as_array)
            .map(|arguments| arguments.iter().filter_map(Self::from_value).collect())
            .unwrap_or_default()
    }

    /// Rendered text of a type reference.
    pub(super) fn reference_text(self) -> Option<&'a str> {
        self.value.get("text").and_then(Value::as_str)
    }

    /// A `Promise<T>` / `PromiseLike<T>` reference.
    pub(super) fn is_promise(self) -> bool {
        self.is_reference()
            && self.reference_text().is_some_and(|text| {
                text.starts_with("Promise<") || text.starts_with("PromiseLike<")
            })
    }

    /// `checker.getAwaitedType` for the `Promise<T>` references the host
    /// describes (recursively); any other type awaits to itself.
    pub(super) fn awaited(self) -> Self {
        let mut current = self;
        for _ in 0..MAX_ASSIGNMENT_DEPTH {
            if !current.is_promise() {
                break;
            }
            match current.type_arguments().first() {
                Some(argument) => current = *argument,
                None => break,
            }
        }
        current
    }

    /// `checker.isArrayType`.
    pub(super) fn is_array(self) -> bool {
        self.value.get("isArray").and_then(Value::as_bool) == Some(true)
    }

    /// `checker.isTupleType`.
    pub(super) fn is_tuple(self) -> bool {
        self.value.get("isTuple").and_then(Value::as_bool) == Some(true)
    }

    /// typescript-eslint `isTypeAnyArrayType`: `any[]`.
    pub(super) fn is_any_array(self) -> bool {
        self.is_array()
            && self
                .type_arguments()
                .first()
                .is_some_and(|element| element.is_any())
    }

    /// typescript-eslint `isTypeUnknownArrayType`: `unknown[]`.
    pub(super) fn is_unknown_array(self) -> bool {
        self.is_array()
            && self
                .type_arguments()
                .first()
                .is_some_and(|element| element.is_unknown())
    }

    /// Rendered names of [`Self::enum_ids`], for messages.
    pub(super) fn enum_names(self) -> Vec<&'a str> {
        let mut names = Vec::new();
        for part in self.parts() {
            if part.flags & flags::ENUM_LITERAL == 0 {
                continue;
            }
            if let Some(name) = part.enum_text {
                if !names.contains(&name) {
                    names.push(name);
                }
            }
        }
        names
    }

    fn every_part_has(self, mask: u32) -> bool {
        let parts = self.parts();
        !parts.is_empty() && parts.iter().all(|part| part.member_flags & mask != 0)
    }
}

fn read_part(value: &Value) -> Option<TypePart<'_>> {
    let flags = u32::try_from(value.get("flags")?.as_u64()?).ok()?;
    Some(TypePart {
        flags,
        member_flags: value
            .get("memberFlags")
            .and_then(Value::as_u64)
            .and_then(|flags| u32::try_from(flags).ok())
            .unwrap_or(flags),
        id: value.get("id").and_then(Value::as_str).unwrap_or_default(),
        enum_id: value.get("enumId").and_then(Value::as_str),
        enum_text: value.get("enumText").and_then(Value::as_str),
    })
}

/// A `{ texts, detail }` pair from signature facts.
#[derive(Clone, Copy, Debug)]
pub(super) struct DescribedType<'a> {
    value: &'a Value,
}

impl<'a> DescribedType<'a> {
    pub(super) fn from_value(value: &'a Value) -> Option<Self> {
        value.get("detail")?;
        Some(Self { value })
    }

    /// Rendered type texts.
    pub(super) fn texts(self) -> Vec<&'a str> {
        self.value
            .get("texts")
            .and_then(Value::as_array)
            .map(|texts| texts.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    }

    /// The checker detail.
    pub(super) fn detail(self) -> Option<TypeDetail<'a>> {
        self.value.get("detail").and_then(TypeDetail::from_value)
    }
}

/// Resolved parameter types of a call (`__callParameters`).
#[derive(Clone, Copy, Debug)]
pub(super) struct CallParameters<'a> {
    value: &'a Value,
}

impl<'a> CallParameters<'a> {
    pub(super) fn of(node: &'a LintNode) -> Option<Self> {
        let value = node.fields.get("__callParameters")?;
        value.get("positions")?.as_array()?;
        Some(Self { value })
    }

    /// The parameter type at argument position `index`, rest parameters
    /// expanded. `None` past the last parameter of a signature without rest.
    pub(super) fn at(self, index: usize) -> Option<DescribedType<'a>> {
        self.value
            .get("positions")
            .and_then(Value::as_array)
            .and_then(|positions| positions.get(index))
            .and_then(DescribedType::from_value)
    }
}

/// Return types of the enclosing function's signatures (`__functionReturns`).
#[derive(Clone, Debug)]
pub(super) struct FunctionReturns<'a> {
    /// One entry per call signature of the function (or its contextual type).
    pub signatures: Vec<DescribedType<'a>>,
    /// The function's own signatures, whatever its context.
    pub own_signatures: Vec<DescribedType<'a>>,
    /// The function has an explicit return type annotation.
    pub has_return_type: bool,
    /// The function is `async`.
    pub is_async: bool,
}

impl<'a> FunctionReturns<'a> {
    pub(super) fn of(node: &'a LintNode) -> Option<Self> {
        let value = node.fields.get("__functionReturns")?;
        let read = |key: &str| -> Option<Vec<DescribedType<'a>>> {
            Some(
                value
                    .get(key)?
                    .as_array()?
                    .iter()
                    .filter_map(DescribedType::from_value)
                    .collect(),
            )
        };
        let signatures = read("signatures")?;
        let own_signatures = read("ownSignatures").unwrap_or_else(|| signatures.clone());
        Some(Self {
            signatures,
            own_signatures,
            has_return_type: node.field_bool("__functionHasReturnType").unwrap_or(false),
            is_async: node.field_bool("__functionIsAsync").unwrap_or(false),
        })
    }
}
