//! Structural type facts a host attaches as `__typeTree`.
//!
//! Rendered type text cannot tell a type parameter from an interface, a
//! branded primitive from an object, or where a `toString` came from. Hosts
//! that can query the checker attach a small tree instead:
//!
//! ```json
//! { "id": "17", "flags": 1048576, "objectFlags": 4, "text": "Foo<T>",
//!   "types": [..], "constraint": {..}, "arrayElement": {..},
//!   "tupleElements": [..], "callable": false, "toString": true,
//!   "bases": ["Error"], "symbol": "Foo", "lib": false }
//! ```
//!
//! `flags` are TypeScript 7 `TypeFlags`. Every field except `flags` is
//! optional; a missing field means "unknown", never "absent".

use serde_json::Value;

use super::LintNode;

/// TypeScript 7 `TypeFlags` (microsoft/typescript-go `internal/checker/types.go`).
#[allow(dead_code, reason = "complete flag table for rules that read shapes")]
pub(crate) mod flags {
    pub(crate) const ANY: u32 = 1 << 0;
    pub(crate) const UNKNOWN: u32 = 1 << 1;
    pub(crate) const UNDEFINED: u32 = 1 << 2;
    pub(crate) const NULL: u32 = 1 << 3;
    pub(crate) const VOID: u32 = 1 << 4;
    pub(crate) const STRING: u32 = 1 << 5;
    pub(crate) const NUMBER: u32 = 1 << 6;
    pub(crate) const BIGINT: u32 = 1 << 7;
    pub(crate) const BOOLEAN: u32 = 1 << 8;
    pub(crate) const ES_SYMBOL: u32 = 1 << 9;
    pub(crate) const STRING_LITERAL: u32 = 1 << 10;
    pub(crate) const NUMBER_LITERAL: u32 = 1 << 11;
    pub(crate) const BIGINT_LITERAL: u32 = 1 << 12;
    pub(crate) const BOOLEAN_LITERAL: u32 = 1 << 13;
    pub(crate) const UNIQUE_ES_SYMBOL: u32 = 1 << 14;
    pub(crate) const ENUM_LITERAL: u32 = 1 << 15;
    pub(crate) const ENUM: u32 = 1 << 16;
    pub(crate) const NON_PRIMITIVE: u32 = 1 << 17;
    pub(crate) const NEVER: u32 = 1 << 18;
    pub(crate) const TYPE_PARAMETER: u32 = 1 << 19;
    pub(crate) const OBJECT: u32 = 1 << 20;
    pub(crate) const INDEX: u32 = 1 << 21;
    pub(crate) const TEMPLATE_LITERAL: u32 = 1 << 22;
    pub(crate) const STRING_MAPPING: u32 = 1 << 23;
    pub(crate) const SUBSTITUTION: u32 = 1 << 24;
    pub(crate) const INDEXED_ACCESS: u32 = 1 << 25;
    pub(crate) const CONDITIONAL: u32 = 1 << 26;
    pub(crate) const UNION: u32 = 1 << 27;
    pub(crate) const INTERSECTION: u32 = 1 << 28;

    pub(crate) const STRING_LIKE: u32 = STRING | STRING_LITERAL | TEMPLATE_LITERAL | STRING_MAPPING;
    pub(crate) const NUMBER_LIKE: u32 = NUMBER | NUMBER_LITERAL | ENUM;
    pub(crate) const BIGINT_LIKE: u32 = BIGINT | BIGINT_LITERAL;
    pub(crate) const BOOLEAN_LIKE: u32 = BOOLEAN | BOOLEAN_LITERAL;
    pub(crate) const ES_SYMBOL_LIKE: u32 = ES_SYMBOL | UNIQUE_ES_SYMBOL;
    pub(crate) const VOID_LIKE: u32 = VOID | UNDEFINED;
}

/// One checker type, as described by the host.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TypeTree {
    pub id: Option<String>,
    pub flags: u32,
    pub object_flags: u32,
    pub text: String,
    pub types: Vec<TypeTree>,
    pub constraint: Option<Box<TypeTree>>,
    pub array_element: Option<Box<TypeTree>>,
    pub tuple_elements: Option<Vec<TypeTree>>,
    pub callable: Option<bool>,
    /// typescript-eslint's `isToStringLikeFromObject`: `Some(Some(true))` when
    /// every coercion method comes from `interface Object`, `Some(Some(false))`
    /// when the type declares its own, `Some(None)` when none resolves and
    /// `None` when the host did not say.
    pub to_string: Option<Option<bool>>,
    pub bases: Vec<String>,
    pub symbol: Option<String>,
    pub lib: Option<bool>,
    pub constructable: Option<bool>,
    pub symbol_constructable: Option<bool>,
    pub property_count: Option<u64>,
    pub iterable: Option<bool>,
    pub symbol_flags: Option<u32>,
}

impl TypeTree {
    /// Reads the `__typeTree` the host attached to `node`.
    pub(crate) fn of(node: &LintNode) -> Option<Self> {
        Self::parse(node.fields.get("__typeTree")?)
    }

    pub(crate) fn parse(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let flags = u32::try_from(object.get("flags")?.as_u64()?).ok()?;
        let list = |key: &str| -> Option<Vec<Self>> {
            object
                .get(key)?
                .as_array()
                .map(|items| items.iter().filter_map(Self::parse).collect())
        };
        let single = |key: &str| object.get(key).and_then(Self::parse).map(Box::new);
        Some(Self {
            id: object.get("id").and_then(Value::as_str).map(str::to_owned),
            flags,
            object_flags: object
                .get("objectFlags")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok())
                .unwrap_or(0),
            text: object
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            types: list("types").unwrap_or_default(),
            constraint: single("constraint"),
            array_element: single("arrayElement"),
            tuple_elements: list("tupleElements"),
            callable: object.get("callable").and_then(Value::as_bool),
            to_string: object.get("toString").map(Value::as_bool),
            bases: object
                .get("bases")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
            symbol: object
                .get("symbol")
                .and_then(Value::as_str)
                .map(str::to_owned),
            lib: object.get("lib").and_then(Value::as_bool),
            constructable: object.get("constructable").and_then(Value::as_bool),
            symbol_constructable: object.get("symbolConstructable").and_then(Value::as_bool),
            property_count: object.get("propertyCount").and_then(Value::as_u64),
            iterable: object.get("iterable").and_then(Value::as_bool),
            symbol_flags: object
                .get("symbolFlags")
                .and_then(Value::as_u64)
                .and_then(|value| u32::try_from(value).ok()),
        })
    }

    /// A synthesized intrinsic type, for example the base type of a literal.
    pub(crate) fn intrinsic(flags: u32, text: &str) -> Self {
        Self {
            id: Some(format!("intrinsic:{text}")),
            flags,
            text: text.to_owned(),
            ..Self::default()
        }
    }

    /// `tsutils.isTypeFlagSet(type, mask)`.
    pub(crate) fn has(&self, mask: u32) -> bool {
        self.flags & mask != 0
    }

    pub(crate) fn is_union(&self) -> bool {
        self.has(flags::UNION)
    }

    pub(crate) fn is_intersection(&self) -> bool {
        self.has(flags::INTERSECTION)
    }

    /// `tsutils.unionConstituents(type)`.
    pub(crate) fn union_parts(&self) -> Vec<&Self> {
        if self.is_union() && !self.types.is_empty() {
            self.types.iter().collect()
        } else {
            vec![self]
        }
    }

    /// Whether union/intersection constituents are known. A union without
    /// listed constituents cannot be inspected part by part.
    pub(crate) fn parts_known(&self) -> bool {
        !(self.is_union() || self.is_intersection()) || !self.types.is_empty()
    }

    /// `isTypeFlagSetInUnion(type, mask)`.
    pub(crate) fn has_in_union(&self, mask: u32) -> bool {
        self.union_parts().iter().any(|part| part.has(mask))
    }

    /// typescript-eslint's `getConstrainedTypeAtLocation`: the base constraint
    /// of a generic type, the type itself otherwise. Unions and intersections
    /// map their constituents.
    pub(crate) fn constrained(&self) -> Self {
        if let Some(constraint) = &self.constraint {
            return constraint.constrained();
        }
        if (self.is_union() || self.is_intersection())
            && self.types.iter().any(|part| part.constraint.is_some())
        {
            let mut constrained = self.clone();
            constrained.id = None;
            constrained.types = Vec::new();
            for part in &self.types {
                let part = part.constrained();
                if self.is_union() && part.is_union() {
                    constrained.types.extend(part.types);
                } else {
                    constrained.types.push(part);
                }
            }
            return constrained;
        }
        self.clone()
    }

    /// `checker.getBaseTypeOfLiteralType(type)`.
    pub(crate) fn base_of_literal(&self) -> Self {
        if self.has(flags::ENUM_LITERAL | flags::ENUM) {
            return self.clone();
        }
        if self.has(flags::STRING_LITERAL | flags::TEMPLATE_LITERAL | flags::STRING_MAPPING) {
            return Self::intrinsic(flags::STRING, "string");
        }
        if self.has(flags::NUMBER_LITERAL) {
            return Self::intrinsic(flags::NUMBER, "number");
        }
        if self.has(flags::BIGINT_LITERAL) {
            return Self::intrinsic(flags::BIGINT, "bigint");
        }
        if self.has(flags::BOOLEAN_LITERAL) {
            return Self::boolean();
        }
        if self.is_union() && !self.types.is_empty() {
            let mut parts: Vec<Self> = Vec::new();
            for part in &self.types {
                let base = part.base_of_literal();
                // `boolean` stays one part, as TypeScript renders it.
                let base_parts =
                    if base.is_union() && !base.types.is_empty() && base.text != "boolean" {
                        base.types.clone()
                    } else {
                        vec![base]
                    };
                for base in base_parts {
                    if !parts.iter().any(|existing| existing.same_type(&base)) {
                        parts.push(base);
                    }
                }
            }
            if parts.len() == 1 {
                return parts.remove(0);
            }
            let mut union = self.clone();
            if parts != self.types {
                union.id = None;
                union.text = parts
                    .iter()
                    .map(|part| part.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" | ");
            }
            union.types = parts;
            return union;
        }
        self.clone()
    }

    /// TypeScript's `boolean`: the union `false | true`.
    fn boolean() -> Self {
        Self {
            id: Some("intrinsic:boolean".to_owned()),
            flags: flags::BOOLEAN | flags::UNION,
            text: "boolean".to_owned(),
            types: vec![
                Self::intrinsic(flags::BOOLEAN_LITERAL, "false"),
                Self::intrinsic(flags::BOOLEAN_LITERAL, "true"),
            ],
            ..Self::default()
        }
    }

    /// Type identity: the same checker type, or the same intrinsic.
    pub(crate) fn same_type(&self, other: &Self) -> bool {
        const INTRINSIC: u32 = flags::ANY
            | flags::UNKNOWN
            | flags::UNDEFINED
            | flags::NULL
            | flags::VOID
            | flags::STRING
            | flags::NUMBER
            | flags::BIGINT
            | flags::ES_SYMBOL
            | flags::NEVER
            | flags::NON_PRIMITIVE;
        if self.flags == other.flags && self.flags & INTRINSIC != 0 && self.flags & !INTRINSIC == 0
        {
            return true;
        }
        if self.text == "boolean" && other.text == "boolean" && self.has(flags::BOOLEAN) {
            return other.has(flags::BOOLEAN);
        }
        match (&self.id, &other.id) {
            (Some(left), Some(right)) => left == right,
            _ => false,
        }
    }

    /// `tsutils.isObjectType(type)`.
    pub(crate) fn is_object(&self) -> bool {
        self.has(flags::OBJECT)
    }
}

/// Reads the host's `__typeFlags` for a node.
pub(crate) fn node_type_flags(node: &LintNode) -> Option<u32> {
    node.fields
        .get("__typeFlags")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{TypeTree, flags};

    fn shape(value: serde_json::Value) -> TypeTree {
        TypeTree::parse(&value).expect("valid shape")
    }

    #[test]
    fn constrained_follows_type_parameter_constraints() {
        let parameter = shape(json!({
            "id": "7", "flags": flags::TYPE_PARAMETER, "text": "T",
            "constraint": { "id": "1", "flags": flags::STRING, "text": "string" }
        }));
        assert!(parameter.constrained().has(flags::STRING));

        let union = shape(json!({
            "id": "9", "flags": flags::UNION, "text": "T | number",
            "types": [
                { "id": "7", "flags": flags::TYPE_PARAMETER, "text": "T",
                  "constraint": { "id": "1", "flags": flags::STRING, "text": "string" } },
                { "id": "2", "flags": flags::NUMBER, "text": "number" }
            ]
        }));
        let constrained = union.constrained();
        assert!(
            constrained
                .union_parts()
                .iter()
                .all(|part| !part.has(flags::TYPE_PARAMETER))
        );
    }

    #[test]
    fn base_of_literal_widens_literals_and_template_literals() {
        let literal = shape(json!({ "id": "3", "flags": flags::STRING_LITERAL, "text": "\"a\"" }));
        let template =
            shape(json!({ "id": "4", "flags": flags::TEMPLATE_LITERAL, "text": "`a${string}`" }));
        assert!(
            literal
                .base_of_literal()
                .same_type(&template.base_of_literal())
        );

        let union = shape(json!({
            "id": "5", "flags": flags::UNION, "text": "1 | 2",
            "types": [
                { "id": "6", "flags": flags::NUMBER_LITERAL, "text": "1" },
                { "id": "8", "flags": flags::NUMBER_LITERAL, "text": "2" }
            ]
        }));
        let base = union.base_of_literal();
        assert!(!base.is_union());
        assert!(base.has(flags::NUMBER));
    }

    #[test]
    fn unknown_constituents_are_reported_as_unknown() {
        let union = shape(json!({ "id": "5", "flags": flags::UNION, "text": "A | B" }));
        assert!(!union.parts_known());
        let missing = TypeTree::parse(&json!({ "text": "no flags" }));
        assert!(missing.is_none());
    }
}
