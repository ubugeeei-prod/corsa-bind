use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use super::{LintDiagnostic, RuleMeta};

mod helpers;
mod line_index;
mod line_rules;
mod quote_convert;
mod quotes;
mod tabs;
mod unicode_bom;

const PROGRAM_LISTENER: &[&str] = &["Program"];

const NO_TRAILING_SPACES_MESSAGES: &[(&str, &str)] = &[
    ("trailingSpace", "Trailing spaces are not allowed."),
    ("removeTrailingSpace", "Remove trailing spaces."),
];
const EOL_LAST_MESSAGES: &[(&str, &str)] = &[
    ("missing", "Expected newline at end of file."),
    ("unexpected", "Unexpected newline at end of file."),
    ("insertNewline", "Insert a newline."),
    ("removeNewline", "Remove trailing newlines."),
];
const LINEBREAK_STYLE_MESSAGES: &[(&str, &str)] = &[
    ("expectedUnix", "Expected Unix linebreaks."),
    ("expectedWindows", "Expected Windows linebreaks."),
    ("fixLinebreak", "Replace linebreak."),
];
const NO_MULTIPLE_EMPTY_LINES_MESSAGES: &[(&str, &str)] = &[
    ("tooMany", "Too many blank lines."),
    ("removeBlankLine", "Remove extra blank line."),
];
const NO_TABS_MESSAGES: &[(&str, &str)] = &[
    ("unexpectedTab", "Unexpected tab character."),
    ("replaceTab", "Replace tab with a space."),
];
const QUOTES_MESSAGES: &[(&str, &str)] = &[
    (
        "wrongQuote",
        "String literals must use the configured quote style.",
    ),
    ("fixQuote", "Convert quote style."),
];
const UNICODE_BOM_MESSAGES: &[(&str, &str)] = &[
    ("expected", "Expected Unicode byte order mark."),
    ("unexpected", "Unexpected Unicode byte order mark."),
    ("insertBom", "Insert Unicode byte order mark."),
    ("removeBom", "Remove Unicode byte order mark."),
];

/// One stylistic rule invocation requested by the JavaScript bridge.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylisticRuleConfig {
    /// Stable stylistic rule name, for example `quotes`.
    pub name: String,
    /// Rule options in Oxlint/ESLint shape, without severity.
    #[serde(default)]
    pub options: Value,
}

/// Source-wide stylistic lint configuration.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylisticRunConfig {
    /// Rules to run in one native pass.
    #[serde(default)]
    pub rules: Vec<StylisticRuleConfig>,
}

#[derive(Clone, Copy)]
struct StylisticRuleDefinition {
    name: &'static str,
    docs_description: &'static str,
    messages: &'static [(&'static str, &'static str)],
}

const STYLISTIC_RULES: &[StylisticRuleDefinition] = &[
    StylisticRuleDefinition {
        name: "eol-last",
        docs_description: "Require or disallow a newline at the end of files.",
        messages: EOL_LAST_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "linebreak-style",
        docs_description: "Enforce consistent linebreak characters.",
        messages: LINEBREAK_STYLE_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-multiple-empty-lines",
        docs_description: "Limit consecutive blank lines.",
        messages: NO_MULTIPLE_EMPTY_LINES_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-tabs",
        docs_description: "Disallow tab characters.",
        messages: NO_TABS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-trailing-spaces",
        docs_description: "Disallow whitespace at the end of lines.",
        messages: NO_TRAILING_SPACES_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "quotes",
        docs_description: "Enforce single or double quotes for string literals.",
        messages: QUOTES_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "unicode-bom",
        docs_description: "Require or disallow Unicode byte order marks.",
        messages: UNICODE_BOM_MESSAGES,
    },
];

/// Returns metadata for every Rust-backed stylistic rule.
pub fn stylistic_rule_metas() -> Vec<RuleMeta> {
    STYLISTIC_RULES
        .iter()
        .map(|definition| RuleMeta {
            name: definition.name.to_owned(),
            docs_description: definition.docs_description.to_owned(),
            messages: definition
                .messages
                .iter()
                .map(|(id, description)| ((*id).to_owned(), (*description).to_owned()))
                .collect::<BTreeMap<_, _>>(),
            has_suggestions: true,
            listeners: PROGRAM_LISTENER
                .iter()
                .map(|listener| (*listener).to_owned())
                .collect(),
            requires_type_texts: false,
        })
        .collect()
}

/// Runs native stylistic rules against a full source text.
///
/// The implementation intentionally works on bytes and does a small number of
/// linear scans. The JavaScript plugin batches rule configs into this function
/// so multiple style rules share the same N-API call and line index.
pub fn run_stylistic_lint(
    source_text: &str,
    config: &StylisticRunConfig,
) -> Result<Vec<LintDiagnostic>, String> {
    let needs_lines = config.rules.iter().any(|rule| {
        matches!(
            rule.name.as_str(),
            "linebreak-style" | "no-multiple-empty-lines" | "no-tabs" | "no-trailing-spaces"
        )
    });
    let lines = needs_lines.then(|| line_index::collect_lines(source_text));
    let mut diagnostics = Vec::new();

    for rule in &config.rules {
        match rule.name.as_str() {
            "eol-last" => line_rules::check_eol_last(source_text, &rule.options, &mut diagnostics),
            "linebreak-style" => line_rules::check_linebreak_style(
                lines.as_deref().unwrap_or(&[]),
                &rule.options,
                &mut diagnostics,
            ),
            "no-multiple-empty-lines" => line_rules::check_no_multiple_empty_lines(
                lines.as_deref().unwrap_or(&[]),
                &rule.options,
                &mut diagnostics,
            ),
            "no-trailing-spaces" => line_rules::check_no_trailing_spaces(
                source_text,
                lines.as_deref().unwrap_or(&[]),
                &rule.options,
                &mut diagnostics,
            ),
            "no-tabs" => tabs::check_no_tabs(
                source_text,
                lines.as_deref().unwrap_or(&[]),
                &rule.options,
                &mut diagnostics,
            ),
            "quotes" => quotes::check_quotes(source_text, &rule.options, &mut diagnostics),
            "unicode-bom" => {
                unicode_bom::check_unicode_bom(source_text, &rule.options, &mut diagnostics)
            }
            unknown => return Err(format!("unknown native stylistic rule: {unknown}")),
        }
    }

    Ok(diagnostics)
}
