use serde_json::Value;

use crate::lint::{LintDiagnostic, LintFix, LintSuggestion, TextRange};

pub(crate) fn option_str(options: &Value, index: usize) -> Option<&str> {
    option_at(options, index).and_then(Value::as_str)
}

pub(crate) fn option_bool(options: &Value, index: usize, key: &str, default: bool) -> bool {
    option_at(options, index)
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

pub(crate) fn option_usize(options: &Value, index: usize, key: &str, default: usize) -> usize {
    option_at(options, index)
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
}

fn option_at(options: &Value, index: usize) -> Option<&Value> {
    match options {
        Value::Array(items) => items.get(index),
        Value::Null => None,
        _ if index == 0 => Some(options),
        _ => None,
    }
}

pub(crate) fn push_replacement_diagnostic(
    diagnostics: &mut Vec<LintDiagnostic>,
    rule_name: &'static str,
    message_id: &'static str,
    message: &'static str,
    start: usize,
    end: usize,
    suggestion_id: &'static str,
    suggestion_message: &'static str,
    replacement: impl Into<String>,
) {
    let replacement = replacement.into();
    push_diagnostic(
        diagnostics,
        rule_name,
        message_id,
        message,
        start,
        end,
        Some((suggestion_id, suggestion_message, move |range| {
            LintFix::replace_range(range, replacement.clone())
        })),
    );
}

pub(crate) fn push_diagnostic<F>(
    diagnostics: &mut Vec<LintDiagnostic>,
    rule_name: &'static str,
    message_id: &'static str,
    message: &'static str,
    start: usize,
    end: usize,
    suggestion: Option<(&'static str, &'static str, F)>,
) where
    F: Fn(TextRange) -> LintFix,
{
    let Some(range) = text_range(start, end) else {
        return;
    };
    let suggestions = suggestion
        .map(|(suggestion_id, suggestion_message, fix)| LintSuggestion {
            message_id: suggestion_id.to_owned(),
            message: suggestion_message.to_owned(),
            fixes: vec![fix(range)],
        })
        .into_iter()
        .collect();
    diagnostics.push(LintDiagnostic {
        rule_name: rule_name.to_owned(),
        message_id: message_id.to_owned(),
        message: message.to_owned(),
        range,
        suggestions,
    });
}

fn text_range(start: usize, end: usize) -> Option<TextRange> {
    Some(TextRange::new(
        u32::try_from(start).ok()?,
        u32::try_from(end).ok()?,
    ))
}

pub(crate) fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | 0x0b | 0x0c)
}

pub(crate) fn is_identifier_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic()
}

pub(crate) fn is_identifier_continue(byte: u8) -> bool {
    is_identifier_start(byte) || byte.is_ascii_digit()
}
