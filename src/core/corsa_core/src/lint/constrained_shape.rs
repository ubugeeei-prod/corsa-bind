//! The union/intersection structure of a node's base-constrained type
//! (`getConstrainedTypeAtLocation`), read from the host's `__type` fact (see
//! [`super::type_tree`]): its `types`, and per type `array`, `tuple`,
//! `numberIndex` and `numberLength`. Rules read verdicts from it instead of
//! type text.
use serde_json::Value;

use super::LintNode;
use super::type_tree::{constrained_fact, fact};

/// TypeScript 7 `TypeFlags.Union` and `TypeFlags.Intersection`.
const UNION: u64 = 1 << 27;
const INTERSECTION: u64 = 1 << 28;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ConstrainedShape<'a>(&'a Value);

impl<'a> ConstrainedShape<'a> {
    /// The node's shape, when the host reported one.
    pub(crate) fn of(node: &'a LintNode) -> Option<Self> {
        // `getBaseConstraintOfType` answers for any type that has one.
        fact(node).map(|value| Self(constrained_fact(value, u32::MAX)))
    }

    fn flag(self, key: &str) -> bool {
        self.0.get(key).and_then(Value::as_bool).unwrap_or(false)
    }

    fn type_flags(self) -> u64 {
        self.0.get("flags").and_then(Value::as_u64).unwrap_or(0)
    }

    pub(crate) fn is_union(self) -> bool {
        self.type_flags() & UNION != 0
    }

    pub(crate) fn is_intersection(self) -> bool {
        self.type_flags() & INTERSECTION != 0
    }

    /// `checker.isArrayType(t) || checker.isTupleType(t)`.
    pub(crate) fn is_array_or_tuple(self) -> bool {
        self.flag("array") || self.flag("tuple")
    }

    /// A `number` index signature and a number-like `length` property.
    pub(crate) fn is_array_like(self) -> bool {
        self.flag("numberIndex") && self.flag("numberLength")
    }

    /// Union or intersection constituents.
    pub(crate) fn parts(self) -> impl Iterator<Item = ConstrainedShape<'a>> {
        self.0
            .get("types")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .map(ConstrainedShape)
    }

    /// `type.isUnionOrIntersection() ? type.types.some(recurse) : predicate(type)`.
    pub(crate) fn some_leaf(self, predicate: &dyn Fn(ConstrainedShape<'a>) -> bool) -> bool {
        if self.is_union() || self.is_intersection() {
            return self.parts().any(|part| part.some_leaf(predicate));
        }
        predicate(self)
    }

    /// `tsutils.unionConstituents(t)`.
    pub(crate) fn union_constituents(self) -> Vec<ConstrainedShape<'a>> {
        if self.is_union() {
            self.parts().collect()
        } else {
            vec![self]
        }
    }

    /// `tsutils.intersectionConstituents(t)`.
    pub(crate) fn intersection_constituents(self) -> Vec<ConstrainedShape<'a>> {
        if self.is_intersection() {
            self.parts().collect()
        } else {
            vec![self]
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::ConstrainedShape;
    use crate::lint::LintNode;

    fn node(shape: serde_json::Value) -> LintNode {
        serde_json::from_value(json!({
            "kind": "Identifier",
            "range": { "start": 0, "end": 1 },
            "fields": { "__type": shape }
        }))
        .unwrap()
    }

    #[test]
    fn walks_nested_union_and_intersection_parts() {
        // `T` constrained to `(A & B) | C`.
        let node = node(json!({
            "flags": 1 << 19,
            "constraint": {
                "flags": 1 << 27,
                "types": [
                    { "flags": 1 << 28, "types": [
                        { "flags": 1 << 20, "numberIndex": true, "numberLength": true }
                    ] },
                    { "flags": 1 << 20, "numberIndex": true }
                ]
            }
        }));
        let shape = ConstrainedShape::of(&node).unwrap();
        assert!(shape.some_leaf(&|part| part.is_array_like()));
        assert_eq!(shape.union_constituents().len(), 2);
        assert!(!shape.union_constituents()[1].is_array_like());
    }
}
