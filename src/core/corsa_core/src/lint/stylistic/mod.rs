use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

use super::{LintDiagnostic, RuleBridgeRequirements, RuleMeta};

mod context;
mod context_rules;
mod helpers;
mod lexer;
mod line_index;
mod line_rules;
mod quote_convert;
mod quotes;
mod tabs;
mod token_rules;
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
const ARROW_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("expectedBefore", "Missing space before =>."),
    ("unexpectedBefore", "Unexpected space before =>."),
    ("expectedAfter", "Missing space after =>."),
    ("unexpectedAfter", "Unexpected space after =>."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const COMMA_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missing", "A space is required around ','."),
    ("unexpected", "There should be no space around ','."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const SEMI_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missing", "A space is required around ';'."),
    ("unexpected", "There should be no space around ';'."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const SPACE_IN_PARENS_MESSAGES: &[(&str, &str)] = &[
    (
        "missingOpeningSpace",
        "There must be a space after this paren.",
    ),
    (
        "missingClosingSpace",
        "There must be a space before this paren.",
    ),
    (
        "rejectedOpeningSpace",
        "There should be no space after this paren.",
    ),
    (
        "rejectedClosingSpace",
        "There should be no space before this paren.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const TEMPLATE_CURLY_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("expectedBefore", "Expected space(s) before '}'."),
    ("expectedAfter", "Expected space(s) after '${'."),
    ("unexpectedBefore", "Unexpected space(s) before '}'."),
    ("unexpectedAfter", "Unexpected space(s) after '${'."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const REST_SPREAD_SPACING_MESSAGES: &[(&str, &str)] = &[
    (
        "expectedWhitespace",
        "Expected whitespace after spread operator.",
    ),
    (
        "unexpectedWhitespace",
        "Unexpected whitespace after spread operator.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const NO_MULTI_SPACES_MESSAGES: &[(&str, &str)] = &[
    ("multipleSpaces", "Multiple spaces found."),
    ("collapseSpace", "Collapse to a single space."),
];
const NO_WHITESPACE_BEFORE_PROPERTY_MESSAGES: &[(&str, &str)] = &[
    (
        "unexpectedWhitespace",
        "Unexpected whitespace before property.",
    ),
    ("removeSpace", "Remove the whitespace."),
];
const DOT_LOCATION_MESSAGES: &[(&str, &str)] = &[
    (
        "expectedDotAfterObject",
        "Expected dot to be on same line as object.",
    ),
    (
        "expectedDotBeforeProperty",
        "Expected dot to be on same line as property.",
    ),
    ("moveDot", "Move the dot."),
];
const SPACED_COMMENT_MESSAGES: &[(&str, &str)] = &[
    ("expectedSpaceAfter", "Expected space after comment marker."),
    (
        "unexpectedSpaceAfter",
        "Unexpected space after comment marker.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const OBJECT_CURLY_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("requireSpaceBefore", "A space is required before '}'."),
    ("requireSpaceAfter", "A space is required after '{'."),
    (
        "unexpectedSpaceBefore",
        "There should be no space before '}'.",
    ),
    (
        "unexpectedSpaceAfter",
        "There should be no space after '{'.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const ARRAY_BRACKET_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missingSpaceBefore", "A space is required before ']'."),
    ("missingSpaceAfter", "A space is required after '['."),
    (
        "unexpectedSpaceBefore",
        "There should be no space before ']'.",
    ),
    (
        "unexpectedSpaceAfter",
        "There should be no space after '['.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const COMPUTED_PROPERTY_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missingSpaceBefore", "A space is required before ']'."),
    ("missingSpaceAfter", "A space is required after '['."),
    (
        "unexpectedSpaceBefore",
        "There should be no space before ']'.",
    ),
    (
        "unexpectedSpaceAfter",
        "There should be no space after '['.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const BLOCK_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missing", "Requires a space inside of braces."),
    ("extra", "There should be no space inside of braces."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const SPACE_BEFORE_BLOCKS_MESSAGES: &[(&str, &str)] = &[
    ("missingSpace", "Missing space before opening brace."),
    ("unexpectedSpace", "Unexpected space before opening brace."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const FUNCTION_CALL_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missing", "Missing space between function name and paren."),
    (
        "unexpectedWhitespace",
        "Unexpected whitespace between function name and paren.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const SPACE_BEFORE_FUNCTION_PAREN_MESSAGES: &[(&str, &str)] = &[
    ("missingSpace", "Missing space before function parentheses."),
    (
        "unexpectedSpace",
        "Unexpected space before function parentheses.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const NO_FLOATING_DECIMAL_MESSAGES: &[(&str, &str)] = &[
    (
        "leading",
        "A leading decimal point can be confused with a dot.",
    ),
    (
        "trailing",
        "A trailing decimal point can be confused with a dot.",
    ),
    ("addZero", "Add a zero."),
];
const TEMPLATE_TAG_SPACING_MESSAGES: &[(&str, &str)] = &[
    (
        "unexpectedSpace",
        "Unexpected space between template tag and template literal.",
    ),
    (
        "missingSpace",
        "Expected space between template tag and template literal.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const YIELD_STAR_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missingBefore", "Missing space before *."),
    ("missingAfter", "Missing space after *."),
    ("unexpectedBefore", "Unexpected space before *."),
    ("unexpectedAfter", "Unexpected space after *."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const GENERATOR_STAR_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missingBefore", "Missing space before *."),
    ("missingAfter", "Missing space after *."),
    ("unexpectedBefore", "Unexpected space before *."),
    ("unexpectedAfter", "Unexpected space after *."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const COMMA_DANGLE_MESSAGES: &[(&str, &str)] = &[
    ("unexpected", "Unexpected trailing comma."),
    ("missing", "Missing trailing comma."),
    ("addComma", "Add a trailing comma."),
    ("removeComma", "Remove the trailing comma."),
];
const SPACE_INFIX_OPS_MESSAGES: &[(&str, &str)] = &[
    ("missingSpace", "Operator must be spaced."),
    ("insertSpace", "Insert a space."),
];
const MAX_LEN_MESSAGES: &[(&str, &str)] = &[
    ("tooLong", "This line exceeds the maximum allowed length."),
    (
        "tooLongComment",
        "This comment line exceeds the maximum allowed length.",
    ),
];
const SEMI_STYLE_MESSAGES: &[(&str, &str)] = &[
    (
        "expectedSemiColon",
        "Expected this semicolon to be at the line's edge.",
    ),
    ("moveSemi", "Move the semicolon."),
];
const COMMA_STYLE_MESSAGES: &[(&str, &str)] = &[
    ("expectedCommaLast", "',' should be placed last."),
    ("expectedCommaFirst", "',' should be placed first."),
    ("moveComma", "Move the comma."),
];
const ARROW_PARENS_MESSAGES: &[(&str, &str)] = &[
    (
        "expectedParens",
        "Expected parentheses around arrow function argument.",
    ),
    (
        "unexpectedParens",
        "Unexpected parentheses around single function argument.",
    ),
    ("addParens", "Add parentheses."),
];
const SWITCH_COLON_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("expectedSpaceAfter", "Expected space after colon."),
    ("unexpectedSpaceAfter", "Unexpected space after colon."),
    ("expectedSpaceBefore", "Expected space before colon."),
    ("unexpectedSpaceBefore", "Unexpected space before colon."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const NO_EXTRA_SEMI_MESSAGES: &[(&str, &str)] = &[
    ("unexpected", "Unnecessary semicolon."),
    ("removeSemi", "Remove the semicolon."),
];
const NEW_PARENS_MESSAGES: &[(&str, &str)] = &[
    (
        "missing",
        "Missing parentheses invoking a constructor with no arguments.",
    ),
    (
        "unexpected",
        "Unnecessary parentheses invoking a constructor with no arguments.",
    ),
    ("addParens", "Add parentheses."),
];
const SPACE_UNARY_OPS_MESSAGES: &[(&str, &str)] = &[
    (
        "wordOperatorAfter",
        "Unary word operator must be followed by whitespace.",
    ),
    (
        "nonwordOperatorAfter",
        "Unary operator must not be separated from its operand.",
    ),
    (
        "nonwordOperatorBefore",
        "Unary operator must not be separated from its operand.",
    ),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
];
const WRAP_REGEX_MESSAGES: &[(&str, &str)] = &[
    (
        "requireParens",
        "Wrap the regexp literal in parentheses to disambiguate the slash operator.",
    ),
    ("wrapRegex", "Wrap in parentheses."),
];
const IMPLICIT_ARROW_LINEBREAK_MESSAGES: &[(&str, &str)] = &[
    (
        "unexpectedLinebreak",
        "Expected no linebreak before arrow body.",
    ),
    (
        "missingLinebreak",
        "Expected a linebreak before arrow body.",
    ),
    ("joinLine", "Remove the linebreak."),
];
const OPERATOR_LINEBREAK_MESSAGES: &[(&str, &str)] = &[
    (
        "operatorAtBeginning",
        "Operator should be placed at the end of the line.",
    ),
    (
        "operatorAtEnd",
        "Operator should be placed at the beginning of the line.",
    ),
    (
        "badLinebreak",
        "Bad line breaking before and after operator.",
    ),
    (
        "noLinebreak",
        "There should be no line break before or after the operator.",
    ),
    ("moveOperator", "Move the operator."),
];
const KEYWORD_SPACING_MESSAGES: &[(&str, &str)] = &[
    ("missingBefore", "Expected space before keyword."),
    ("unexpectedBefore", "Unexpected space before keyword."),
    ("missingAfter", "Expected space after keyword."),
    ("unexpectedAfter", "Unexpected space after keyword."),
    ("insertSpace", "Insert a space."),
    ("removeSpace", "Remove the whitespace."),
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
    StylisticRuleDefinition {
        name: "arrow-spacing",
        docs_description: "Enforce consistent spacing before and after the arrow in arrow functions.",
        messages: ARROW_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "comma-spacing",
        docs_description: "Enforce consistent spacing before and after commas.",
        messages: COMMA_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "semi-spacing",
        docs_description: "Enforce consistent spacing before and after semicolons.",
        messages: SEMI_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "space-in-parens",
        docs_description: "Enforce consistent spacing inside parentheses.",
        messages: SPACE_IN_PARENS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "template-curly-spacing",
        docs_description: "Enforce consistent spacing inside template literal braces.",
        messages: TEMPLATE_CURLY_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "rest-spread-spacing",
        docs_description: "Enforce consistent spacing between rest/spread operators and their expressions.",
        messages: REST_SPREAD_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-multi-spaces",
        docs_description: "Disallow multiple spaces.",
        messages: NO_MULTI_SPACES_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-whitespace-before-property",
        docs_description: "Disallow whitespace before properties.",
        messages: NO_WHITESPACE_BEFORE_PROPERTY_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "dot-location",
        docs_description: "Enforce consistent newline placement around the dot in member expressions.",
        messages: DOT_LOCATION_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "spaced-comment",
        docs_description: "Enforce consistent spacing after the // or /* in a comment.",
        messages: SPACED_COMMENT_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "object-curly-spacing",
        docs_description: "Enforce consistent spacing inside braces of object literals, destructuring, and imports/exports.",
        messages: OBJECT_CURLY_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "array-bracket-spacing",
        docs_description: "Enforce consistent spacing inside array brackets.",
        messages: ARRAY_BRACKET_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "computed-property-spacing",
        docs_description: "Enforce consistent spacing inside computed member-access brackets.",
        messages: COMPUTED_PROPERTY_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "block-spacing",
        docs_description: "Enforce consistent spacing inside single-line blocks.",
        messages: BLOCK_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "space-before-blocks",
        docs_description: "Enforce consistent spacing before opening braces of blocks.",
        messages: SPACE_BEFORE_BLOCKS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "function-call-spacing",
        docs_description: "Enforce consistent spacing between a function name and its call parentheses.",
        messages: FUNCTION_CALL_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "space-before-function-paren",
        docs_description: "Enforce consistent spacing before function parentheses.",
        messages: SPACE_BEFORE_FUNCTION_PAREN_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-floating-decimal",
        docs_description: "Disallow leading or trailing decimal points in numeric literals.",
        messages: NO_FLOATING_DECIMAL_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "template-tag-spacing",
        docs_description: "Enforce consistent spacing between a template tag and its literal.",
        messages: TEMPLATE_TAG_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "yield-star-spacing",
        docs_description: "Enforce consistent spacing around the * in yield* expressions.",
        messages: YIELD_STAR_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "generator-star-spacing",
        docs_description: "Enforce consistent spacing around the * in generator functions.",
        messages: GENERATOR_STAR_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "comma-dangle",
        docs_description: "Require or disallow trailing commas.",
        messages: COMMA_DANGLE_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "space-infix-ops",
        docs_description: "Require spacing around infix operators.",
        messages: SPACE_INFIX_OPS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "max-len",
        docs_description: "Enforce a maximum line length.",
        messages: MAX_LEN_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "semi-style",
        docs_description: "Enforce location of semicolons.",
        messages: SEMI_STYLE_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "comma-style",
        docs_description: "Enforce consistent comma placement.",
        messages: COMMA_STYLE_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "arrow-parens",
        docs_description: "Require parentheses around arrow function arguments.",
        messages: ARROW_PARENS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "switch-colon-spacing",
        docs_description: "Enforce spacing around colons of switch statements.",
        messages: SWITCH_COLON_SPACING_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "no-extra-semi",
        docs_description: "Disallow unnecessary semicolons.",
        messages: NO_EXTRA_SEMI_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "new-parens",
        docs_description: "Enforce parentheses when invoking a constructor with no arguments.",
        messages: NEW_PARENS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "space-unary-ops",
        docs_description: "Enforce consistent spacing before or after unary operators.",
        messages: SPACE_UNARY_OPS_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "wrap-regex",
        docs_description: "Require parenthesising regex literals used as a member object.",
        messages: WRAP_REGEX_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "implicit-arrow-linebreak",
        docs_description: "Enforce the location of arrow function bodies with implicit returns.",
        messages: IMPLICIT_ARROW_LINEBREAK_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "operator-linebreak",
        docs_description: "Enforce consistent linebreak placement around operators.",
        messages: OPERATOR_LINEBREAK_MESSAGES,
    },
    StylisticRuleDefinition {
        name: "keyword-spacing",
        docs_description: "Enforce consistent spacing before and after keywords.",
        messages: KEYWORD_SPACING_MESSAGES,
    },
];

/// Rule names that run over the shared token + bracket-matching scan.
const TOKEN_RULE_NAMES: &[&str] = &[
    "arrow-spacing",
    "comma-spacing",
    "semi-spacing",
    "space-in-parens",
    "template-curly-spacing",
    "rest-spread-spacing",
    "no-multi-spaces",
    "no-whitespace-before-property",
    "dot-location",
    "spaced-comment",
    "object-curly-spacing",
    "array-bracket-spacing",
    "computed-property-spacing",
    "block-spacing",
    "space-before-blocks",
    "function-call-spacing",
    "space-before-function-paren",
    "no-floating-decimal",
    "template-tag-spacing",
    "yield-star-spacing",
    "generator-star-spacing",
    "comma-dangle",
    "space-infix-ops",
    "semi-style",
    "comma-style",
    "arrow-parens",
    "switch-colon-spacing",
    "no-extra-semi",
    "new-parens",
    "space-unary-ops",
    "wrap-regex",
    "implicit-arrow-linebreak",
    "operator-linebreak",
    "keyword-spacing",
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
            bridge: RuleBridgeRequirements::default_for_type_texts(false),
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
            "linebreak-style"
                | "no-multiple-empty-lines"
                | "no-tabs"
                | "no-trailing-spaces"
                | "max-len"
        )
    });
    let lines = needs_lines.then(|| line_index::collect_lines(source_text));
    // Token rules share one tokenization pass, built lazily only when needed.
    let needs_tokens = config
        .rules
        .iter()
        .any(|rule| TOKEN_RULE_NAMES.contains(&rule.name.as_str()));
    let token_scan = needs_tokens.then(|| context::Scan::new(source_text));
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
            "max-len" => line_rules::check_max_len(
                source_text,
                lines.as_deref().unwrap_or(&[]),
                &rule.options,
                &mut diagnostics,
            ),
            "quotes" => quotes::check_quotes(source_text, &rule.options, &mut diagnostics),
            "unicode-bom" => {
                unicode_bom::check_unicode_bom(source_text, &rule.options, &mut diagnostics)
            }
            name if TOKEN_RULE_NAMES.contains(&name) => {
                let scan = token_scan
                    .as_ref()
                    .expect("token scan is built when a token rule is enabled");
                run_token_rule(name, scan, &rule.options, &mut diagnostics);
            }
            unknown => return Err(format!("unknown native stylistic rule: {unknown}")),
        }
    }

    Ok(diagnostics)
}

/// Dispatches a single token-stream stylistic rule over the shared scan.
fn run_token_rule(
    name: &str,
    scan: &context::Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    match name {
        "arrow-spacing" => token_rules::check_arrow_spacing(scan, options, diagnostics),
        "comma-spacing" => token_rules::check_comma_spacing(scan, options, diagnostics),
        "semi-spacing" => token_rules::check_semi_spacing(scan, options, diagnostics),
        "space-in-parens" => token_rules::check_space_in_parens(scan, options, diagnostics),
        "template-curly-spacing" => {
            token_rules::check_template_curly_spacing(scan, options, diagnostics)
        }
        "rest-spread-spacing" => token_rules::check_rest_spread_spacing(scan, options, diagnostics),
        "no-multi-spaces" => token_rules::check_no_multi_spaces(scan, options, diagnostics),
        "no-whitespace-before-property" => {
            token_rules::check_no_whitespace_before_property(scan, options, diagnostics)
        }
        "dot-location" => token_rules::check_dot_location(scan, options, diagnostics),
        "spaced-comment" => token_rules::check_spaced_comment(scan, options, diagnostics),
        "object-curly-spacing" => {
            context_rules::check_object_curly_spacing(scan, options, diagnostics)
        }
        "array-bracket-spacing" => {
            context_rules::check_array_bracket_spacing(scan, options, diagnostics)
        }
        "computed-property-spacing" => {
            context_rules::check_computed_property_spacing(scan, options, diagnostics)
        }
        "block-spacing" => context_rules::check_block_spacing(scan, options, diagnostics),
        "space-before-blocks" => {
            context_rules::check_space_before_blocks(scan, options, diagnostics)
        }
        "function-call-spacing" => {
            context_rules::check_function_call_spacing(scan, options, diagnostics)
        }
        "space-before-function-paren" => {
            context_rules::check_space_before_function_paren(scan, options, diagnostics)
        }
        "no-floating-decimal" => {
            context_rules::check_no_floating_decimal(scan, options, diagnostics)
        }
        "template-tag-spacing" => {
            context_rules::check_template_tag_spacing(scan, options, diagnostics)
        }
        "yield-star-spacing" => context_rules::check_yield_star_spacing(scan, options, diagnostics),
        "generator-star-spacing" => {
            context_rules::check_generator_star_spacing(scan, options, diagnostics)
        }
        "comma-dangle" => context_rules::check_comma_dangle(scan, options, diagnostics),
        "space-infix-ops" => context_rules::check_space_infix_ops(scan, options, diagnostics),
        "semi-style" => context_rules::check_semi_style(scan, options, diagnostics),
        "comma-style" => context_rules::check_comma_style(scan, options, diagnostics),
        "arrow-parens" => context_rules::check_arrow_parens(scan, options, diagnostics),
        "switch-colon-spacing" => {
            context_rules::check_switch_colon_spacing(scan, options, diagnostics)
        }
        "no-extra-semi" => context_rules::check_no_extra_semi(scan, options, diagnostics),
        "new-parens" => context_rules::check_new_parens(scan, options, diagnostics),
        "space-unary-ops" => context_rules::check_space_unary_ops(scan, options, diagnostics),
        "wrap-regex" => context_rules::check_wrap_regex(scan, options, diagnostics),
        "implicit-arrow-linebreak" => {
            context_rules::check_implicit_arrow_linebreak(scan, options, diagnostics)
        }
        "operator-linebreak" => context_rules::check_operator_linebreak(scan, options, diagnostics),
        "keyword-spacing" => context_rules::check_keyword_spacing(scan, options, diagnostics),
        _ => {}
    }
}
