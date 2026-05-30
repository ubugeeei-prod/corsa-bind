use serde_json::Value;

use crate::lint::LintDiagnostic;

use super::helpers::{
    ReplacementDiagnostic, is_identifier_continue, is_identifier_start, option_bool, option_str,
    push_replacement_diagnostic,
};
use super::quote_convert::{contains_unescaped_quote, convert_quote_literal};

pub(crate) fn check_quotes(
    source_text: &str,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let preferred = match option_str(options, 0).unwrap_or("double") {
        "single" => b'\'',
        _ => b'"',
    };
    let avoid_escape = option_bool(options, 1, "avoidEscape", false);
    let allow_template_literals = option_bool(options, 1, "allowTemplateLiterals", false);
    let bytes = source_text.as_bytes();
    let mut cursor = 0;
    let mut previous_significant = None;

    while cursor < bytes.len() {
        match bytes[cursor] {
            b'\'' | b'"' => {
                let quote = bytes[cursor];
                let start = cursor;
                let Some(end) = scan_string_literal(bytes, cursor, quote) else {
                    cursor += 1;
                    continue;
                };
                cursor = end;
                previous_significant = Some(b'S');
                report_quote_if_needed(
                    source_text,
                    start,
                    end,
                    quote,
                    preferred,
                    avoid_escape,
                    diagnostics,
                );
            }
            b'`' => {
                let start = cursor;
                let end = scan_template_literal(bytes, cursor).unwrap_or(cursor + 1);
                // `@stylistic` (with allowTemplateLiterals off, the default)
                // flags a plain template literal that could be a regular string:
                // no `${…}` substitution, no line break, and not tagged.
                let tagged = matches!(previous_significant, Some(b'I' | b'T' | b'S' | b'R')) ||
                    matches!(previous_significant, Some(b')') | Some(b']'));
                if !allow_template_literals
                    && !tagged
                    && end >= start + 2
                    && is_plain_template(&bytes[start + 1..end - 1])
                {
                    report_template_quote(source_text, start, end, preferred, diagnostics);
                }
                cursor = end;
                previous_significant = Some(b'T');
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'/') => {
                cursor = skip_line_comment(bytes, cursor + 2);
            }
            b'/' if bytes.get(cursor + 1) == Some(&b'*') => {
                cursor = skip_block_comment(bytes, cursor + 2);
            }
            b'/' if looks_like_regex_start(previous_significant) => {
                cursor = skip_regex_literal(bytes, cursor + 1);
                previous_significant = Some(b'R');
            }
            byte if is_identifier_start(byte) => {
                let start = cursor;
                cursor += 1;
                while cursor < bytes.len() && is_identifier_continue(bytes[cursor]) {
                    cursor += 1;
                }
                previous_significant =
                    Some(if is_regex_prefix_keyword(&source_text[start..cursor]) {
                        b'K'
                    } else {
                        b'I'
                    });
            }
            byte if byte.is_ascii_whitespace() => {
                cursor += 1;
            }
            byte => {
                previous_significant = Some(byte);
                cursor += 1;
            }
        }
    }
}

fn report_quote_if_needed(
    source_text: &str,
    start: usize,
    end: usize,
    quote: u8,
    preferred: u8,
    avoid_escape: bool,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    if quote == preferred {
        return;
    }
    if avoid_escape && contains_unescaped_quote(&source_text[start + 1..end - 1], preferred) {
        return;
    }
    if let Some(replacement) = convert_quote_literal(&source_text[start..end], quote, preferred) {
        push_replacement_diagnostic(
            diagnostics,
            ReplacementDiagnostic {
                rule_name: "quotes",
                message_id: "wrongQuote",
                message: "String literals must use the configured quote style.",
                start,
                end,
                suggestion_id: "fixQuote",
                suggestion_message: "Convert quote style.",
            },
            replacement,
        );
    }
}

/// Whether template inner bytes contain neither a `${` substitution nor a line
/// break (so the literal could be rewritten as an ordinary string).
fn is_plain_template(inner: &[u8]) -> bool {
    let mut cursor = 0;
    while cursor < inner.len() {
        match inner[cursor] {
            b'\\' => cursor += 2,
            b'\n' | b'\r' => return false,
            b'$' if inner.get(cursor + 1) == Some(&b'{') => return false,
            _ => cursor += 1,
        }
    }
    true
}

fn report_template_quote(
    source_text: &str,
    start: usize,
    end: usize,
    preferred: u8,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let quote = preferred as char;
    let inner = &source_text[start + 1..end - 1];
    // Re-escape the chosen quote and collapse template-only escapes.
    let mut replacement = String::with_capacity(inner.len() + 2);
    replacement.push(quote);
    let mut chars = inner.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' => {
                if let Some(&next) = chars.peek() {
                    if next == '`' {
                        replacement.push('`');
                        chars.next();
                        continue;
                    }
                }
                replacement.push('\\');
                if let Some(next) = chars.next() {
                    replacement.push(next);
                }
            }
            c if c == quote => {
                replacement.push('\\');
                replacement.push(c);
            }
            c => replacement.push(c),
        }
    }
    replacement.push(quote);
    push_replacement_diagnostic(
        diagnostics,
        ReplacementDiagnostic {
            rule_name: "quotes",
            message_id: "wrongQuote",
            message: "String literals must use the configured quote style.",
            start,
            end,
            suggestion_id: "fixQuote",
            suggestion_message: "Convert quote style.",
        },
        replacement,
    );
}

fn scan_string_literal(bytes: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut cursor = start + 1;
    let mut escaped = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == quote {
            return Some(cursor + 1);
        } else if byte == b'\n' || byte == b'\r' {
            return None;
        }
        cursor += 1;
    }
    None
}

fn scan_template_literal(bytes: &[u8], start: usize) -> Option<usize> {
    let mut cursor = start + 1;
    let mut escaped = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'`' {
            return Some(cursor + 1);
        }
        cursor += 1;
    }
    None
}

fn skip_line_comment(bytes: &[u8], start: usize) -> usize {
    let mut cursor = start;
    while cursor < bytes.len() && bytes[cursor] != b'\n' && bytes[cursor] != b'\r' {
        cursor += 1;
    }
    cursor
}

fn skip_block_comment(bytes: &[u8], start: usize) -> usize {
    let mut cursor = start;
    while cursor + 1 < bytes.len() {
        if bytes[cursor] == b'*' && bytes[cursor + 1] == b'/' {
            return cursor + 2;
        }
        cursor += 1;
    }
    bytes.len()
}

fn skip_regex_literal(bytes: &[u8], start: usize) -> usize {
    let mut cursor = start;
    let mut escaped = false;
    let mut in_class = false;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == b'[' {
            in_class = true;
        } else if byte == b']' {
            in_class = false;
        } else if byte == b'/' && !in_class {
            return skip_regex_flags(bytes, cursor + 1);
        } else if byte == b'\n' || byte == b'\r' {
            return cursor;
        }
        cursor += 1;
    }
    cursor
}

fn skip_regex_flags(bytes: &[u8], mut cursor: usize) -> usize {
    while cursor < bytes.len() && is_identifier_continue(bytes[cursor]) {
        cursor += 1;
    }
    cursor
}

fn looks_like_regex_start(previous_significant: Option<u8>) -> bool {
    previous_significant.is_none_or(|byte| {
        matches!(
            byte,
            b'(' | b'['
                | b'{'
                | b':'
                | b';'
                | b','
                | b'='
                | b'!'
                | b'?'
                | b'&'
                | b'|'
                | b'+'
                | b'-'
                | b'*'
                | b'%'
                | b'^'
                | b'~'
                | b'<'
                | b'>'
                | b'K'
        )
    })
}

fn is_regex_prefix_keyword(word: &str) -> bool {
    matches!(
        word,
        "return"
            | "throw"
            | "case"
            | "delete"
            | "void"
            | "typeof"
            | "instanceof"
            | "in"
            | "of"
            | "yield"
            | "await"
    )
}
