use serde_json::Value;

use crate::lint::{LintDiagnostic, LintFix};

use super::{
    helpers::{option_bool, push_diagnostic},
    line_index::LineInfo,
};

pub(crate) fn check_no_tabs(
    source_text: &str,
    lines: &[LineInfo],
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let allow_indentation_tabs = option_bool(options, 0, "allowIndentationTabs", false);
    let bytes = source_text.as_bytes();

    for line in lines {
        let mut cursor = line.start;
        let mut indentation = true;
        while cursor < line.content_end {
            let byte = bytes[cursor];
            if byte == b'\t' {
                if !allow_indentation_tabs || !indentation {
                    report_tab(cursor, diagnostics);
                }
            } else if byte != b' ' {
                indentation = false;
            }
            cursor += 1;
        }
    }
}

fn report_tab(offset: usize, diagnostics: &mut Vec<LintDiagnostic>) {
    push_diagnostic(
        diagnostics,
        "no-tabs",
        "unexpectedTab",
        "Unexpected tab character.",
        offset,
        offset + 1,
        Some(("replaceTab", "Replace tab with a space.", |range| {
            LintFix::replace_range(range, " ")
        })),
    );
}
