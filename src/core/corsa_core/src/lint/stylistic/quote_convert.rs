pub(crate) fn contains_unescaped_quote(content: &str, quote: u8) -> bool {
    let mut escaped = false;
    for byte in content.bytes() {
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if byte == quote {
            return true;
        }
    }
    false
}

pub(crate) fn convert_quote_literal(literal: &str, current: u8, preferred: u8) -> Option<String> {
    let content = literal.get(1..literal.len().saturating_sub(1))?;
    let mut output = String::with_capacity(literal.len() + 4);
    output.push(preferred as char);

    let mut cursor = 0;
    while cursor < content.len() {
        let tail = &content[cursor..];
        let mut chars = tail.chars();
        let ch = chars.next()?;
        if ch == '\n' || ch == '\r' {
            return None;
        }
        if ch == '\\' {
            let Some(next) = chars.next() else {
                output.push(ch);
                break;
            };
            if next as u32 == current as u32 {
                output.push(next);
            } else {
                output.push('\\');
                output.push(next);
            }
            cursor += ch.len_utf8() + next.len_utf8();
            continue;
        }
        if ch as u32 == preferred as u32 {
            output.push('\\');
        }
        output.push(ch);
        cursor += ch.len_utf8();
    }

    output.push(preferred as char);
    Some(output)
}
