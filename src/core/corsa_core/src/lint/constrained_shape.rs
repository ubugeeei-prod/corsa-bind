//! `__constrainedTypeShape`: the union/intersection structure of a node's
//! base-constrained type (`getConstrainedTypeAtLocation`) as the host's
//! checker reports it. Rules read verdicts from it instead of type text.
//!
//! ```json
//! { "union": true, "intersection": false, "array": false, "tuple": false,
//!   "numberIndex": false, "numberLength": false, "stringLike": false,
//!   "parts": [ { "array": true, ... }, ... ] }
//! ```
use serde_json::Value;

use super::LintNode;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ConstrainedShape<'a>(&'a Value);

impl<'a> ConstrainedShape<'a> {
    /// The node's shape, when the host reported one.
    pub(crate) fn of(node: &'a LintNode) -> Option<Self> {
        node.fields
            .get("__constrainedTypeShape")
            .filter(|value| value.is_object())
            .map(Self)
    }

    fn flag(self, key: &str) -> bool {
        self.0.get(key).and_then(Value::as_bool).unwrap_or(false)
    }

    pub(crate) fn is_union(self) -> bool {
        self.flag("union")
    }

    pub(crate) fn is_intersection(self) -> bool {
        self.flag("intersection")
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
            .get("parts")
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
            "fields": { "__constrainedTypeShape": shape }
        }))
        .unwrap()
    }

    #[test]
    fn walks_nested_union_and_intersection_parts() {
        let node = node(json!({
            "union": true,
            "parts": [
                { "intersection": true, "parts": [ { "numberIndex": true, "numberLength": true } ] },
                { "numberIndex": true }
            ]
        }));
        let shape = ConstrainedShape::of(&node).unwrap();
        assert!(shape.some_leaf(&|part| part.is_array_like()));
        assert_eq!(shape.union_constituents().len(), 2);
        assert!(!shape.union_constituents()[1].is_array_like());
    }
}
