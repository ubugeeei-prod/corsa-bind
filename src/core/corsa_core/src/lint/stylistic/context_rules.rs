//! Stylistic rules that need light structural context (bracket kinds, paren
//! uses) from [`super::context::Scan`]. They share the same single
//! tokenization + bracket-matching pass as the pure token rules.

use serde_json::Value;

use crate::lint::LintDiagnostic;

use super::context::{
    BraceKind, BracketKind, ParenUse, Scan, has_newline, is_whitespace, option_keyword,
    option_object_bool, punct_is, report_missing_space, report_replace, report_unexpected_space,
};
use super::lexer::TokenKind;

/// Spacing check shared by the `{ }` / `[ ]` bracket-spacing rules: enforces
/// "always" (one inner space) or "never" (no inner space) just inside a pair of
/// brackets, skipping empty pairs and multiline pairs.
#[allow(clippy::too_many_arguments)]
fn check_inner_spacing(
    scan: &Scan,
    open_index: usize,
    close_index: usize,
    always: bool,
    rule: &'static str,
    missing_after: &'static str,
    missing_before: &'static str,
    unexpected_after: &'static str,
    unexpected_before: &'static str,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let tokens = scan.tokens();
    let open = &tokens[open_index];
    let close = &tokens[close_index];
    // Empty pair: the close bracket directly follows the open one.
    if open_index + 1 == close_index {
        return;
    }
    // `@stylistic` measures spacing against the *immediately* adjacent token,
    // comments included, so `{ /* c */ x }` is flagged on both sides.
    let first_inner = &tokens[open_index + 1];
    let after_open = scan.gap(open, first_inner);
    if !has_newline(after_open) {
        if always && after_open.is_empty() {
            report_missing_space(
                diagnostics,
                rule,
                missing_after,
                "A space is required after this bracket.",
                open.end,
            );
        } else if !always && is_whitespace(after_open) {
            report_unexpected_space(
                diagnostics,
                rule,
                unexpected_after,
                "There should be no space after this bracket.",
                open.end,
                first_inner.start,
            );
        }
    }
    let last_inner = &tokens[close_index - 1];
    let before_close = scan.gap(last_inner, close);
    if !has_newline(before_close) {
        if always && before_close.is_empty() {
            report_missing_space(
                diagnostics,
                rule,
                missing_before,
                "A space is required before this bracket.",
                close.start,
            );
        } else if !always && is_whitespace(before_close) {
            report_unexpected_space(
                diagnostics,
                rule,
                unexpected_before,
                "There should be no space before this bracket.",
                last_inner.end,
                close.start,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// object-curly-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_object_curly_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "object-curly-spacing";
    let always = option_keyword(options, "never") == "always";
    for index in 0..scan.tokens().len() {
        if !punct_is(&scan.tokens()[index], scan.source(), "{") {
            continue;
        }
        if scan.brace_kind(index) != BraceKind::ObjectLike {
            continue;
        }
        let Some(close) = scan.partner(index) else {
            continue;
        };
        check_inner_spacing(
            scan,
            index,
            close,
            always,
            RULE,
            "requireSpaceAfter",
            "requireSpaceBefore",
            "unexpectedSpaceAfter",
            "unexpectedSpaceBefore",
            diagnostics,
        );
    }
}

// ---------------------------------------------------------------------------
// array-bracket-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_array_bracket_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "array-bracket-spacing";
    let always = option_keyword(options, "never") == "always";
    for index in 0..scan.tokens().len() {
        if !punct_is(&scan.tokens()[index], scan.source(), "[") {
            continue;
        }
        if scan.bracket_kind(index) != BracketKind::Array {
            continue;
        }
        let Some(close) = scan.partner(index) else {
            continue;
        };
        check_inner_spacing(
            scan,
            index,
            close,
            always,
            RULE,
            "missingSpaceAfter",
            "missingSpaceBefore",
            "unexpectedSpaceAfter",
            "unexpectedSpaceBefore",
            diagnostics,
        );
    }
}

// ---------------------------------------------------------------------------
// computed-property-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_computed_property_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "computed-property-spacing";
    let always = option_keyword(options, "never") == "always";
    for index in 0..scan.tokens().len() {
        if !punct_is(&scan.tokens()[index], scan.source(), "[") {
            continue;
        }
        if scan.bracket_kind(index) != BracketKind::Member {
            continue;
        }
        let Some(close) = scan.partner(index) else {
            continue;
        };
        check_inner_spacing(
            scan,
            index,
            close,
            always,
            RULE,
            "missingSpaceAfter",
            "missingSpaceBefore",
            "unexpectedSpaceAfter",
            "unexpectedSpaceBefore",
            diagnostics,
        );
    }
}

// ---------------------------------------------------------------------------
// block-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_block_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "block-spacing";
    let always = option_keyword(options, "always") != "never";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "{") {
            continue;
        }
        if scan.brace_kind(index) != BraceKind::Block {
            continue;
        }
        let Some(close) = scan.partner(index) else {
            continue;
        };
        // Only single-line blocks are in scope.
        if has_newline(scan.slice(tokens[index].start, tokens[close].end)) {
            continue;
        }
        check_inner_spacing(
            scan,
            index,
            close,
            always,
            RULE,
            "missing",
            "missing",
            "extra",
            "extra",
            diagnostics,
        );
    }
}

// ---------------------------------------------------------------------------
// space-before-blocks
// ---------------------------------------------------------------------------

pub(crate) fn check_space_before_blocks(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "space-before-blocks";
    let always = option_keyword(options, "always") != "never";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "{") {
            continue;
        }
        if scan.brace_kind(index) != BraceKind::Block {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        // A `{` right after `(`, `)`-less... skip when previous is `{`/`)` of a
        // missing case; ESLint only requires a space when the block follows a
        // token on the same line.
        let gap = scan.gap(&tokens[prev], &tokens[index]);
        if has_newline(gap) {
            continue;
        }
        // Do not require a space directly after `(` (e.g. `switch (x){`'s prev is
        // `)`), or after another `{`.
        if punct_is(&tokens[prev], scan.source(), "{") {
            continue;
        }
        if always && gap.is_empty() {
            report_missing_space(
                diagnostics,
                RULE,
                "missingSpace",
                "Missing space before opening brace.",
                tokens[index].start,
            );
        } else if !always && is_whitespace(gap) {
            report_unexpected_space(
                diagnostics,
                RULE,
                "unexpectedSpace",
                "Unexpected space before opening brace.",
                tokens[prev].end,
                tokens[index].start,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// function-call-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_function_call_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "function-call-spacing";
    let always = option_keyword(options, "never") == "always";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "(") {
            continue;
        }
        if scan.paren_use(index) != ParenUse::Call {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        let gap = scan.gap(&tokens[prev], &tokens[index]);
        if always {
            // "always" requires exactly one space; newlines are not a space.
            if gap.is_empty() {
                report_missing_space(
                    diagnostics,
                    RULE,
                    "missing",
                    "Missing space between function name and paren.",
                    tokens[index].start,
                );
            }
        } else if !gap.is_empty() {
            // "never" disallows any whitespace, including newlines.
            let (id, message) = if has_newline(gap) {
                (
                    "unexpectedNewline",
                    "Unexpected newline between function name and paren.",
                )
            } else {
                (
                    "unexpectedWhitespace",
                    "Unexpected whitespace between function name and paren.",
                )
            };
            report_unexpected_space(
                diagnostics,
                RULE,
                id,
                message,
                tokens[prev].end,
                tokens[index].start,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// space-before-function-paren
// ---------------------------------------------------------------------------

/// Modifier keywords that, immediately before a method name, mark a method or
/// accessor definition.
const METHOD_MODIFIERS: &[&str] = &[
    "get",
    "set",
    "async",
    "static",
    "public",
    "private",
    "protected",
    "readonly",
    "abstract",
    "declare",
    "override",
];

/// Whether the `(` at `open_index` opens a function/method/accessor parameter
/// list, an async-arrow parameter list, or a `catch` binding — the parentheses
/// that `space-before-function-paren` governs.
///
/// Deliberately conservative: it never classifies a *call* as a definition, so
/// it can miss a plain class method (`class C { m() {} }`) rather than risk a
/// false positive on `arr.map(fn)`.
fn is_sbfp_paren(scan: &Scan, open_index: usize) -> bool {
    let tokens = scan.tokens();
    let Some(prev) = scan.prev_significant(open_index) else {
        return false;
    };
    let prev_kind = tokens[prev].kind;
    let prev_text = scan.token_text(prev);
    if prev_kind == TokenKind::Identifier && matches!(prev_text, "catch" | "function") {
        return true;
    }
    // `async ( … ) =>` — an async arrow's parameter list.
    if prev_kind == TokenKind::Identifier && prev_text == "async" {
        if let Some(close) = scan.partner(open_index) {
            if let Some(after) = scan.next_significant(close) {
                if punct_is(&tokens[after], scan.source(), "=>") {
                    return true;
                }
            }
        }
    }
    if prev_kind != TokenKind::Identifier {
        return false;
    }
    if prev_text == "constructor" {
        return true;
    }
    let Some(p2) = scan.prev_significant(prev) else {
        return false;
    };
    let p2_kind = tokens[p2].kind;
    let p2_text = scan.token_text(p2);
    if p2_kind == TokenKind::Identifier && p2_text == "function" {
        return true;
    }
    if p2_kind == TokenKind::Identifier && METHOD_MODIFIERS.contains(&p2_text) {
        return true;
    }
    if punct_is(&tokens[p2], scan.source(), "*") {
        return true;
    }
    // Object shorthand method: `{ name() {} }` / `{ a, name() {} }`.
    if punct_is(&tokens[p2], scan.source(), "{") && scan.brace_kind(p2) == BraceKind::ObjectLike {
        return true;
    }
    if punct_is(&tokens[p2], scan.source(), ",") {
        if let Some(close) = scan.partner(open_index) {
            if let Some(after) = scan.next_significant(close) {
                if punct_is(&tokens[after], scan.source(), "{") {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn check_space_before_function_paren(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "space-before-function-paren";
    let always = option_keyword(options, "always") != "never";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "(") {
            continue;
        }
        if !is_sbfp_paren(scan, index) {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        let gap = scan.gap(&tokens[prev], &tokens[index]);
        if has_newline(gap) {
            continue;
        }
        if always && gap.is_empty() {
            report_missing_space(
                diagnostics,
                RULE,
                "missingSpace",
                "Missing space before function parentheses.",
                tokens[index].start,
            );
        } else if !always && is_whitespace(gap) {
            report_unexpected_space(
                diagnostics,
                RULE,
                "unexpectedSpace",
                "Unexpected space before function parentheses.",
                tokens[prev].end,
                tokens[index].start,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// no-floating-decimal
// ---------------------------------------------------------------------------

pub(crate) fn check_no_floating_decimal(
    scan: &Scan,
    _options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "no-floating-decimal";
    for token in scan.tokens() {
        if token.kind != TokenKind::Number {
            continue;
        }
        let text = scan.slice(token.start, token.end);
        if let Some(rest) = text.strip_prefix('.') {
            if rest.bytes().next().is_some_and(|b| b.is_ascii_digit()) {
                report_replace(
                    diagnostics,
                    RULE,
                    "leading",
                    "A leading decimal point can be confused with a dot.",
                    token.start,
                    token.start,
                    "addZero",
                    "Add a zero before the decimal point.",
                    "0",
                );
            }
        } else if text.ends_with('.') {
            report_replace(
                diagnostics,
                RULE,
                "trailing",
                "A trailing decimal point can be confused with a dot.",
                token.end,
                token.end,
                "addZero",
                "Add a zero after the decimal point.",
                "0",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// template-tag-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_template_tag_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "template-tag-spacing";
    let always = option_keyword(options, "never") == "always";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        let token = &tokens[index];
        if !matches!(
            token.kind,
            TokenKind::NoSubTemplate | TokenKind::TemplateHead
        ) {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        // Only a tagged template (callee directly before the quasi) is in scope.
        if !scan.token_ends_expression(prev) {
            continue;
        }
        let gap = scan.gap(&tokens[prev], token);
        if always && gap.is_empty() {
            report_missing_space(
                diagnostics,
                RULE,
                "missingSpace",
                "Expected space between template tag and template literal.",
                token.start,
            );
        } else if !always && !gap.is_empty() {
            // "never" disallows any whitespace, newlines included.
            report_unexpected_space(
                diagnostics,
                RULE,
                "unexpectedSpace",
                "Unexpected space between template tag and template literal.",
                tokens[prev].end,
                token.start,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// yield-star-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_yield_star_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "yield-star-spacing";
    let before = option_object_bool(options, "before", false);
    let after = option_object_bool(options, "after", true);
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "*") {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        if !(tokens[prev].kind == TokenKind::Identifier && scan.token_text(prev) == "yield") {
            continue;
        }
        check_star_spacing(scan, prev, index, before, after, RULE, diagnostics);
    }
}

// ---------------------------------------------------------------------------
// generator-star-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_generator_star_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "generator-star-spacing";
    // `@stylistic` defaults generators to `{ before: true, after: false }`
    // (i.e. `function *foo`), the mirror of yield-star-spacing.
    let before = option_object_bool(options, "before", true);
    let after = option_object_bool(options, "after", false);
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "*") {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        // A generator star sits right after the `function` keyword.
        if !(tokens[prev].kind == TokenKind::Identifier && scan.token_text(prev) == "function") {
            continue;
        }
        check_star_spacing(scan, prev, index, before, after, RULE, diagnostics);
    }
}

/// Shared `before`/`after` spacing check for a `*` between `prev` and `next`.
fn check_star_spacing(
    scan: &Scan,
    prev: usize,
    star: usize,
    before: bool,
    after: bool,
    rule: &'static str,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    let tokens = scan.tokens();
    let before_gap = scan.gap(&tokens[prev], &tokens[star]);
    if !has_newline(before_gap) {
        if before && before_gap.is_empty() {
            report_missing_space(
                diagnostics,
                rule,
                "missingBefore",
                "Missing space before *.",
                tokens[star].start,
            );
        } else if !before && is_whitespace(before_gap) {
            report_unexpected_space(
                diagnostics,
                rule,
                "unexpectedBefore",
                "Unexpected space before *.",
                tokens[prev].end,
                tokens[star].start,
            );
        }
    }
    if let Some(next) = scan.next_significant(star) {
        let after_gap = scan.gap(&tokens[star], &tokens[next]);
        if !has_newline(after_gap) {
            if after && after_gap.is_empty() {
                report_missing_space(
                    diagnostics,
                    rule,
                    "missingAfter",
                    "Missing space after *.",
                    tokens[star].end,
                );
            } else if !after && is_whitespace(after_gap) {
                report_unexpected_space(
                    diagnostics,
                    rule,
                    "unexpectedAfter",
                    "Unexpected space after *.",
                    tokens[star].end,
                    tokens[next].start,
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// comma-dangle
// ---------------------------------------------------------------------------

pub(crate) fn check_comma_dangle(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "comma-dangle";
    let setting = option_keyword(options, "never");
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        let close = &tokens[index];
        let is_closer = punct_is(close, scan.source(), "]")
            || punct_is(close, scan.source(), "}")
            || punct_is(close, scan.source(), ")");
        if !is_closer {
            continue;
        }
        // `)` only dangles for call/parameter lists, not control or grouping.
        if punct_is(close, scan.source(), ")")
            && !matches!(
                scan.paren_use_close(index),
                Some(ParenUse::Call) | Some(ParenUse::FuncDef)
            )
        {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        // Empty construct (matching open is directly before close): nothing to
        // dangle.
        if scan.partner(index) == Some(prev) {
            continue;
        }
        let prev_token = &tokens[prev];
        let is_multiline = scan
            .partner(index)
            .map(|open| has_newline(scan.slice(tokens[open].start, close.end)))
            .unwrap_or(false);
        let has_trailing_comma = punct_is(prev_token, scan.source(), ",");
        enum Action {
            None,
            Unexpected,
            Missing,
        }
        let action = match setting {
            "always" => {
                if has_trailing_comma {
                    Action::None
                } else {
                    Action::Missing
                }
            }
            "always-multiline" => match (is_multiline, has_trailing_comma) {
                (true, false) => Action::Missing,
                (false, true) => Action::Unexpected,
                _ => Action::None,
            },
            "only-multiline" => {
                if !is_multiline && has_trailing_comma {
                    Action::Unexpected
                } else {
                    Action::None
                }
            }
            _ => {
                if has_trailing_comma {
                    Action::Unexpected
                } else {
                    Action::None
                }
            }
        };
        match action {
            Action::Unexpected => report_replace(
                diagnostics,
                RULE,
                "unexpected",
                "Unexpected trailing comma.",
                prev_token.start,
                prev_token.end,
                "removeComma",
                "Remove the trailing comma.",
                "",
            ),
            Action::Missing => report_replace(
                diagnostics,
                RULE,
                "missing",
                "Missing trailing comma.",
                prev_token.end,
                prev_token.end,
                "addComma",
                "Add a trailing comma.",
                ",",
            ),
            Action::None => {}
        }
    }
}

// ---------------------------------------------------------------------------
// space-infix-ops
// ---------------------------------------------------------------------------

/// Binary operators whose infix use requires surrounding spaces. `<` and `>`
/// are intentionally excluded because they are ambiguous with TypeScript
/// generics and JSX without a real parser.
fn is_infix_operator(text: &str) -> bool {
    matches!(
        text,
        "+" | "-"
            | "*"
            | "/"
            | "%"
            | "**"
            | "=="
            | "==="
            | "!="
            | "!=="
            | "<="
            | ">="
            | "&&"
            | "||"
            | "??"
            | "&"
            | "|"
            | "^"
            | "<<"
            | ">>"
            | ">>>"
            | "="
            | "+="
            | "-="
            | "*="
            | "/="
            | "%="
            | "**="
            | "&&="
            | "||="
            | "??="
            | "&="
            | "|="
            | "^="
            | "<<="
            | ">>="
            | ">>>="
    )
}

pub(crate) fn check_space_infix_ops(
    scan: &Scan,
    _options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "space-infix-ops";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        let token = &tokens[index];
        if token.kind != TokenKind::Punctuator {
            continue;
        }
        let text = scan.token_text(index);
        if !is_infix_operator(text) {
            continue;
        }
        let (Some(prev), Some(next)) = (scan.prev_significant(index), scan.next_significant(index))
        else {
            continue;
        };
        // Infix only when the previous token ends an expression (otherwise it is
        // a unary `+`/`-`, a generator `*`, a default-value `=` in a binding, …
        // which other rules own).
        if !scan.token_ends_expression(prev) {
            continue;
        }
        let before = scan.gap(&tokens[prev], token);
        let after = scan.gap(token, &tokens[next]);
        // `@stylistic` reports a single violation per operator that is missing a
        // space on either side, pointing at the operator itself.
        if before.is_empty() || after.is_empty() {
            report_missing_space(
                diagnostics,
                RULE,
                "missingSpace",
                "Operator must be spaced.",
                token.start,
            );
        }
    }
}

/// Marks every `;` token that sits directly inside a `for ( … )` header, where
/// semicolons are required and rules like no-extra-semi / semi-style must not
/// fire.
fn for_header_semis(scan: &Scan) -> Vec<bool> {
    let tokens = scan.tokens();
    let mut marks = vec![false; tokens.len()];
    // Stack of "is this open paren a for-header paren?".
    let mut paren_stack: Vec<bool> = Vec::new();
    for index in 0..tokens.len() {
        let token = &tokens[index];
        if token.kind != TokenKind::Punctuator {
            continue;
        }
        match scan.token_text(index) {
            "(" => {
                let is_for = scan
                    .prev_significant(index)
                    .map(|p| tokens[p].kind == TokenKind::Identifier && scan.token_text(p) == "for")
                    .unwrap_or(false);
                paren_stack.push(is_for);
            }
            ")" => {
                paren_stack.pop();
            }
            ";" if paren_stack.last() == Some(&true) => {
                marks[index] = true;
            }
            _ => {}
        }
    }
    marks
}

// ---------------------------------------------------------------------------
// semi-style
// ---------------------------------------------------------------------------

pub(crate) fn check_semi_style(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "semi-style";
    let first = option_keyword(options, "last") == "first";
    let tokens = scan.tokens();
    let for_semis = for_header_semis(scan);
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), ";") || for_semis[index] {
            continue;
        }
        let before_newline = index
            .checked_sub(1)
            .map(|p| has_newline(scan.gap(&tokens[p], &tokens[index])))
            .unwrap_or(false);
        let after_newline = tokens
            .get(index + 1)
            .map(|next| has_newline(scan.gap(&tokens[index], next)))
            .unwrap_or(false);
        // "last": the semicolon must hug the end of its statement's line, so a
        // line break *before* it is wrong. "first": the mirror.
        let violation = if first { after_newline } else { before_newline };
        if violation {
            report_replace(
                diagnostics,
                RULE,
                "expectedSemiColon",
                "Expected this semicolon to be at the line's edge.",
                tokens[index].start,
                tokens[index].end,
                "moveSemi",
                "Move the semicolon.",
                ";",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// comma-style
// ---------------------------------------------------------------------------

pub(crate) fn check_comma_style(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "comma-style";
    let first = option_keyword(options, "last") == "first";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), ",") {
            continue;
        }
        let before_newline = index
            .checked_sub(1)
            .map(|p| has_newline(scan.gap(&tokens[p], &tokens[index])))
            .unwrap_or(false);
        let after_newline = tokens
            .get(index + 1)
            .map(|next| has_newline(scan.gap(&tokens[index], next)))
            .unwrap_or(false);
        if !first && before_newline {
            report_replace(
                diagnostics,
                RULE,
                "expectedCommaLast",
                "',' should be placed last.",
                tokens[index].start,
                tokens[index].end,
                "moveComma",
                "Move the comma.",
                ",",
            );
        } else if first && after_newline {
            report_replace(
                diagnostics,
                RULE,
                "expectedCommaFirst",
                "',' should be placed first.",
                tokens[index].start,
                tokens[index].end,
                "moveComma",
                "Move the comma.",
                ",",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// arrow-parens
// ---------------------------------------------------------------------------

pub(crate) fn check_arrow_parens(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "arrow-parens";
    let as_needed = option_keyword(options, "always") == "as-needed";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "=>") {
            continue;
        }
        let Some(prev) = scan.prev_significant(index) else {
            continue;
        };
        if !as_needed {
            // "always": a single unparenthesised parameter is a bare identifier
            // directly before the arrow.
            if tokens[prev].kind == TokenKind::Identifier && scan.token_text(prev) != "async" {
                report_replace(
                    diagnostics,
                    RULE,
                    "expectedParens",
                    "Expected parentheses around arrow function argument.",
                    tokens[prev].start,
                    tokens[prev].end,
                    "addParens",
                    "Add parentheses.",
                    scan.token_text(prev),
                );
            }
        } else if punct_is(&tokens[prev], scan.source(), ")") {
            // "as-needed": a single simple parameter wrapped in parens —
            // `(a) =>` — should drop them. Only `( <ident> )` with nothing else.
            if let Some(open) = scan.partner(prev) {
                let inner_is_single_ident =
                    prev == open + 2 && tokens[open + 1].kind == TokenKind::Identifier;
                if inner_is_single_ident {
                    report_replace(
                        diagnostics,
                        RULE,
                        "unexpectedParens",
                        "Unexpected parentheses around single function argument.",
                        tokens[open].start,
                        tokens[prev].end,
                        "removeParens",
                        "Remove parentheses.",
                        scan.token_text(open + 1),
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// switch-colon-spacing
// ---------------------------------------------------------------------------

pub(crate) fn check_switch_colon_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "switch-colon-spacing";
    let after = option_object_bool(options, "after", true);
    let before = option_object_bool(options, "before", false);
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        let is_label = tokens[index].kind == TokenKind::Identifier
            && matches!(scan.token_text(index), "case" | "default");
        if !is_label {
            continue;
        }
        // Find the colon that terminates this label, ignoring nested brackets
        // and ternary `?:`.
        let Some(colon) = find_case_colon(scan, index) else {
            continue;
        };
        if let Some(prev) = scan.prev_significant(colon) {
            let gap = scan.gap(&tokens[prev], &tokens[colon]);
            if before && gap.is_empty() {
                report_missing_space(
                    diagnostics,
                    RULE,
                    "expectedSpaceBefore",
                    "Expected space before colon.",
                    tokens[colon].start,
                );
            } else if !before && is_whitespace(gap) && !has_newline(gap) {
                report_unexpected_space(
                    diagnostics,
                    RULE,
                    "unexpectedSpaceBefore",
                    "Unexpected space before colon.",
                    tokens[prev].end,
                    tokens[colon].start,
                );
            }
        }
        if let Some(next) = scan.next_significant(colon) {
            let gap = scan.gap(&tokens[colon], &tokens[next]);
            if after && gap.is_empty() {
                report_missing_space(
                    diagnostics,
                    RULE,
                    "expectedSpaceAfter",
                    "Expected space after colon.",
                    tokens[colon].end,
                );
            } else if !after && is_whitespace(gap) && !has_newline(gap) {
                report_unexpected_space(
                    diagnostics,
                    RULE,
                    "unexpectedSpaceAfter",
                    "Unexpected space after colon.",
                    tokens[colon].end,
                    tokens[next].start,
                );
            }
        }
    }
}

/// Finds the `:` that ends a `case`/`default` label starting at `label_index`.
fn find_case_colon(scan: &Scan, label_index: usize) -> Option<usize> {
    let tokens = scan.tokens();
    let mut depth = 0i32;
    let mut ternary = 0i32;
    let mut index = label_index + 1;
    while index < tokens.len() {
        if tokens[index].kind == TokenKind::Punctuator {
            match scan.token_text(index) {
                "(" | "[" | "{" => depth += 1,
                ")" | "]" | "}" => {
                    if depth == 0 {
                        return None;
                    }
                    depth -= 1;
                }
                "?" if depth == 0 => ternary += 1,
                ":" if depth == 0 => {
                    if ternary == 0 {
                        return Some(index);
                    }
                    ternary -= 1;
                }
                _ => {}
            }
        }
        index += 1;
    }
    None
}

// ---------------------------------------------------------------------------
// no-extra-semi
// ---------------------------------------------------------------------------

pub(crate) fn check_no_extra_semi(
    scan: &Scan,
    _options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "no-extra-semi";
    let tokens = scan.tokens();
    let for_semis = for_header_semis(scan);
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), ";") || for_semis[index] {
            continue;
        }
        // An empty statement: the previous significant token is `;`, a block
        // boundary, or the start of input. A `}` that closes an object literal
        // still needs its `;`, so only *block* braces count.
        let extra = match scan.prev_significant(index) {
            None => true,
            Some(prev) => {
                if punct_is(&tokens[prev], scan.source(), ";") {
                    true
                } else if punct_is(&tokens[prev], scan.source(), "{") {
                    true
                } else if punct_is(&tokens[prev], scan.source(), "}") {
                    scan.partner(prev)
                        .map(|open| scan.brace_kind(open) == BraceKind::Block)
                        .unwrap_or(false)
                } else {
                    false
                }
            }
        };
        if extra {
            report_replace(
                diagnostics,
                RULE,
                "unexpected",
                "Unnecessary semicolon.",
                tokens[index].start,
                tokens[index].end,
                "removeSemi",
                "Remove the semicolon.",
                "",
            );
        }
    }
}

// ---------------------------------------------------------------------------
// new-parens
// ---------------------------------------------------------------------------

pub(crate) fn check_new_parens(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "new-parens";
    let never = option_keyword(options, "always") == "never";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !(tokens[index].kind == TokenKind::Identifier && scan.token_text(index) == "new") {
            continue;
        }
        // Walk the constructor's member expression: Name(.Name|[...])*.
        let Some(mut cursor) = scan.next_significant(index) else {
            continue;
        };
        if tokens[cursor].kind != TokenKind::Identifier {
            continue; // `new (expr)()` and similar — out of this simple scope.
        }
        loop {
            let Some(next) = scan.next_significant(cursor) else {
                break;
            };
            if punct_is(&tokens[next], scan.source(), ".") {
                let Some(name) = scan.next_significant(next) else {
                    break;
                };
                cursor = name;
            } else if punct_is(&tokens[next], scan.source(), "[") {
                let Some(close) = scan.partner(next) else {
                    break;
                };
                cursor = close;
            } else {
                break;
            }
        }
        let call_open = scan
            .next_significant(cursor)
            .filter(|&n| punct_is(&tokens[n], scan.source(), "("));
        if !never {
            if call_open.is_none() {
                report_replace(
                    diagnostics,
                    RULE,
                    "missing",
                    "Missing parentheses invoking a constructor with no arguments.",
                    tokens[cursor].end,
                    tokens[cursor].end,
                    "addParens",
                    "Add parentheses.",
                    "()",
                );
            }
        } else if let Some(open) = call_open {
            // "never": empty `()` after an argument-less `new` must be removed.
            let empty = scan
                .next_significant(open)
                .map(|n| punct_is(&tokens[n], scan.source(), ")"))
                .unwrap_or(false);
            if empty {
                let close = scan.partner(open).unwrap_or(open);
                report_replace(
                    diagnostics,
                    RULE,
                    "unexpected",
                    "Unnecessary parentheses invoking a constructor with no arguments.",
                    tokens[open].start,
                    tokens[close].end,
                    "removeParens",
                    "Remove parentheses.",
                    "",
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// space-unary-ops
// ---------------------------------------------------------------------------

const WORD_UNARY_OPS: &[&str] = &["new", "delete", "typeof", "void", "yield", "await"];

pub(crate) fn check_space_unary_ops(
    scan: &Scan,
    _options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "space-unary-ops";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        let token = &tokens[index];
        match token.kind {
            // Word operators (`words: true`): a space is required after them.
            TokenKind::Identifier if WORD_UNARY_OPS.contains(&scan.token_text(index)) => {
                let Some(next) = scan.next_significant(index) else {
                    continue;
                };
                // `new.target` and a postfix-less use are not unary operands.
                if punct_is(&tokens[next], scan.source(), ".") {
                    continue;
                }
                if scan.gap(token, &tokens[next]).is_empty() {
                    report_missing_space(
                        diagnostics,
                        RULE,
                        "wordOperatorAfter",
                        "Unary word operator must be followed by whitespace.",
                        token.end,
                    );
                }
            }
            // Nonword operators (`nonwords: false`): no space against operand.
            TokenKind::Punctuator => {
                let text = scan.token_text(index);
                let prev_ends = scan
                    .prev_significant(index)
                    .map(|p| scan.token_ends_expression(p))
                    .unwrap_or(false);
                match text {
                    // A `!` after an expression is TypeScript's postfix non-null
                    // assertion; otherwise it is prefix logical-not.
                    "!" if prev_ends => {
                        if let Some(prev) = scan.prev_significant(index) {
                            let gap = scan.gap(&tokens[prev], token);
                            if is_whitespace(gap) && !has_newline(gap) {
                                report_unexpected_space(
                                    diagnostics,
                                    RULE,
                                    "nonwordOperatorBefore",
                                    "Unary operator must not be separated from its operand.",
                                    tokens[prev].end,
                                    token.start,
                                );
                            }
                        }
                    }
                    "!" | "~" => {
                        check_prefix_nonword(scan, index, diagnostics, RULE);
                    }
                    "+" | "-" if !prev_ends => {
                        check_prefix_nonword(scan, index, diagnostics, RULE);
                    }
                    "++" | "--" => {
                        if prev_ends {
                            // Postfix: `x ++` → no space before.
                            if let Some(prev) = scan.prev_significant(index) {
                                if is_whitespace(scan.gap(&tokens[prev], token)) {
                                    report_unexpected_space(
                                        diagnostics,
                                        RULE,
                                        "nonwordOperatorBefore",
                                        "Unary operator must not be separated from its operand.",
                                        tokens[prev].end,
                                        token.start,
                                    );
                                }
                            }
                        } else {
                            check_prefix_nonword(scan, index, diagnostics, RULE);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

fn check_prefix_nonword(
    scan: &Scan,
    op_index: usize,
    diagnostics: &mut Vec<LintDiagnostic>,
    rule: &'static str,
) {
    let tokens = scan.tokens();
    if let Some(next) = tokens.get(op_index + 1) {
        let gap = scan.gap(&tokens[op_index], next);
        if is_whitespace(gap) && !has_newline(gap) {
            report_unexpected_space(
                diagnostics,
                rule,
                "nonwordOperatorAfter",
                "Unary operator must not be separated from its operand.",
                tokens[op_index].end,
                next.start,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// wrap-regex
// ---------------------------------------------------------------------------

pub(crate) fn check_wrap_regex(
    scan: &Scan,
    _options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "wrap-regex";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if tokens[index].kind != TokenKind::Regex {
            continue;
        }
        // A regex used as the object of a member access (`/re/.test()`) must be
        // wrapped in parens to avoid confusion with division.
        let is_member = scan
            .next_significant(index)
            .map(|n| punct_is(&tokens[n], scan.source(), "."))
            .unwrap_or(false);
        if is_member {
            report_replace(
                diagnostics,
                RULE,
                "requireParens",
                "Wrap the regexp literal in parentheses.",
                tokens[index].start,
                tokens[index].end,
                "wrapRegex",
                "Wrap in parentheses.",
                scan.token_text(index),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// implicit-arrow-linebreak
// ---------------------------------------------------------------------------

pub(crate) fn check_implicit_arrow_linebreak(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "implicit-arrow-linebreak";
    let below = option_keyword(options, "beside") == "below";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if !punct_is(&tokens[index], scan.source(), "=>") {
            continue;
        }
        let Some(next) = scan.next_significant(index) else {
            continue;
        };
        // Only implicit-return bodies (not block `{ … }` bodies) are in scope.
        if punct_is(&tokens[next], scan.source(), "{") {
            continue;
        }
        let has_break = has_newline(scan.gap(&tokens[index], &tokens[next]));
        if !below && has_break {
            report_replace(
                diagnostics,
                RULE,
                "unexpectedLinebreak",
                "Expected no linebreak before arrow body.",
                tokens[index].end,
                tokens[next].start,
                "joinLine",
                "Remove the linebreak.",
                " ",
            );
        } else if below && !has_break {
            report_missing_space(
                diagnostics,
                RULE,
                "missingLinebreak",
                "Expected a linebreak before arrow body.",
                tokens[index].end,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// operator-linebreak
// ---------------------------------------------------------------------------

pub(crate) fn check_operator_linebreak(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "operator-linebreak";
    // Default places binary operators at the end of the line ("after").
    let before = option_keyword(options, "after") == "before";
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        let token = &tokens[index];
        if token.kind != TokenKind::Punctuator || !is_infix_operator(scan.token_text(index)) {
            continue;
        }
        let (Some(prev), Some(next)) = (scan.prev_significant(index), scan.next_significant(index))
        else {
            continue;
        };
        if !scan.token_ends_expression(prev) {
            continue; // unary / non-infix use
        }
        let newline_before = has_newline(scan.gap(&tokens[prev], token));
        let newline_after = has_newline(scan.gap(token, &tokens[next]));
        if newline_before && newline_after {
            // A linebreak on both sides is always wrong, in either style.
            report_replace(
                diagnostics,
                RULE,
                "badLinebreak",
                "Bad line breaking before and after operator.",
                token.start,
                token.end,
                "moveOperator",
                "Move the operator.",
                scan.token_text(index),
            );
        } else if newline_before && !before {
            report_replace(
                diagnostics,
                RULE,
                "operatorAtBeginning",
                "Operator should be placed at the end of the line.",
                token.start,
                token.end,
                "moveOperator",
                "Move the operator.",
                scan.token_text(index),
            );
        } else if newline_after && before {
            report_replace(
                diagnostics,
                RULE,
                "operatorAtEnd",
                "Operator should be placed at the beginning of the line.",
                token.start,
                token.end,
                "moveOperator",
                "Move the operator.",
                scan.token_text(index),
            );
        }
    }
}

// ---------------------------------------------------------------------------
// keyword-spacing
// ---------------------------------------------------------------------------

/// Strictly-reserved keywords that can never be identifiers, so spacing around
/// them is unambiguous. Contextual words (`as`, `from`, `of`, `type`, `get`,
/// `async`, …) are intentionally excluded to avoid false positives when used as
/// identifiers.
const SPACED_KEYWORDS: &[&str] = &[
    "if",
    "else",
    "for",
    "while",
    "do",
    "switch",
    "case",
    "default",
    "break",
    "continue",
    "return",
    "throw",
    "try",
    "catch",
    "finally",
    "class",
    "extends",
    "new",
    "delete",
    "typeof",
    "instanceof",
    "in",
    "void",
    "import",
    "export",
    "with",
    "debugger",
];

pub(crate) fn check_keyword_spacing(
    scan: &Scan,
    options: &Value,
    diagnostics: &mut Vec<LintDiagnostic>,
) {
    const RULE: &str = "keyword-spacing";
    let before = option_object_bool(options, "before", true);
    let after = option_object_bool(options, "after", true);
    let tokens = scan.tokens();
    for index in 0..tokens.len() {
        if tokens[index].kind != TokenKind::Identifier
            || !SPACED_KEYWORDS.contains(&scan.token_text(index))
        {
            continue;
        }
        // before
        if let Some(prev) = scan.prev_significant(index) {
            let gap = scan.gap(&tokens[prev], &tokens[index]);
            // No space is expected directly after an opening delimiter.
            let prev_opens = matches!(
                scan.token_text(prev),
                "(" | "[" | "{" | "." | "!" | "*" | ";"
            ) && tokens[prev].kind == TokenKind::Punctuator;
            if !has_newline(gap) && !prev_opens {
                if before && gap.is_empty() {
                    report_missing_space(
                        diagnostics,
                        RULE,
                        "missingBefore",
                        "Expected space before keyword.",
                        tokens[index].start,
                    );
                } else if !before && is_whitespace(gap) {
                    report_unexpected_space(
                        diagnostics,
                        RULE,
                        "unexpectedBefore",
                        "Unexpected space before keyword.",
                        tokens[prev].end,
                        tokens[index].start,
                    );
                }
            }
        }
        // after
        if let Some(next) = scan.next_significant(index) {
            let gap = scan.gap(&tokens[index], &tokens[next]);
            // No space is expected directly before a closing delimiter or a
            // statement terminator.
            let next_closes = matches!(
                scan.token_text(next),
                ")" | "]" | "}" | ";" | "," | "." | ":"
            ) && tokens[next].kind == TokenKind::Punctuator;
            if !has_newline(gap) && !next_closes {
                if after && gap.is_empty() {
                    report_missing_space(
                        diagnostics,
                        RULE,
                        "missingAfter",
                        "Expected space after keyword.",
                        tokens[index].end,
                    );
                } else if !after && is_whitespace(gap) {
                    report_unexpected_space(
                        diagnostics,
                        RULE,
                        "unexpectedAfter",
                        "Unexpected space after keyword.",
                        tokens[index].end,
                        tokens[next].start,
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        check: fn(&Scan, &Value, &mut Vec<LintDiagnostic>),
        source: &str,
        options: Value,
    ) -> Vec<LintDiagnostic> {
        let scan = Scan::new(source);
        let mut diagnostics = Vec::new();
        check(&scan, &options, &mut diagnostics);
        diagnostics
    }

    fn always(value: &str) -> Value {
        Value::Array(vec![Value::String(value.into())])
    }

    #[test]
    fn object_curly_spacing_never_default() {
        assert_eq!(
            run(check_object_curly_spacing, "const o = {a: 1};", Value::Null).len(),
            0
        );
        assert_eq!(
            run(
                check_object_curly_spacing,
                "const o = { a: 1 };",
                Value::Null
            )
            .len(),
            2
        );
        // Block braces are not objects.
        assert_eq!(
            run(
                check_object_curly_spacing,
                "function f() { g(); }",
                Value::Null
            )
            .len(),
            0
        );
        // Empty object exempt.
        assert_eq!(
            run(check_object_curly_spacing, "const o = {};", Value::Null).len(),
            0
        );
        // import/export groups are object-like.
        assert_eq!(
            run(
                check_object_curly_spacing,
                "import { a } from 'm';",
                Value::Null
            )
            .len(),
            2
        );
        assert_eq!(
            run(check_object_curly_spacing, "const { a } = o;", Value::Null).len(),
            2
        );
    }

    #[test]
    fn object_curly_spacing_always() {
        assert_eq!(
            run(
                check_object_curly_spacing,
                "const o = {a: 1};",
                always("always")
            )
            .len(),
            2
        );
        assert_eq!(
            run(
                check_object_curly_spacing,
                "const o = { a: 1 };",
                always("always")
            )
            .len(),
            0
        );
    }

    #[test]
    fn array_bracket_spacing_never_default() {
        assert_eq!(
            run(
                check_array_bracket_spacing,
                "const a = [1, 2];",
                Value::Null
            )
            .len(),
            0
        );
        assert_eq!(
            run(
                check_array_bracket_spacing,
                "const a = [ 1, 2 ];",
                Value::Null
            )
            .len(),
            2
        );
        // Member access is not an array literal.
        assert_eq!(
            run(check_array_bracket_spacing, "a[ 0 ];", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_array_bracket_spacing, "const a = [];", Value::Null).len(),
            0
        );
    }

    #[test]
    fn computed_property_spacing_never_default() {
        assert_eq!(
            run(check_computed_property_spacing, "a[0];", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_computed_property_spacing, "a[ 0 ];", Value::Null).len(),
            2
        );
        // Array literal is not a computed member.
        assert_eq!(
            run(
                check_computed_property_spacing,
                "const a = [ 1 ];",
                Value::Null
            )
            .len(),
            0
        );
    }

    #[test]
    fn block_spacing_always_default() {
        assert_eq!(
            run(check_block_spacing, "function f() { g(); }", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_block_spacing, "function f() {g();}", Value::Null).len(),
            2
        );
        // Multiline blocks are out of scope.
        assert_eq!(
            run(
                check_block_spacing,
                "function f() {\n  g();\n}",
                Value::Null
            )
            .len(),
            0
        );
        // Empty block exempt.
        assert_eq!(
            run(check_block_spacing, "function f() {}", Value::Null).len(),
            0
        );
    }

    #[test]
    fn space_before_blocks_always_default() {
        assert_eq!(
            run(check_space_before_blocks, "if (x) { y(); }", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_space_before_blocks, "if (x){ y(); }", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_space_before_blocks, "function f() {}", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_space_before_blocks, "function f(){}", Value::Null).len(),
            1
        );
    }

    #[test]
    fn function_call_spacing_never_default() {
        assert_eq!(
            run(check_function_call_spacing, "foo();", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_function_call_spacing, "foo ();", Value::Null).len(),
            1
        );
        // Control headers and definitions are not calls.
        assert_eq!(
            run(check_function_call_spacing, "if (x) {}", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_function_call_spacing, "function f () {}", Value::Null).len(),
            0
        );
    }

    #[test]
    fn space_before_function_paren_always_default() {
        assert_eq!(
            run(
                check_space_before_function_paren,
                "function f () {}",
                Value::Null
            )
            .len(),
            0
        );
        assert_eq!(
            run(
                check_space_before_function_paren,
                "function f() {}",
                Value::Null
            )
            .len(),
            1
        );
        // Calls are unaffected.
        assert_eq!(
            run(check_space_before_function_paren, "foo();", Value::Null).len(),
            0
        );
    }

    #[test]
    fn no_floating_decimal_flags_leading_and_trailing() {
        assert_eq!(
            run(check_no_floating_decimal, "const x = .5;", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_no_floating_decimal, "const x = 5.;", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_no_floating_decimal, "const x = 0.5;", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_no_floating_decimal, "const x = 5;", Value::Null).len(),
            0
        );
    }

    #[test]
    fn template_tag_spacing_never_default() {
        assert_eq!(
            run(check_template_tag_spacing, "tag`hello`;", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_template_tag_spacing, "tag `hello`;", Value::Null).len(),
            1
        );
        // An untagged template is not in scope.
        assert_eq!(
            run(
                check_template_tag_spacing,
                "const x = `hello`;",
                Value::Null
            )
            .len(),
            0
        );
    }

    #[test]
    fn yield_star_spacing_default() {
        assert_eq!(
            run(
                check_yield_star_spacing,
                "function* g() { yield* h(); }",
                Value::Null
            )
            .len(),
            0
        );
        assert_eq!(
            run(
                check_yield_star_spacing,
                "function* g() { yield *h(); }",
                Value::Null
            )
            .len(),
            2
        );
    }

    #[test]
    fn generator_star_spacing_default() {
        // default before:true, after:false → `function *g` is correct.
        assert_eq!(
            run(
                check_generator_star_spacing,
                "function *g() {}",
                Value::Null
            )
            .len(),
            0
        );
        assert_eq!(
            run(
                check_generator_star_spacing,
                "function* g() {}",
                Value::Null
            )
            .len(),
            2
        );
    }

    #[test]
    fn comma_dangle_never_default() {
        assert_eq!(
            run(check_comma_dangle, "const a = [1, 2];", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_comma_dangle, "const a = [1, 2,];", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_comma_dangle, "const o = {a: 1,};", Value::Null).len(),
            1
        );
        assert_eq!(run(check_comma_dangle, "foo(a, b,);", Value::Null).len(), 1);
        // Control parens never dangle.
        assert_eq!(run(check_comma_dangle, "for (;;) {}", Value::Null).len(), 0);
    }

    #[test]
    fn comma_dangle_always_multiline() {
        let opt = Value::Array(vec![Value::String("always-multiline".into())]);
        assert_eq!(
            run(
                check_comma_dangle,
                "const a = [\n  1,\n  2\n];",
                opt.clone()
            )
            .len(),
            1
        );
        assert_eq!(run(check_comma_dangle, "const a = [1, 2];", opt).len(), 0);
    }

    #[test]
    fn space_infix_ops_requires_spacing() {
        // One report per under-spaced operator, regardless of which side.
        assert_eq!(
            run(check_space_infix_ops, "const x = a+b;", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_space_infix_ops, "const x = a + b;", Value::Null).len(),
            0
        );
        // Unary minus is not infix.
        assert_eq!(
            run(check_space_infix_ops, "const x = -a;", Value::Null).len(),
            0
        );
        // Assignment operator counts.
        assert_eq!(run(check_space_infix_ops, "x=1;", Value::Null).len(), 1);
    }

    #[test]
    fn semi_style_last_default() {
        assert_eq!(
            run(check_semi_style, "let x = 1;\nlet y = 2;", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_semi_style, "foo()\n;[1].forEach(bar)", Value::Null).len(),
            1
        );
        // For-header semicolons are exempt.
        assert_eq!(
            run(
                check_semi_style,
                "for (let i = 0; i < 1; i++) {}",
                Value::Null
            )
            .len(),
            0
        );
    }

    #[test]
    fn comma_style_last_default() {
        assert_eq!(
            run(check_comma_style, "const a = [1, 2, 3];", Value::Null).len(),
            0
        );
        assert_eq!(
            run(
                check_comma_style,
                "const a = [\n  1\n  , 2\n];",
                Value::Null
            )
            .len(),
            1
        );
    }

    #[test]
    fn arrow_parens_always_default() {
        assert_eq!(
            run(check_arrow_parens, "const f = (a) => a;", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_arrow_parens, "const f = a => a;", Value::Null).len(),
            1
        );
        // Zero-parameter and multi-parameter arrows are out of scope.
        assert_eq!(
            run(check_arrow_parens, "const f = () => 1;", Value::Null).len(),
            0
        );
    }

    #[test]
    fn switch_colon_spacing_default() {
        assert_eq!(
            run(
                check_switch_colon_spacing,
                "switch (x) { case 0: foo(); }",
                Value::Null
            )
            .len(),
            0
        );
        assert_eq!(
            run(
                check_switch_colon_spacing,
                "switch (x) { case 0 :foo(); }",
                Value::Null
            )
            .len(),
            2
        );
        assert_eq!(
            run(
                check_switch_colon_spacing,
                "switch (x) { case 0:foo(); }",
                Value::Null
            )
            .len(),
            1
        );
        // A ternary colon inside the label is not the case colon.
        assert_eq!(
            run(
                check_switch_colon_spacing,
                "switch (x) { case a ? b : c: foo(); }",
                Value::Null
            )
            .len(),
            0
        );
    }

    #[test]
    fn no_extra_semi_flags_empty_statements() {
        assert_eq!(run(check_no_extra_semi, "var x = 5;", Value::Null).len(), 0);
        assert_eq!(
            run(check_no_extra_semi, "var x = 5;;", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_no_extra_semi, "function foo() {};", Value::Null).len(),
            1
        );
        // An object literal's `}` still needs its statement semicolon.
        assert_eq!(
            run(check_no_extra_semi, "var o = {};", Value::Null).len(),
            0
        );
        // For-header semicolons are never extra.
        assert_eq!(
            run(check_no_extra_semi, "for (;;) {}", Value::Null).len(),
            0
        );
    }

    #[test]
    fn new_parens_always_default() {
        assert_eq!(
            run(check_new_parens, "var x = new Person();", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_new_parens, "var x = new Person;", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_new_parens, "var x = new ns.Person;", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_new_parens, "var x = new Person(a, b);", Value::Null).len(),
            0
        );
    }

    #[test]
    fn space_unary_ops_default() {
        assert_eq!(
            run(check_space_unary_ops, "typeof foo", Value::Null).len(),
            0
        );
        assert_eq!(run(check_space_unary_ops, "++foo", Value::Null).len(), 0);
        assert_eq!(run(check_space_unary_ops, "++ foo", Value::Null).len(), 1);
        assert_eq!(run(check_space_unary_ops, "! foo", Value::Null).len(), 1);
        // Postfix TS non-null assertion must hug its operand.
        assert_eq!(
            run(check_space_unary_ops, "const x = value !;", Value::Null).len(),
            1
        );
    }

    #[test]
    fn wrap_regex_flags_member_object() {
        assert_eq!(
            run(check_wrap_regex, "/foo/.test(bar);", Value::Null).len(),
            1
        );
        assert_eq!(
            run(check_wrap_regex, "(/foo/).test(bar);", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_wrap_regex, "const r = /foo/;", Value::Null).len(),
            0
        );
        assert_eq!(run(check_wrap_regex, "/foo/;", Value::Null).len(), 0);
    }

    #[test]
    fn implicit_arrow_linebreak_beside_default() {
        assert_eq!(
            run(
                check_implicit_arrow_linebreak,
                "const f = (a) => a;",
                Value::Null
            )
            .len(),
            0
        );
        assert_eq!(
            run(
                check_implicit_arrow_linebreak,
                "const f = (a) =>\n  a;",
                Value::Null
            )
            .len(),
            1
        );
        // Block bodies are out of scope.
        assert_eq!(
            run(
                check_implicit_arrow_linebreak,
                "const f = (a) =>\n  { return a; };",
                Value::Null
            )
            .len(),
            0
        );
        let below = Value::Array(vec![Value::String("below".into())]);
        assert_eq!(
            run(check_implicit_arrow_linebreak, "const f = (a) => a;", below).len(),
            1
        );
    }

    #[test]
    fn operator_linebreak_after_default() {
        assert_eq!(
            run(check_operator_linebreak, "const x = 1 + 2;", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_operator_linebreak, "const x = 1 +\n  2;", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_operator_linebreak, "const x = 1\n  + 2;", Value::Null).len(),
            1
        );
        // A break on both sides is always wrong.
        assert_eq!(
            run(
                check_operator_linebreak,
                "const x = 1\n  +\n  2;",
                Value::Null
            )
            .len(),
            1
        );
        let before = Value::Array(vec![Value::String("before".into())]);
        assert_eq!(
            run(check_operator_linebreak, "const x = 1 +\n  2;", before).len(),
            1
        );
    }

    #[test]
    fn keyword_spacing_default() {
        assert_eq!(
            run(check_keyword_spacing, "if (foo) {}", Value::Null).len(),
            0
        );
        assert_eq!(
            run(check_keyword_spacing, "if(foo) {}", Value::Null).len(),
            1
        );
        assert_eq!(run(check_keyword_spacing, "}else {", Value::Null).len(), 1);
        assert_eq!(
            run(check_keyword_spacing, "return x;", Value::Null).len(),
            0
        );
        assert_eq!(run(check_keyword_spacing, "return;", Value::Null).len(), 0);
        assert_eq!(
            run(check_keyword_spacing, "for (const x of y) {}", Value::Null).len(),
            0
        );
    }
}
