use serde_json::Value;

use crate::lint::{LintDiagnostic, LintFix};

use super::{
    helpers::{
        ReplacementDiagnostic, option_bool, option_str, option_usize, push_diagnostic,
        push_replacement_diagnostic,
    },
    line_index::{LineInfo, Newline},
};

pub(crate) fn check_no_trailing_spaces(
    source_text: &str,
    lines: &[LineInfo],
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let skip_blank_lines = option_bool(options, 0, "skipBlankLines", false);
    let ignore_comments = option_bool(options, 0, "ignoreComments", false);

    for line in lines {
        if (skip_blank_lines && line.is_blank) || (ignore_comments && line.is_comment_only) {
            continue;
        }
        let trailing_start =
            trim_ascii_space_end(source_text.as_bytes(), line.start, line.content_end);
        if trailing_start < line.content_end {
            push_diagnostic(
                diagnostics,
                "no-trailing-spaces",
                "trailingSpace",
                "Trailing spaces are not allowed.",
                trailing_start,
                line.content_end,
                Some((
                    "removeTrailingSpace",
                    "Remove trailing spaces.",
                    LintFix::remove_range,
                )),
            );
        }
    }
}

pub(crate) fn check_eol_last(
    source_text: &str,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    if source_text.is_empty() {
        return;
    }

    match option_str(options, 0).unwrap_or("always") {
        "never" => check_no_eol_last(source_text, diagnostics),
        _ if !source_text.ends_with('\n') && !source_text.ends_with('\r') => {
            push_replacement_diagnostic(
                diagnostics,
                ReplacementDiagnostic {
                    rule_name: "eol-last",
                    message_id: "missing",
                    message: "Expected newline at end of file.",
                    start: source_text.len(),
                    end: source_text.len(),
                    suggestion_id: "insertNewline",
                    suggestion_message: "Insert a newline.",
                },
                "\n",
            );
        }
        _ => {}
    }
}

pub(crate) fn check_linebreak_style(
    lines: &[LineInfo],
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let expected = option_str(options, 0).unwrap_or("unix");
    for line in lines {
        if line.newline == Newline::None {
            continue;
        }
        match expected {
            "windows" if line.newline != Newline::Crlf => report_linebreak(
                diagnostics,
                line,
                "expectedWindows",
                "Expected Windows linebreaks.",
                "\r\n",
            ),
            _ if expected != "windows" && line.newline != Newline::Lf => report_linebreak(
                diagnostics,
                line,
                "expectedUnix",
                "Expected Unix linebreaks.",
                "\n",
            ),
            _ => {}
        }
    }
}

pub(crate) fn check_no_multiple_empty_lines(
    lines: &[LineInfo],
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let max = option_usize(options, 0, "max", 2);
    let max_bof = option_usize(options, 0, "maxBOF", max);
    let max_eof = option_usize(options, 0, "maxEOF", max);
    let Some(first_non_blank) = lines.iter().position(|line| !line.is_blank) else {
        report_extra_blank_lines(lines, max_bof.min(max_eof), diagnostics);
        return;
    };
    let last_non_blank = lines
        .iter()
        .rposition(|line| !line.is_blank)
        .unwrap_or(first_non_blank);

    report_extra_blank_lines(&lines[..first_non_blank], max_bof, diagnostics);
    report_extra_blank_lines(&lines[last_non_blank + 1..], max_eof, diagnostics);
    report_middle_blank_runs(lines, first_non_blank, last_non_blank, max, diagnostics);
}

fn check_no_eol_last(source_text: &str, diagnostics: &mut Vec<LintDiagnostic>) {
    let trim_start = source_text
        .as_bytes()
        .iter()
        .rposition(|byte| *byte != b'\n' && *byte != b'\r')
        .map_or(0, |index| index + 1);
    if trim_start < source_text.len() {
        push_diagnostic(
            diagnostics,
            "eol-last",
            "unexpected",
            "Unexpected newline at end of file.",
            trim_start,
            source_text.len(),
            Some((
                "removeNewline",
                "Remove trailing newlines.",
                LintFix::remove_range,
            )),
        );
    }
}

fn report_linebreak(
    diagnostics: &mut Vec<LintDiagnostic>,
    line: &LineInfo,
    message_id: &'static str,
    message: &'static str,
    replacement: &'static str,
) {
    push_replacement_diagnostic(
        diagnostics,
        ReplacementDiagnostic {
            rule_name: "linebreak-style",
            message_id,
            message,
            start: line.newline_start,
            end: line.newline_start + line.newline_len,
            suggestion_id: "fixLinebreak",
            suggestion_message: "Replace linebreak.",
        },
        replacement,
    );
}

fn report_middle_blank_runs(
    lines: &[LineInfo],
    first_non_blank: usize,
    last_non_blank: usize,
    max: usize,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let mut run_start = None;
    for (index, line) in lines
        .iter()
        .enumerate()
        .take(last_non_blank)
        .skip(first_non_blank + 1)
    {
        if line.is_blank {
            run_start.get_or_insert(index);
        } else if let Some(start) = run_start.take() {
            report_extra_blank_lines(&lines[start..index], max, diagnostics);
        }
    }
    if let Some(start) = run_start {
        report_extra_blank_lines(&lines[start..last_non_blank], max, diagnostics);
    }
}

fn report_extra_blank_lines(
    blank_lines: &[LineInfo],
    allowed: usize,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    if blank_lines.len() <= allowed {
        return;
    }
    for line in &blank_lines[allowed..] {
        push_diagnostic(
            diagnostics,
            "no-multiple-empty-lines",
            "tooMany",
            "Too many blank lines.",
            line.start,
            line.end,
            Some((
                "removeBlankLine",
                "Remove extra blank line.",
                LintFix::remove_range,
            )),
        );
    }
}

fn trim_ascii_space_end(bytes: &[u8], start: usize, end: usize) -> usize {
    let mut cursor = end;
    while cursor > start {
        let byte = bytes[cursor - 1];
        if byte != b' ' && byte != b'\t' {
            return cursor;
        }
        cursor -= 1;
    }
    start
}
