//! Shared analysis over the lexed token stream.
//!
//! Most token-level stylistic rules need a little structural context that a flat
//! token list does not carry: which `{` opens an object literal versus a block,
//! which `(` is a call versus a control header, which `[` is a computed member
//! access versus an array literal, and whether a given `/`, `+`, `*`, … sits in
//! a prefix (operand-expected) or infix (operator-expected) position.
//!
//! [`Scan`] computes this once per source — a single tokenization plus a single
//! bracket-matching pass — and every enabled rule shares it. The classification
//! is heuristic (it is not a parser) but covers the overwhelming majority of
//! real TypeScript/JavaScript; the cases it cannot disambiguate without a true
//! AST are documented on each classifier.

use serde_json::Value;

use crate::lint::stylistic::lexer::{tokenize, Token, TokenKind};
use crate::lint::{LintDiagnostic, LintFix, LintSuggestion, TextRange};

/// How an opening `{` is being used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BraceKind {
    /// A statement block, class/interface/enum/namespace body, or `case` body.
    Block,
    /// An object literal/pattern, or an `import`/`export` named-binding group —
    /// anything that `object-curly-spacing` treats the same way.
    ObjectLike,
}

/// How an opening `[` is being used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BracketKind {
    /// An array literal or array binding pattern.
    Array,
    /// A computed member access or index signature: `a[b]`.
    Member,
}

/// How an opening `(` is being used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ParenUse {
    /// `if (`, `for (`, `while (`, `switch (`, `catch (`, `with (`.
    Control,
    /// A function/method definition's parameter list.
    FuncDef,
    /// A call or `new` argument list.
    Call,
    /// A parenthesised expression or arrow parameter list.
    Grouping,
}

/// Keywords whose `(` introduces a control-flow header.
const CONTROL_KEYWORDS: &[&str] = &["if", "for", "while", "switch", "catch", "with"];

/// Punctuators after which a following `{`/`[`/`(`/`/` sits in expression
/// (operand) position rather than statement position.
fn punct_precedes_expression(text: &str) -> bool {
    matches!(
        text,
        "=" | "(" | "[" | "," | ":" | "?" | ";" // `;`/`{`/`}` start a statement but also
            | "+" | "-" | "*" | "/" | "%" | "**"
            | "==" | "===" | "!=" | "!==" | "<" | ">" | "<=" | ">="
            | "&&" | "||" | "??" | "&" | "|" | "^" | "<<" | ">>" | ">>>"
            | "+=" | "-=" | "*=" | "/=" | "%=" | "**="
            | "&&=" | "||=" | "??=" | "&=" | "|=" | "^=" | "<<=" | ">>=" | ">>>="
            | "!" | "~" | "..." | "=>"
    )
}

/// Whether a significant token *ends* an expression (so the next `/` is
/// division, the next `(` is a call, the next `[` is a member access).
fn ends_expression(token: &Token, text: &str) -> bool {
    match token.kind {
        TokenKind::Number
        | TokenKind::String
        | TokenKind::Regex
        | TokenKind::NoSubTemplate
        | TokenKind::TemplateTail => true,
        TokenKind::Identifier => matches!(
            text,
            "this" | "super" | "true" | "false" | "null" | "undefined"
        ) || !is_reserved_operator_word(text),
        TokenKind::Punctuator => matches!(text, ")" | "]" | "}"),
        _ => false,
    }
}

/// Whether an identifier is a reserved word used in operator/statement position
/// (so it does *not* end an expression). Value keywords (`this`, `true`, …) are
/// handled by the caller.
fn is_reserved_operator_word(text: &str) -> bool {
    matches!(
        text,
        "return"
            | "typeof"
            | "instanceof"
            | "in"
            | "of"
            | "new"
            | "delete"
            | "void"
            | "yield"
            | "await"
            | "case"
            | "throw"
            | "default"
            | "do"
            | "else"
            | "if"
            | "for"
            | "while"
            | "switch"
            | "catch"
            | "with"
            | "function"
            | "class"
            | "extends"
            | "const"
            | "let"
            | "var"
            | "export"
            | "import"
            | "as"
            | "from"
            | "satisfies"
    )
}

/// Shared per-source analysis: tokens plus bracket matching.
pub(crate) struct Scan<'a> {
    source: &'a str,
    tokens: Vec<Token>,
    /// For every token index, the index of its matching bracket token, or
    /// `usize::MAX` when the token is not a matched bracket.
    partner: Vec<usize>,
}

const NO_PARTNER: usize = usize::MAX;

impl<'a> Scan<'a> {
    pub(crate) fn new(source: &'a str) -> Self {
        let tokens = tokenize(source);
        let partner = match_brackets(source, &tokens);
        Scan {
            source,
            tokens,
            partner,
        }
    }

    pub(crate) fn source(&self) -> &'a str {
        self.source
    }

    pub(crate) fn tokens(&self) -> &[Token] {
        &self.tokens
    }

    /// Source text in the gap between two adjacent tokens.
    pub(crate) fn gap(&self, a: &Token, b: &Token) -> &'a str {
        &self.source[a.end..b.start]
    }

    pub(crate) fn slice(&self, start: usize, end: usize) -> &'a str {
        &self.source[start..end]
    }

    pub(crate) fn token_text(&self, index: usize) -> &'a str {
        let token = &self.tokens[index];
        &self.source[token.start..token.end]
    }

    /// The index of the closest preceding non-comment token.
    pub(crate) fn prev_significant(&self, index: usize) -> Option<usize> {
        (0..index)
            .rev()
            .find(|&i| !self.tokens[i].kind.is_comment())
    }

    /// The index of the closest following non-comment token.
    pub(crate) fn next_significant(&self, index: usize) -> Option<usize> {
        (index + 1..self.tokens.len()).find(|&i| !self.tokens[i].kind.is_comment())
    }

    /// The matching bracket token index for an open/close bracket token.
    pub(crate) fn partner(&self, index: usize) -> Option<usize> {
        self.partner.get(index).copied().filter(|&p| p != NO_PARTNER)
    }

    /// Classifies an opening `{` token.
    pub(crate) fn brace_kind(&self, open_index: usize) -> BraceKind {
        let Some(prev) = self.prev_significant(open_index) else {
            return BraceKind::Block;
        };
        let prev_token = &self.tokens[prev];
        let text = self.token_text(prev);
        match prev_token.kind {
            TokenKind::Punctuator => {
                // `=>`, `;` open blocks even though they precede expressions.
                if matches!(text, "=>" | ";") {
                    BraceKind::Block
                } else if punct_precedes_expression(text) {
                    BraceKind::ObjectLike
                } else {
                    // `)` `]` `}` `{` → block/statement position.
                    BraceKind::Block
                }
            }
            TokenKind::Identifier => {
                // `do {`, `else {`, `try {`, `finally {` are blocks; a plain
                // identifier before a brace is a class/interface/enum/namespace/
                // label body. The keywords below instead introduce an object
                // literal, a destructuring pattern, or an import/export group.
                if matches!(
                    text,
                    "return"
                        | "throw"
                        | "yield"
                        | "await"
                        | "typeof"
                        | "void"
                        | "delete"
                        | "in"
                        | "of"
                        | "new"
                        | "instanceof"
                        | "default"
                        | "const"
                        | "let"
                        | "var"
                        | "import"
                        | "export"
                ) {
                    BraceKind::ObjectLike
                } else {
                    BraceKind::Block
                }
            }
            _ => BraceKind::ObjectLike,
        }
    }

    /// Whether the token at `index` ends an expression. Unlike the free
    /// [`ends_expression`], this resolves a `}` against its matching `{`: a
    /// block's `}` ends a *statement*, an object literal's `}` ends an
    /// expression.
    pub(crate) fn token_ends_expression(&self, index: usize) -> bool {
        let token = &self.tokens[index];
        let text = self.token_text(index);
        if token.kind == TokenKind::Punctuator && text == "}" {
            return match self.partner(index) {
                Some(open) => self.brace_kind(open) == BraceKind::ObjectLike,
                None => false,
            };
        }
        ends_expression(token, text)
    }

    /// Classifies an opening `[` token.
    pub(crate) fn bracket_kind(&self, open_index: usize) -> BracketKind {
        match self.prev_significant(open_index) {
            None => BracketKind::Array,
            Some(prev) => {
                if self.token_ends_expression(prev) {
                    BracketKind::Member
                } else {
                    BracketKind::Array
                }
            }
        }
    }

    /// The [`ParenUse`] of the open paren matching a closing `)` token.
    pub(crate) fn paren_use_close(&self, close_index: usize) -> Option<ParenUse> {
        self.partner(close_index).map(|open| self.paren_use(open))
    }

    /// Classifies an opening `(` token.
    pub(crate) fn paren_use(&self, open_index: usize) -> ParenUse {
        let Some(prev) = self.prev_significant(open_index) else {
            return ParenUse::Grouping;
        };
        let prev_token = &self.tokens[prev];
        let text = self.token_text(prev);
        if prev_token.kind == TokenKind::Identifier && CONTROL_KEYWORDS.contains(&text) {
            return ParenUse::Control;
        }
        if prev_token.kind == TokenKind::Identifier && text == "function" {
            return ParenUse::FuncDef;
        }
        // `function name (` and `function* name (`.
        if prev_token.kind == TokenKind::Identifier {
            if let Some(prev2) = self.prev_significant(prev) {
                let t2 = self.token_text(prev2);
                if self.tokens[prev2].kind == TokenKind::Identifier && t2 == "function" {
                    return ParenUse::FuncDef;
                }
                if self.tokens[prev2].kind == TokenKind::Punctuator
                    && t2 == "*"
                    && self
                        .prev_significant(prev2)
                        .map(|p3| self.token_text(p3) == "function")
                        .unwrap_or(false)
                {
                    return ParenUse::FuncDef;
                }
            }
        }
        if self.token_ends_expression(prev) {
            ParenUse::Call
        } else {
            ParenUse::Grouping
        }
    }
}

/// Builds the bracket partner map. Only plain `(`/`)`/`[`/`]`/`{`/`}`
/// punctuator tokens participate; template delimiters carry their own braces.
fn match_brackets(source: &str, tokens: &[Token]) -> Vec<usize> {
    let mut partner = vec![NO_PARTNER; tokens.len()];
    let mut stack: Vec<usize> = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        if token.kind != TokenKind::Punctuator {
            continue;
        }
        match &source[token.start..token.end] {
            "(" | "[" | "{" => stack.push(index),
            close @ (")" | "]" | "}") => {
                if let Some(open_index) = stack.pop() {
                    let open = &source[tokens[open_index].start..tokens[open_index].end];
                    if brackets_match(open, close) {
                        partner[open_index] = index;
                        partner[index] = open_index;
                    }
                    // Mismatched closer: leave both unpaired.
                }
            }
            _ => {}
        }
    }
    partner
}

fn brackets_match(open: &str, close: &str) -> bool {
    matches!(
        (open, close),
        ("(", ")") | ("[", "]") | ("{", "}")
    )
}

// ---------------------------------------------------------------------------
// Shared whitespace / token helpers reused across rule modules.
// ---------------------------------------------------------------------------

pub(crate) fn has_newline(text: &str) -> bool {
    text.bytes().any(|b| b == b'\n' || b == b'\r')
}

pub(crate) fn is_whitespace(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(is_space_byte)
}

pub(crate) fn is_space_byte(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | 0x0b | 0x0c | b'\n' | b'\r')
}

pub(crate) fn punct_is(token: &Token, source: &str, text: &str) -> bool {
    token.kind == TokenKind::Punctuator && &source[token.start..token.end] == text
}

// ---------------------------------------------------------------------------
// Option helpers
// ---------------------------------------------------------------------------

/// The first element of an `[options...]` array, or the value itself.
pub(crate) fn first_option(options: &Value) -> Option<&Value> {
    match options {
        Value::Array(items) => items.first(),
        Value::Null => None,
        other => Some(other),
    }
}

/// Reads `options[0][key]` as a boolean, defaulting when absent.
pub(crate) fn option_object_bool(options: &Value, key: &str, default: bool) -> bool {
    first_option(options)
        .and_then(|value| value.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(default)
}

/// Reads a leading string option such as `"always"` / `"never"`.
pub(crate) fn option_keyword<'v>(options: &'v Value, default: &'v str) -> &'v str {
    first_option(options)
        .and_then(Value::as_str)
        .unwrap_or(default)
}

// ---------------------------------------------------------------------------
// Diagnostic helpers
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub(crate) fn push(
    diagnostics: &mut Vec<LintDiagnostic>,
    rule: &'static str,
    message_id: &'static str,
    message: &'static str,
    start: usize,
    end: usize,
    suggestion_id: &'static str,
    suggestion_message: &'static str,
    fix: LintFix,
) {
    let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end)) else {
        return;
    };
    diagnostics.push(LintDiagnostic {
        rule_name: rule.to_owned(),
        message_id: message_id.to_owned(),
        message: message.to_owned(),
        range: TextRange::new(start, end),
        suggestions: vec![LintSuggestion {
            message_id: suggestion_id.to_owned(),
            message: suggestion_message.to_owned(),
            fixes: vec![fix],
        }],
    });
}

/// Reports a missing space at `at`, fixed by inserting a single space.
pub(crate) fn report_missing_space(
    diagnostics: &mut Vec<LintDiagnostic>,
    rule: &'static str,
    message_id: &'static str,
    message: &'static str,
    at: usize,
) {
    push(
        diagnostics,
        rule,
        message_id,
        message,
        at,
        at,
        "insertSpace",
        "Insert a space.",
        LintFix::replace_range(TextRange::new(at as u32, at as u32), " "),
    );
}

/// Reports an unexpected whitespace span `[start, end)`, fixed by removing it.
pub(crate) fn report_unexpected_space(
    diagnostics: &mut Vec<LintDiagnostic>,
    rule: &'static str,
    message_id: &'static str,
    message: &'static str,
    start: usize,
    end: usize,
) {
    push(
        diagnostics,
        rule,
        message_id,
        message,
        start,
        end,
        "removeSpace",
        "Remove the whitespace.",
        LintFix::remove_range(TextRange::new(start as u32, end as u32)),
    );
}

/// Reports the span `[start, end)` and replaces it with `replacement`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn report_replace(
    diagnostics: &mut Vec<LintDiagnostic>,
    rule: &'static str,
    message_id: &'static str,
    message: &'static str,
    start: usize,
    end: usize,
    suggestion_id: &'static str,
    suggestion_message: &'static str,
    replacement: &str,
) {
    push(
        diagnostics,
        rule,
        message_id,
        message,
        start,
        end,
        suggestion_id,
        suggestion_message,
        LintFix::replace_range(TextRange::new(start as u32, end as u32), replacement),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_brace_kinds(source: &str) -> Vec<BraceKind> {
        let scan = Scan::new(source);
        scan.tokens()
            .iter()
            .enumerate()
            .filter(|(_, t)| punct_is(t, source, "{"))
            .map(|(i, _)| scan.brace_kind(i))
            .collect()
    }

    #[test]
    fn classifies_object_vs_block_braces() {
        assert_eq!(open_brace_kinds("const o = { a: 1 };"), vec![BraceKind::ObjectLike]);
        assert_eq!(open_brace_kinds("function f() { return 1; }"), vec![BraceKind::Block]);
        assert_eq!(open_brace_kinds("if (x) { y(); }"), vec![BraceKind::Block]);
        assert_eq!(open_brace_kinds("const f = () => { g(); };"), vec![BraceKind::Block]);
        assert_eq!(open_brace_kinds("class C { m() {} }"), vec![BraceKind::Block, BraceKind::Block]);
        assert_eq!(open_brace_kinds("f({ a: 1 });"), vec![BraceKind::ObjectLike]);
        assert_eq!(open_brace_kinds("return { a: 1 };"), vec![BraceKind::ObjectLike]);
    }

    #[test]
    fn classifies_array_vs_member_brackets() {
        let scan = Scan::new("const a = [1, 2]; a[0];");
        let kinds: Vec<_> = scan
            .tokens()
            .iter()
            .enumerate()
            .filter(|(_, t)| punct_is(t, scan.source(), "["))
            .map(|(i, _)| scan.bracket_kind(i))
            .collect();
        assert_eq!(kinds, vec![BracketKind::Array, BracketKind::Member]);
    }

    #[test]
    fn classifies_paren_uses() {
        let scan = Scan::new("if (x) foo(y); function g(z) {} (a + b);");
        let uses: Vec<_> = scan
            .tokens()
            .iter()
            .enumerate()
            .filter(|(_, t)| punct_is(t, scan.source(), "("))
            .map(|(i, _)| scan.paren_use(i))
            .collect();
        assert_eq!(
            uses,
            vec![ParenUse::Control, ParenUse::Call, ParenUse::FuncDef, ParenUse::Grouping]
        );
    }

    #[test]
    fn matches_brackets() {
        let scan = Scan::new("a({ b: [1] })");
        // token 0 `a`, 1 `(`, 2 `{`, ... find `(` partner is the final `)`.
        let open_paren = scan
            .tokens()
            .iter()
            .position(|t| punct_is(t, scan.source(), "("))
            .unwrap();
        let partner = scan.partner(open_paren).unwrap();
        assert_eq!(scan.token_text(partner), ")");
    }
}
