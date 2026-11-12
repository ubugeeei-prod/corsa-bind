//! Reader for the host `__typeShape` fact.
//!
//! typescript-eslint decides many checks on `getConstrainedTypeAtLocation`
//! plus raw `TypeFlags`. A host that can query the checker stamps a node with
//! `__typeShape`:
//!
//! ```json
//! {
//!   "flags": 134217728,          // flags of the constrained type
//!   "rawFlags": 524288,          // flags of the unconstrained type
//!   "value": "a",                // literal value of the constrained type
//!   "union": [                   // union constituents of the constrained type
//!     { "flags": 1024, "value": "a",
//!       "intersection": [{ "flags": 32 }],
//!       "array": false, "tuple": false,
//!       "member": { "found": true, "optional": false, "nullable": true },
//!       "callReturnsNullable": false }
//!   ],
//!   "member": { "found": true, "optional": true, "nullable": true }
//! }
//! ```
//!
//! Flags use the TypeScript 7 (typescript-go) `TypeFlags` numbering. Boolean
//! literal values are JSON booleans and bigint values are `{ "bigint": "-1" }`.
//! Rules fall back to rendered type texts when a node has no shape.

use serde_json::Value;

use super::LintNode;

/// TypeScript 7 `TypeFlags` (microsoft/typescript-go internal/checker/types.go).
pub(crate) mod flags {
    pub(crate) const ANY: u32 = 1;
    pub(crate) const UNKNOWN: u32 = 1 << 1;
    pub(crate) const UNDEFINED: u32 = 1 << 2;
    pub(crate) const NULL: u32 = 1 << 3;
    pub(crate) const VOID: u32 = 1 << 4;
    pub(crate) const STRING: u32 = 1 << 5;
    pub(crate) const NUMBER: u32 = 1 << 6;
    pub(crate) const BIGINT: u32 = 1 << 7;
    pub(crate) const BOOLEAN: u32 = 1 << 8;
    pub(crate) const STRING_LITERAL: u32 = 1 << 10;
    pub(crate) const NUMBER_LITERAL: u32 = 1 << 11;
    pub(crate) const BIGINT_LITERAL: u32 = 1 << 12;
    pub(crate) const BOOLEAN_LITERAL: u32 = 1 << 13;
    pub(crate) const ENUM_LITERAL: u32 = 1 << 15;
    pub(crate) const ENUM: u32 = 1 << 16;
    pub(crate) const NEVER: u32 = 1 << 18;
    pub(crate) const TYPE_PARAMETER: u32 = 1 << 19;
    pub(crate) const TEMPLATE_LITERAL: u32 = 1 << 22;
    pub(crate) const STRING_MAPPING: u32 = 1 << 23;
    pub(crate) const INDEXED_ACCESS: u32 = 1 << 25;
    pub(crate) const CONDITIONAL: u32 = 1 << 26;
    pub(crate) const UNION: u32 = 1 << 27;

    pub(crate) const TYPE_VARIABLE: u32 = TYPE_PARAMETER | INDEXED_ACCESS;
    pub(crate) const LITERAL: u32 = STRING_LITERAL | NUMBER_LITERAL | BIGINT_LITERAL;
    pub(crate) const STRING_LIKE: u32 = STRING | STRING_LITERAL | TEMPLATE_LITERAL | STRING_MAPPING;
    pub(crate) const NUMBER_LIKE: u32 = NUMBER | NUMBER_LITERAL | ENUM;
    pub(crate) const BIGINT_LIKE: u32 = BIGINT | BIGINT_LITERAL;
    pub(crate) const BOOLEAN_LIKE: u32 = BOOLEAN | BOOLEAN_LITERAL;
    pub(crate) const DEFINITELY_FALSY: u32 = STRING_LITERAL
        | NUMBER_LITERAL
        | BIGINT_LITERAL
        | BOOLEAN_LITERAL
        | VOID
        | UNDEFINED
        | NULL;
    pub(crate) const POSSIBLY_FALSY: u32 = DEFINITELY_FALSY | STRING | NUMBER | BIGINT | BOOLEAN;
    pub(crate) const NULLABLE: u32 = ANY | UNKNOWN | NULL | UNDEFINED | VOID;
}

/// A literal value as typescript-eslint's `getValueOfLiteralType` sees it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum StaticValue {
    Undefined,
    Null,
    Boolean(bool),
    Number(f64),
    String(String),
    BigInt(String),
}

/// One type (or union/intersection constituent) from the shape.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ShapeType<'a> {
    value: &'a Value,
}

impl<'a> ShapeType<'a> {
    pub(crate) fn flags(self) -> u32 {
        self.value
            .get("flags")
            .and_then(Value::as_u64)
            .and_then(|flags| u32::try_from(flags).ok())
            .unwrap_or(0)
    }

    pub(crate) fn has(self, mask: u32) -> bool {
        self.flags() & mask != 0
    }

    fn literal(self) -> Option<&'a Value> {
        self.value.get("value")
    }

    /// `tsutils.intersectionConstituents`: the parts of an intersection, or
    /// the type itself.
    pub(crate) fn intersection(self) -> Vec<ShapeType<'a>> {
        match self.value.get("intersection").and_then(Value::as_array) {
            Some(items) if !items.is_empty() => {
                items.iter().map(|value| ShapeType { value }).collect()
            }
            _ => vec![self],
        }
    }

    pub(crate) fn is_array(self) -> bool {
        self.value.get("array").and_then(Value::as_bool) == Some(true)
    }

    pub(crate) fn is_tuple(self) -> bool {
        self.value.get("tuple").and_then(Value::as_bool) == Some(true)
    }

    /// Property fact recorded for the member name the host was asked about.
    pub(crate) fn member(self) -> Option<MemberFact> {
        MemberFact::read(self.value.get("member")?)
    }

    /// Property facts per computed key (see [`TypeShape::keys`]); `None`
    /// entries are keys that are not string or number literals.
    pub(crate) fn keyed(self) -> Option<Vec<Option<MemberFact>>> {
        let items = self.value.get("keyed")?.as_array()?;
        Some(items.iter().map(MemberFact::read).collect())
    }

    /// `getTypeName` of each index signature key type.
    pub(crate) fn index_key_names(self) -> Vec<&'a str> {
        self.value
            .get("indexKeys")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default()
    }

    /// typescript-eslint `isNullablePropertyType(thisType, keyType)`.
    pub(crate) fn is_nullable_property_type(self, keys: &[ComputedKey<'_>]) -> Option<bool> {
        let keyed = self.keyed()?;
        let index_keys = self.index_key_names();
        Some(keys.iter().enumerate().any(|(index, key)| {
            if key.literal.is_some() {
                if let Some(Some(member)) = keyed.get(index) {
                    if member.found {
                        return member.nullable;
                    }
                }
            }
            index_keys.contains(&key.type_name)
        }))
    }

    pub(crate) fn call_returns_nullable(self) -> Option<bool> {
        self.value
            .get("callReturnsNullable")
            .and_then(Value::as_bool)
    }

    /// `tsutils.isFalsyType`.
    pub(crate) fn is_falsy(self) -> bool {
        if self.has(flags::UNDEFINED | flags::NULL | flags::VOID) {
            return true;
        }
        if self.has(flags::LITERAL) {
            return self.literal().is_some_and(|value| !literal_truthy(value));
        }
        self.has(flags::BOOLEAN_LITERAL) && self.literal().and_then(Value::as_bool) == Some(false)
    }

    /// typescript-eslint `isTruthyLiteral`.
    fn is_truthy_literal(self) -> bool {
        if self.has(flags::BOOLEAN_LITERAL) {
            return self.literal().and_then(Value::as_bool) == Some(true);
        }
        self.has(flags::LITERAL) && self.literal().is_some_and(literal_truthy)
    }

    /// `toStaticValue` from no-unnecessary-condition.
    pub(crate) fn static_value(self) -> Option<StaticValue> {
        let type_flags = self.flags();
        if type_flags & flags::BOOLEAN_LITERAL != 0 && type_flags & flags::UNION == 0 {
            return self
                .literal()
                .and_then(Value::as_bool)
                .map(StaticValue::Boolean);
        }
        if type_flags == flags::UNDEFINED {
            return Some(StaticValue::Undefined);
        }
        if type_flags == flags::NULL {
            return Some(StaticValue::Null);
        }
        if type_flags & flags::LITERAL == 0 {
            return None;
        }
        let value = self.literal()?;
        if type_flags & flags::BIGINT_LITERAL != 0 {
            return value
                .get("bigint")
                .and_then(Value::as_str)
                .map(|digits| StaticValue::BigInt(digits.to_owned()));
        }
        if type_flags & flags::STRING_LITERAL != 0 {
            return value
                .as_str()
                .map(|text| StaticValue::String(text.to_owned()));
        }
        value.as_f64().map(StaticValue::Number)
    }
}

fn literal_truthy(value: &Value) -> bool {
    match value {
        Value::String(text) => !text.is_empty(),
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::Bool(value) => *value,
        Value::Object(map) => map
            .get("bigint")
            .and_then(Value::as_str)
            .is_some_and(|digits| digits.trim_start_matches('-') != "0"),
        _ => false,
    }
}

/// One constituent of a computed member key type.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ComputedKey<'a> {
    /// The property name a string or number literal key reads.
    pub(crate) literal: Option<&'a str>,
    /// typescript-eslint `getTypeName` of the key type.
    pub(crate) type_name: &'a str,
}

/// Property facts: `getPropertyOfType` plus the string index signature.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct MemberFact {
    pub(crate) found: bool,
    pub(crate) optional: bool,
    pub(crate) nullable: bool,
    /// `isPossiblyNonNullish` of the property type.
    pub(crate) non_nullish: bool,
    /// `Some(nullable)` when the type has a string index signature.
    pub(crate) string_index_nullable: Option<bool>,
}

impl MemberFact {
    fn read(value: &Value) -> Option<Self> {
        Some(Self {
            found: value.get("found")?.as_bool()?,
            optional: value.get("optional").and_then(Value::as_bool) == Some(true),
            nullable: value.get("nullable").and_then(Value::as_bool) == Some(true),
            non_nullish: value.get("nonNullish").and_then(Value::as_bool) != Some(false),
            string_index_nullable: value.get("stringIndexNullable").and_then(Value::as_bool),
        })
    }
}

/// The constrained type of one node.
#[derive(Clone, Copy, Debug)]
pub(crate) struct TypeShape<'a> {
    value: &'a Value,
}

impl<'a> TypeShape<'a> {
    pub(crate) fn of(node: &'a LintNode) -> Option<Self> {
        Self::from_value(node.fields.get("__typeShape")?)
    }

    /// A shape nested in another fact (for example a callback's return types).
    pub(crate) fn from_value(value: &'a Value) -> Option<Self> {
        value.get("flags")?.as_u64()?;
        Some(Self { value })
    }

    /// The constrained type itself (not its union parts).
    pub(crate) fn root(self) -> ShapeType<'a> {
        ShapeType { value: self.value }
    }

    pub(crate) fn flags(self) -> u32 {
        self.root().flags()
    }

    pub(crate) fn raw_flags(self) -> u32 {
        self.value
            .get("rawFlags")
            .and_then(Value::as_u64)
            .and_then(|flags| u32::try_from(flags).ok())
            .unwrap_or_else(|| self.flags())
    }

    /// The unconstrained type (`getTypeAtLocation`): the host's `raw` parts
    /// when it had to constrain the type, else the shape itself. `None` when
    /// the type was constrained but its own parts were not sent.
    pub(crate) fn raw(self) -> Option<Self> {
        match self.value.get("raw") {
            Some(raw) if raw.get("flags").is_some() => Some(Self { value: raw }),
            _ if self.is_constrained() => None,
            _ => Some(self),
        }
    }

    /// The host replaced the expression's type with its base constraint.
    pub(crate) fn is_constrained(self) -> bool {
        self.value.get("constrained").and_then(Value::as_bool) == Some(true)
    }

    /// `isEnumMemberType`: some union or intersection constituent is an enum
    /// member (literal enum members carry `EnumLiteral`).
    pub(crate) fn has_enum_member_constituent(self) -> bool {
        self.root().has(flags::ENUM_LITERAL | flags::ENUM)
            || self.union().iter().any(|part| {
                part.intersection()
                    .iter()
                    .any(|part| part.has(flags::ENUM_LITERAL | flags::ENUM))
            })
    }

    pub(crate) fn is_union(self) -> bool {
        self.flags() & flags::UNION != 0
    }

    /// `tsutils.unionConstituents`.
    pub(crate) fn union(self) -> Vec<ShapeType<'a>> {
        match self.value.get("union").and_then(Value::as_array) {
            Some(items) if !items.is_empty() => {
                items.iter().map(|value| ShapeType { value }).collect()
            }
            _ => vec![self.root()],
        }
    }

    /// Property fact for the whole (constrained) type.
    pub(crate) fn member(self) -> Option<MemberFact> {
        self.root().member()
    }

    /// Constituents of the computed key this object is indexed with.
    pub(crate) fn keys(self) -> Option<Vec<ComputedKey<'a>>> {
        let items = self.value.get("keys")?.as_array()?;
        items
            .iter()
            .map(|item| {
                Some(ComputedKey {
                    literal: item.get("key").and_then(Value::as_str),
                    type_name: item.get("typeName")?.as_str()?,
                })
            })
            .collect()
    }

    /// typescript-eslint `isTypeFlagSet`: the flags of every union part.
    pub(crate) fn has(self, mask: u32) -> bool {
        self.flags() & mask != 0 || self.union().iter().any(|part| part.has(mask))
    }

    /// no-unnecessary-condition `isConditionalAlwaysNecessary`.
    pub(crate) fn is_conditional_always_necessary(self) -> bool {
        self.union().iter().any(|part| {
            part.has(flags::ANY | flags::UNKNOWN | flags::TYPE_VARIABLE | flags::CONDITIONAL)
        })
    }

    /// typescript-eslint `isPossiblyFalsy`.
    pub(crate) fn is_possibly_falsy(self) -> bool {
        self.union()
            .iter()
            .flat_map(|part| part.intersection())
            .filter(|part| !part.is_truthy_literal())
            .any(|part| part.has(flags::POSSIBLY_FALSY))
    }

    /// typescript-eslint `isPossiblyTruthy`.
    pub(crate) fn is_possibly_truthy(self) -> bool {
        self.union()
            .iter()
            .any(|part| part.intersection().iter().all(|part| !part.is_falsy()))
    }

    /// no-unnecessary-condition `isPossiblyNullish`.
    pub(crate) fn is_possibly_nullish(self) -> bool {
        self.union()
            .iter()
            .any(|part| part.has(flags::UNDEFINED | flags::NULL | flags::VOID))
    }

    /// no-unnecessary-condition `isAlwaysNullish`.
    pub(crate) fn is_always_nullish(self) -> bool {
        self.union()
            .iter()
            .all(|part| part.has(flags::UNDEFINED | flags::NULL))
    }

    /// typescript-eslint `isNullableType`.
    pub(crate) fn is_nullable(self) -> bool {
        self.has(flags::NULLABLE)
    }

    /// typescript-eslint `isStringLike`.
    pub(crate) fn is_string_like(self) -> bool {
        self.union().iter().all(|part| {
            part.intersection()
                .iter()
                .any(|part| part.has(flags::STRING_LIKE))
        })
    }

    /// no-unnecessary-type-conversion `doesUnderlyingTypeMatchFlag`.
    pub(crate) fn every_union_part_has(self, mask: u32) -> bool {
        self.union().iter().all(|part| part.has(mask))
    }

    pub(crate) fn static_value(self) -> Option<StaticValue> {
        self.root().static_value()
    }

    /// Every union part is a number literal with an integer value.
    pub(crate) fn every_union_part_is_integer_literal(self) -> bool {
        self.union().iter().all(|part| {
            part.has(flags::NUMBER_LITERAL)
                && part
                    .literal()
                    .and_then(Value::as_f64)
                    .is_some_and(|value| value.fract() == 0.0)
        })
    }
}
