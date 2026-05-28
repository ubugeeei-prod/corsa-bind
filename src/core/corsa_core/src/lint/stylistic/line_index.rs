use super::helpers::is_space;

#[derive(Clone, Copy)]
pub(crate) struct LineInfo {
    pub(crate) start: usize,
    pub(crate) content_end: usize,
    pub(crate) end: usize,
    pub(crate) newline_start: usize,
    pub(crate) newline_len: usize,
    pub(crate) newline: Newline,
    pub(crate) is_blank: bool,
    pub(crate) is_comment_only: bool,
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum Newline {
    None,
    Lf,
    Crlf,
    Cr,
}

pub(crate) fn collect_lines(source_text: &str) -> Vec<LineInfo> {
    let bytes = source_text.as_bytes();
    let mut lines = Vec::new();
    let mut start = 0;
    let mut in_block_comment = false;

    while start < bytes.len() {
        let mut cursor = start;
        while cursor < bytes.len() && bytes[cursor] != b'\n' && bytes[cursor] != b'\r' {
            cursor += 1;
        }

        let newline_start = cursor;
        let (newline, newline_len) = newline_at(bytes, cursor);
        let end = newline_start + newline_len;
        let is_blank = bytes[start..newline_start]
            .iter()
            .all(|byte| is_space(*byte));
        let is_comment_only =
            classify_comment_line(&bytes[start..newline_start], &mut in_block_comment);

        lines.push(LineInfo {
            start,
            content_end: newline_start,
            end,
            newline_start,
            newline_len,
            newline,
            is_blank,
            is_comment_only,
        });
        start = end;
    }

    lines
}

fn newline_at(bytes: &[u8], cursor: usize) -> (Newline, usize) {
    if cursor >= bytes.len() {
        (Newline::None, 0)
    } else if bytes[cursor] == b'\r' && bytes.get(cursor + 1) == Some(&b'\n') {
        (Newline::Crlf, 2)
    } else if bytes[cursor] == b'\r' {
        (Newline::Cr, 1)
    } else {
        (Newline::Lf, 1)
    }
}

fn classify_comment_line(line: &[u8], in_block_comment: &mut bool) -> bool {
    let trimmed_start = line
        .iter()
        .position(|byte| !is_space(*byte))
        .unwrap_or(line.len());
    let starts_inside_block = *in_block_comment;
    let starts_with_line_comment = line
        .get(trimmed_start..)
        .is_some_and(|value| value.starts_with(b"//"));
    let starts_with_block_comment = line
        .get(trimmed_start..)
        .is_some_and(|value| value.starts_with(b"/*"));

    update_block_comment_state(line, in_block_comment);

    starts_inside_block || starts_with_line_comment || starts_with_block_comment
}

fn update_block_comment_state(line: &[u8], in_block_comment: &mut bool) {
    let mut cursor = 0;
    while cursor + 1 < line.len() {
        if *in_block_comment {
            if line[cursor] == b'*' && line[cursor + 1] == b'/' {
                *in_block_comment = false;
                cursor += 2;
                continue;
            }
        } else if line[cursor] == b'/' && line[cursor + 1] == b'*' {
            *in_block_comment = true;
            cursor += 2;
            continue;
        }
        cursor += 1;
    }
}
