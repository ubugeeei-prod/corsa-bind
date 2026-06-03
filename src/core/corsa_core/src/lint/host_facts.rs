use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value, json};

use super::{LintNode, TextRange};

pub(crate) fn prepare_node_for_rule(node: &LintNode) -> LintNode {
    let mut prepared = node.clone();
    apply_ancestor_facts(&mut prepared);
    apply_call_facts(&mut prepared);
    apply_symbol_facts(&mut prepared);
    apply_type_parameter_facts(&mut prepared);
    apply_return_type_facts(&mut prepared);
    prepared
}

fn apply_ancestor_facts(node: &mut LintNode) {
    let Some(ancestors) = node
        .fields
        .get("__ancestorFacts")
        .and_then(Value::as_array)
        .cloned()
    else {
        return;
    };

    if let Some(function) = ancestors
        .iter()
        .rev()
        .find(|ancestor| field_str(ancestor, "kind").is_some_and(|kind| kind.contains("Function")))
    {
        if let Some(async_value) = field_bool(function, "async") {
            insert_if_absent(
                &mut node.fields,
                "__nearestFunctionAsync",
                json!(async_value),
            );
        }
    }

    if let Some(class_name) = ancestors
        .iter()
        .rev()
        .find_map(|ancestor| field_str(ancestor, "className"))
    {
        insert_if_absent(&mut node.fields, "__nearestClassName", json!(class_name));
    }

    if node.kind == "ReturnStatement"
        && ancestors
            .iter()
            .any(|ancestor| try_contains(ancestor, node.range))
    {
        insert_if_absent(&mut node.fields, "__returnAwaitRequiresAwait", json!(true));
    }

    if node.kind == "CallExpression" && is_promise_executor_reject_call(node, ancestors.as_slice())
    {
        insert_if_absent(&mut node.fields, "__promiseExecutorRejectCall", json!(true));
    }
}

fn apply_call_facts(node: &mut LintNode) {
    let Some(call_facts) = node
        .fields
        .get("__callFacts")
        .and_then(Value::as_object)
        .cloned()
    else {
        return;
    };
    if let Some(expected) = call_facts.get("expectedArgumentTypeTexts") {
        insert_if_absent(
            &mut node.fields,
            "__expectedArgumentTypeTexts",
            expected.clone(),
        );
    }
    if let Some(required) = call_facts.get("explicitTypeArgumentsRequired") {
        insert_if_absent(
            &mut node.fields,
            "__explicitTypeArgumentsRequired",
            required.clone(),
        );
    }
    copy_call_fact(
        node,
        &call_facts,
        "typeArgumentRanges",
        "__typeArgumentRanges",
    );
    copy_call_fact(
        node,
        &call_facts,
        "typeArgumentListRange",
        "__typeArgumentListRange",
    );
    copy_call_fact(
        node,
        &call_facts,
        "typeParameterCount",
        "__typeParameterCount",
    );
    copy_call_fact(
        node,
        &call_facts,
        "lastTypeParameterHasDefault",
        "__lastTypeParameterHasDefault",
    );
    copy_call_fact(
        node,
        &call_facts,
        "lastTypeArgumentEqualsDefault",
        "__lastTypeArgumentEqualsDefault",
    );
    copy_call_fact(
        node,
        &call_facts,
        "lastTypeArgumentSameTypeFlagsAsDefault",
        "__lastTypeArgumentSameTypeFlagsAsDefault",
    );
    copy_call_fact(
        node,
        &call_facts,
        "lastTypeArgumentIdenticalToDefault",
        "__lastTypeArgumentIdenticalToDefault",
    );
}

fn apply_symbol_facts(node: &mut LintNode) {
    let Some(symbol_facts) = node.fields.get("__symbolFacts").and_then(Value::as_object) else {
        return;
    };
    if symbol_facts
        .get("deprecated")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || declaration_has_deprecated_jsdoc(symbol_facts)
    {
        insert_if_absent(&mut node.fields, "__deprecated", json!(true));
    }
}

fn apply_type_parameter_facts(node: &mut LintNode) {
    let Some(type_parameter_facts) = node
        .fields
        .get("__typeParameterFacts")
        .and_then(Value::as_object)
    else {
        return;
    };
    let Some(name) = type_parameter_facts.get("name").and_then(Value::as_str) else {
        return;
    };
    let Some(owner_text) = type_parameter_facts
        .get("ownerText")
        .and_then(Value::as_str)
    else {
        return;
    };
    if count_identifier_occurrences(owner_text, name) <= 2 {
        insert_if_absent(&mut node.fields, "__hasSingleUseTypeParameter", json!(true));
    }
}

fn apply_return_type_facts(node: &mut LintNode) {
    let Some(return_type_facts) = node
        .fields
        .get("__returnTypeFacts")
        .and_then(Value::as_object)
        .cloned()
    else {
        return;
    };
    if let Some(texts) = return_type_facts.get("texts") {
        insert_if_absent(&mut node.fields, "__returnTypeTexts", texts.clone());
    }
}

fn is_promise_executor_reject_call(node: &LintNode, ancestors: &[Value]) -> bool {
    let Some(call_facts) = node.fields.get("__callFacts").and_then(Value::as_object) else {
        return false;
    };
    let Some(callee_name) = call_facts.get("calleeName").and_then(Value::as_str) else {
        return false;
    };
    let Some(function) = ancestors
        .iter()
        .rev()
        .find(|ancestor| field_str(ancestor, "kind").is_some_and(|kind| kind.contains("Function")))
    else {
        return false;
    };
    let Some(params) = function.get("paramNames").and_then(Value::as_array) else {
        return false;
    };
    if params
        .get(1)
        .and_then(Value::as_str)
        .is_none_or(|reject| reject != callee_name)
    {
        return false;
    }
    (field_str(function, "parentKind") == Some("NewExpression")
        && field_str(function, "parentCalleeName") == Some("Promise"))
        || (field_str(function, "parentParentKind") == Some("NewExpression")
            && field_str(function, "parentParentCalleeName") == Some("Promise"))
}

fn try_contains(value: &Value, range: TextRange) -> bool {
    if field_str(value, "kind") != Some("TryStatement") {
        return false;
    }
    let Some(start) = value.get("start").and_then(Value::as_u64) else {
        return false;
    };
    let Some(end) = value.get("end").and_then(Value::as_u64) else {
        return false;
    };
    start as u32 <= range.start && range.end <= end as u32
}

fn count_identifier_occurrences(text: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    text.match_indices(needle)
        .filter(|(index, _)| {
            !identifier_part_before(text, *index)
                && !identifier_part_at(text, index.saturating_add(needle.len()))
        })
        .count()
}

fn identifier_part_before(text: &str, index: usize) -> bool {
    text.get(..index)
        .and_then(|prefix| prefix.chars().next_back())
        .is_some_and(is_identifier_part)
}

fn identifier_part_at(text: &str, index: usize) -> bool {
    text.get(index..)
        .and_then(|suffix| suffix.chars().next())
        .is_some_and(is_identifier_part)
}

fn is_identifier_part(ch: char) -> bool {
    ch == '_' || ch == '$' || ch.is_ascii_alphanumeric()
}

fn field_str<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

fn field_bool(value: &Value, key: &str) -> Option<bool> {
    value.get(key).and_then(Value::as_bool)
}

fn insert_if_absent(fields: &mut BTreeMap<String, Value>, key: &str, value: Value) {
    fields.entry(key.to_owned()).or_insert(value);
}

fn copy_call_fact(
    node: &mut LintNode,
    call_facts: &Map<String, Value>,
    source_key: &str,
    target_key: &str,
) {
    if let Some(value) = call_facts.get(source_key) {
        insert_if_absent(&mut node.fields, target_key, value.clone());
    }
}

struct ParsedNodeHandle {
    pos: usize,
    path: String,
}

fn declaration_has_deprecated_jsdoc(symbol_facts: &Map<String, Value>) -> bool {
    let Some(declarations) = symbol_facts.get("declarations").and_then(Value::as_array) else {
        return false;
    };
    declarations.iter().any(|declaration| {
        declaration
            .as_str()
            .and_then(parse_node_handle)
            .and_then(|handle| source_for_handle(symbol_facts, handle))
            .is_some_and(|(source, pos)| has_deprecated_marker_before(&source, pos))
    })
}

fn parse_node_handle(value: &str) -> Option<ParsedNodeHandle> {
    let mut parts = value.split('.');
    let pos = parts.next()?.parse().ok()?;
    parts.next()?;
    parts.next()?;
    let path = parts.collect::<Vec<_>>().join(".");
    Some(ParsedNodeHandle { pos, path })
}

fn source_for_handle(
    symbol_facts: &Map<String, Value>,
    handle: ParsedNodeHandle,
) -> Option<(String, usize)> {
    let filename = symbol_facts
        .get("filename")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if path_matches_current_source(handle.path.as_str(), filename) {
        let source = symbol_facts
            .get("sourceText")
            .and_then(Value::as_str)?
            .to_owned();
        let pos = utf16_offset_to_byte_index(&source, handle.pos)?;
        return Some((source, pos));
    }

    let cwd = symbol_facts
        .get("cwd")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = resolve_source_path(cwd, handle.path.as_str())?;
    let source = fs::read_to_string(path).ok()?;
    let pos = utf16_offset_to_byte_index(&source, handle.pos)?;
    Some((source, pos))
}

fn path_matches_current_source(path: &str, filename: &str) -> bool {
    path.is_empty() || path == filename || filename.ends_with(path)
}

fn resolve_source_path(cwd: &str, path: &str) -> Option<PathBuf> {
    if path.is_empty() {
        return None;
    }
    let direct = Path::new(path);
    if direct.exists() {
        return Some(direct.to_path_buf());
    }
    if cwd.is_empty() {
        return None;
    }
    let joined = Path::new(cwd).join(path);
    joined.exists().then_some(joined)
}

fn has_deprecated_marker_before(source: &str, pos: usize) -> bool {
    let start = source[..pos]
        .char_indices()
        .rev()
        .nth(500)
        .map(|(index, _)| index)
        .unwrap_or(0);
    source[start..pos].contains("@deprecated")
}

fn utf16_offset_to_byte_index(source: &str, offset: usize) -> Option<usize> {
    let mut utf16_units = 0usize;
    for (byte_index, ch) in source.char_indices() {
        if utf16_units == offset {
            return Some(byte_index);
        }
        utf16_units = utf16_units.saturating_add(ch.len_utf16());
        if utf16_units > offset {
            return None;
        }
    }
    (utf16_units == offset).then_some(source.len())
}
