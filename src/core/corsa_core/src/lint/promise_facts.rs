//! Readers for the checker promise facts a host may attach as
//! `__promiseFacts`: an object of booleans mirroring typescript-eslint's type
//! helpers (`thenable`, `alwaysThenable`, `returnsThenable`, `voidFunction`,
//! `promise`, `promiseArray`, `callable`, `error`, `promiseConstructor`), the
//! raw TypeScript `flags`, and the `needsToBeAwaited` certainty as
//! `awaitable`. Rules fall back to their type-text heuristics when a host does
//! not supply the facts.

use serde_json::Value;

use super::LintNode;
use super::helpers::strip_chain_expression;

// TypeScript 7 TypeFlags.
const ANY: u64 = 1;
const UNKNOWN: u64 = 1 << 1;
const UNDEFINED: u64 = 1 << 2;

fn facts(node: &LintNode) -> Option<&serde_json::Map<String, Value>> {
    strip_chain_expression(node)
        .fields
        .get("__promiseFacts")
        .or_else(|| node.fields.get("__promiseFacts"))
        .and_then(Value::as_object)
}

/// A boolean promise fact, when the host supplied the facts.
pub(super) fn promise_fact(node: &LintNode, key: &str) -> Option<bool> {
    facts(node)?.get(key)?.as_bool()
}

/// The `needsToBeAwaited` certainty (`always`, `may` or `never`).
pub(super) fn awaitable(node: &LintNode) -> Option<&str> {
    facts(node)?.get("awaitable")?.as_str()
}

fn flags(node: &LintNode) -> Option<u64> {
    facts(node)?.get("flags")?.as_u64()
}

/// The type is `any` (including the checker's error type).
pub(super) fn is_any(node: &LintNode) -> Option<bool> {
    flags(node).map(|flags| flags & ANY != 0)
}

/// The type is `unknown`.
pub(super) fn is_unknown(node: &LintNode) -> Option<bool> {
    flags(node).map(|flags| flags & UNKNOWN != 0)
}

/// The type has the `undefined` flag (not a union containing it).
pub(super) fn is_undefined(node: &LintNode) -> Option<bool> {
    flags(node).map(|flags| flags & UNDEFINED != 0)
}

/// `getStaticMemberAccessValue`: a static member name, also through a
/// computed key whose type is a single string literal (`obj[name]` with
/// `const name = 'then'`).
pub(super) fn static_member_name(callee: &LintNode) -> Option<String> {
    if let Some(name) = super::helpers::member_property_name(callee) {
        return Some(name);
    }
    let current = strip_chain_expression(callee);
    if current.kind != "MemberExpression" || current.field_bool("computed") != Some(true) {
        return None;
    }
    let property = current.child("property")?;
    let [text] = property.type_texts.as_slice() else {
        return None;
    };
    let text = text.trim();
    let quoted = text
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .or_else(|| {
            text.strip_prefix('\'')
                .and_then(|rest| rest.strip_suffix('\''))
        })?;
    (!quoted.contains(['"', '\'', '\\'])).then(|| quoted.to_owned())
}
