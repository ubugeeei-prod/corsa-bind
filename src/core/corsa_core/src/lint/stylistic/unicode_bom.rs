use serde_json::Value;

use crate::lint::{LintDiagnostic, LintFix};

use super::helpers::{
    ReplacementDiagnostic, option_str, push_diagnostic, push_replacement_diagnostic,
};

const BOM: &str = "\u{feff}";

pub(crate) fn check_unicode_bom(
    source_text: &str,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let requires_bom = option_str(options, 0).unwrap_or("never") == "always";
    let has_bom = source_text.starts_with(BOM);

    match (requires_bom, has_bom) {
        (true, false) => push_replacement_diagnostic(
            diagnostics,
            ReplacementDiagnostic {
                rule_name: "unicode-bom",
                message_id: "expected",
                message: "Expected Unicode byte order mark.",
                start: 0,
                end: 0,
                suggestion_id: "insertBom",
                suggestion_message: "Insert Unicode byte order mark.",
            },
            BOM,
        ),
        (false, true) => push_diagnostic(
            diagnostics,
            "unicode-bom",
            "unexpected",
            "Unexpected Unicode byte order mark.",
            0,
            BOM.len(),
            Some((
                "removeBom",
                "Remove Unicode byte order mark.",
                LintFix::remove_range,
            )),
        ),
        _ => {}
    }
}
