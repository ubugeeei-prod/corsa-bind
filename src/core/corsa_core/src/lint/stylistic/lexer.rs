//! A small, allocation-light TypeScript/JavaScript lexer used by the native
//! stylistic rules.
//!
//! The stylistic rule set follows a "single native scan" performance model: the
//! JS bridge hands the full source text to Rust once, and every configured rule
//! shares the work. Most `@stylistic` rules reason about the *token* stream
//! (spacing around commas, operators, braces, keywords, …) rather than a full
//! AST, so this module turns the source into a flat `Vec<Token>` that the rules
//! walk directly.
//!
//! The lexer is intentionally lenient: it never fails, it preserves byte ranges
//! for every token, and it keeps comments inline (marked with their own kind) so
//! spacing rules can decide whether to consider them. It handles the parts of
//! the grammar that matter for token-level reasoning: punctuators (longest
//! match), identifiers/keywords, numeric/string literals, template literals with
//! nested `${}` substitutions, regular-expression literals (via the standard
//! previous-token heuristic), and both comment forms.

/// The lexical category of a token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TokenKind {
    /// An operator or delimiter such as `=>`, `===`, `{`, or `,`.
    Punctuator,
    /// An identifier or a contextual/reserved keyword. Use [`Token::is_keyword`]
    /// against the source text to distinguish reserved words.
    Identifier,
    /// A numeric literal, including hex/binary/octal/bigint forms.
    Number,
    /// A single- or double-quoted string literal.
    String,
    /// A template literal with no substitutions: `` `abc` ``.
    NoSubTemplate,
    /// The opening chunk of a template literal: `` `abc${ ``.
    TemplateHead,
    /// A middle chunk of a template literal: `}abc${`.
    TemplateMiddle,
    /// The closing chunk of a template literal: `` }abc` ``.
    TemplateTail,
    /// A regular-expression literal such as `/ab+c/gi`.
    Regex,
    /// A `//` line comment (excluding the trailing newline).
    LineComment,
    /// A `/* … */` block comment.
    BlockComment,
}

impl TokenKind {
    /// Whether this token is one of the two comment forms.
    pub(crate) fn is_comment(self) -> bool {
        matches!(self, TokenKind::LineComment | TokenKind::BlockComment)
    }
}

/// A single lexed token with its half-open byte range `[start, end)`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Token {
    pub(crate) kind: TokenKind,
    pub(crate) start: usize,
    pub(crate) end: usize,
}

impl Token {
    /// The source slice covered by this token. Consumed by the upcoming
    /// structure-aware rules (keyword-spacing, brace-style, …).
    #[allow(dead_code)]
    pub(crate) fn text<'a>(&self, source: &'a str) -> &'a str {
        &source[self.start..self.end]
    }

    /// Whether this identifier token spells the given reserved/contextual word.
    #[allow(dead_code)]
    pub(crate) fn is_keyword(&self, source: &str, word: &str) -> bool {
        self.kind == TokenKind::Identifier && self.text(source) == word
    }
}

/// The full set of ECMAScript reserved words plus the TypeScript-specific ones
/// that `@stylistic`'s `keyword-spacing` treats as keywords. Contextual words
/// (`of`, `as`, `from`, `async`, `await`, `get`, `set`, …) are matched by text
/// at the rule level because their keyword-ness depends on position.
#[allow(dead_code)]
pub(crate) const RESERVED_WORDS: &[&str] = &[
    "abstract",
    "any",
    "as",
    "asserts",
    "async",
    "await",
    "boolean",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "debugger",
    "declare",
    "default",
    "delete",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "get",
    "if",
    "implements",
    "import",
    "in",
    "infer",
    "instanceof",
    "interface",
    "is",
    "keyof",
    "let",
    "namespace",
    "never",
    "new",
    "null",
    "number",
    "object",
    "of",
    "package",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "satisfies",
    "set",
    "static",
    "string",
    "super",
    "switch",
    "symbol",
    "this",
    "throw",
    "true",
    "try",
    "type",
    "typeof",
    "undefined",
    "unique",
    "unknown",
    "var",
    "void",
    "while",
    "with",
    "yield",
];

/// Tokenizes `source` into a flat list of tokens including comments, in source
/// order. Whitespace and newlines are not emitted; rules recover gaps from the
/// byte ranges and the original source text.
pub(crate) fn tokenize(source: &str) -> Vec<Token> {
    Lexer::new(source).run()
}

struct Lexer<'a> {
    bytes: &'a [u8],
    pos: usize,
    tokens: Vec<Token>,
    /// Brace-nesting stack for template-literal substitutions. Each entry counts
    /// open `{` seen since the enclosing `${`; when it returns to zero on a `}`
    /// we resume template scanning instead of emitting a plain `}` punctuator.
    template_braces: Vec<u32>,
}

impl<'a> Lexer<'a> {
    fn new(source: &'a str) -> Self {
        Lexer {
            bytes: source.as_bytes(),
            pos: 0,
            tokens: Vec::new(),
            template_braces: Vec::new(),
        }
    }

    fn run(mut self) -> Vec<Token> {
        while self.pos < self.bytes.len() {
            let byte = self.bytes[self.pos];
            match byte {
                b' ' | b'\t' | b'\r' | b'\n' | 0x0b | 0x0c => {
                    self.pos += 1;
                }
                b'/' if self.peek(1) == Some(b'/') => self.line_comment(),
                b'/' if self.peek(1) == Some(b'*') => self.block_comment(),
                b'/' if self.regex_allowed() => self.regex_or_punctuator(),
                b'`' => self.template(),
                b'}' if self.in_template_substitution() => self.close_template_substitution(),
                b'"' | b'\'' => self.string(byte),
                b'0'..=b'9' => self.number(),
                b'.' if self.peek(1).is_some_and(|b| b.is_ascii_digit()) => self.number(),
                _ if is_ident_start(byte) => self.identifier(),
                _ => self.punctuator(),
            }
        }
        self.tokens
    }

    fn peek(&self, offset: usize) -> Option<u8> {
        self.bytes.get(self.pos + offset).copied()
    }

    fn push(&mut self, kind: TokenKind, start: usize, end: usize) {
        self.tokens.push(Token { kind, start, end });
    }

    fn line_comment(&mut self) {
        let start = self.pos;
        self.pos += 2;
        while self.pos < self.bytes.len()
            && self.bytes[self.pos] != b'\n'
            && self.bytes[self.pos] != b'\r'
        {
            self.pos += 1;
        }
        self.push(TokenKind::LineComment, start, self.pos);
    }

    fn block_comment(&mut self) {
        let start = self.pos;
        self.pos += 2;
        while self.pos < self.bytes.len() {
            if self.bytes[self.pos] == b'*' && self.peek(1) == Some(b'/') {
                self.pos += 2;
                self.push(TokenKind::BlockComment, start, self.pos);
                return;
            }
            self.pos += 1;
        }
        // Unterminated block comment runs to end of file.
        self.push(TokenKind::BlockComment, start, self.pos);
    }

    fn string(&mut self, quote: u8) {
        let start = self.pos;
        self.pos += 1;
        while self.pos < self.bytes.len() {
            let byte = self.bytes[self.pos];
            if byte == b'\\' {
                self.pos += 2;
                continue;
            }
            if byte == quote || byte == b'\n' || byte == b'\r' {
                if byte == quote {
                    self.pos += 1;
                }
                break;
            }
            self.pos += 1;
        }
        self.push(TokenKind::String, start, self.pos);
    }

    fn number(&mut self) {
        let start = self.pos;
        // Radix prefixes consume to the end of the alphanumeric/underscore run.
        if self.bytes[self.pos] == b'0' {
            if let Some(prefix) = self.peek(1) {
                if matches!(prefix, b'x' | b'X' | b'b' | b'B' | b'o' | b'O') {
                    self.pos += 2;
                    while self
                        .peek(0)
                        .is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_')
                    {
                        self.pos += 1;
                    }
                    self.maybe_bigint_suffix();
                    self.push(TokenKind::Number, start, self.pos);
                    return;
                }
            }
        }
        self.consume_digits();
        if self.peek(0) == Some(b'.') {
            self.pos += 1;
            self.consume_digits();
        }
        if matches!(self.peek(0), Some(b'e' | b'E')) {
            self.pos += 1;
            if matches!(self.peek(0), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            self.consume_digits();
        }
        self.maybe_bigint_suffix();
        self.push(TokenKind::Number, start, self.pos);
    }

    fn consume_digits(&mut self) {
        while self
            .peek(0)
            .is_some_and(|b| b.is_ascii_digit() || b == b'_')
        {
            self.pos += 1;
        }
    }

    fn maybe_bigint_suffix(&mut self) {
        if self.peek(0) == Some(b'n') {
            self.pos += 1;
        }
    }

    fn identifier(&mut self) {
        let start = self.pos;
        self.pos += 1;
        while self.pos < self.bytes.len() && is_ident_continue(self.bytes[self.pos]) {
            self.pos += 1;
        }
        self.push(TokenKind::Identifier, start, self.pos);
    }

    /// Scans a template literal starting at a backtick. Emits either a single
    /// [`TokenKind::NoSubTemplate`] or a [`TokenKind::TemplateHead`] followed by
    /// the substitution tokens (handled by the main loop) and later chunks.
    fn template(&mut self) {
        let start = self.pos;
        self.pos += 1; // skip `
        loop {
            if self.pos >= self.bytes.len() {
                self.push(TokenKind::NoSubTemplate, start, self.pos);
                return;
            }
            let byte = self.bytes[self.pos];
            match byte {
                b'\\' => self.pos += 2,
                b'`' => {
                    self.pos += 1;
                    self.push(TokenKind::NoSubTemplate, start, self.pos);
                    return;
                }
                b'$' if self.peek(1) == Some(b'{') => {
                    self.pos += 2;
                    self.push(TokenKind::TemplateHead, start, self.pos);
                    self.template_braces.push(0);
                    return;
                }
                _ => self.pos += 1,
            }
        }
    }

    /// Resumes template scanning after a `}` that closes a `${…}` substitution,
    /// emitting a [`TokenKind::TemplateMiddle`] or [`TokenKind::TemplateTail`].
    fn close_template_substitution(&mut self) {
        self.template_braces.pop();
        let start = self.pos;
        self.pos += 1; // skip }
        loop {
            if self.pos >= self.bytes.len() {
                self.push(TokenKind::TemplateTail, start, self.pos);
                return;
            }
            let byte = self.bytes[self.pos];
            match byte {
                b'\\' => self.pos += 2,
                b'`' => {
                    self.pos += 1;
                    self.push(TokenKind::TemplateTail, start, self.pos);
                    return;
                }
                b'$' if self.peek(1) == Some(b'{') => {
                    self.pos += 2;
                    self.push(TokenKind::TemplateMiddle, start, self.pos);
                    self.template_braces.push(0);
                    return;
                }
                _ => self.pos += 1,
            }
        }
    }

    fn in_template_substitution(&self) -> bool {
        self.template_braces.last() == Some(&0)
    }

    fn regex_or_punctuator(&mut self) {
        let start = self.pos;
        self.pos += 1; // skip /
        let mut in_class = false;
        while self.pos < self.bytes.len() {
            let byte = self.bytes[self.pos];
            match byte {
                b'\\' => {
                    self.pos += 2;
                    continue;
                }
                b'\n' | b'\r' => {
                    // Unterminated regex; fall back to a `/` punctuator.
                    self.pos = start + 1;
                    self.push(TokenKind::Punctuator, start, self.pos);
                    return;
                }
                b'[' => in_class = true,
                b']' => in_class = false,
                b'/' if !in_class => {
                    self.pos += 1;
                    // Consume flag identifier characters.
                    while self.peek(0).is_some_and(is_ident_continue) {
                        self.pos += 1;
                    }
                    self.push(TokenKind::Regex, start, self.pos);
                    return;
                }
                _ => {}
            }
            self.pos += 1;
        }
        self.push(TokenKind::Regex, start, self.pos);
    }

    fn punctuator(&mut self) {
        let start = self.pos;
        let len = punctuator_len(&self.bytes[self.pos..]);
        // Track brace depth inside template substitutions so the matching `}`
        // resumes the template instead of being read as a bare punctuator.
        if len == 1 {
            match self.bytes[self.pos] {
                b'{' => {
                    if let Some(depth) = self.template_braces.last_mut() {
                        *depth += 1;
                    }
                }
                b'}' => {
                    if let Some(depth) = self.template_braces.last_mut() {
                        *depth = depth.saturating_sub(1);
                    }
                }
                _ => {}
            }
        }
        self.pos += len.max(1);
        self.push(TokenKind::Punctuator, start, self.pos);
    }

    /// Decides whether a `/` at the current position begins a regex literal,
    /// using the standard "previous significant token" heuristic.
    fn regex_allowed(&self) -> bool {
        let Some(prev) = self.last_significant_token() else {
            return true;
        };
        match prev.kind {
            TokenKind::Number
            | TokenKind::String
            | TokenKind::Regex
            | TokenKind::NoSubTemplate
            | TokenKind::TemplateTail => false,
            TokenKind::Identifier => {
                // A plain identifier (a value) ends an expression, so `/` is
                // division. Only operator-like keywords expect an operand next
                // and therefore precede a regex literal.
                matches!(
                    self.token_str(prev),
                    "return"
                        | "typeof"
                        | "instanceof"
                        | "in"
                        | "of"
                        | "new"
                        | "delete"
                        | "void"
                        | "do"
                        | "else"
                        | "yield"
                        | "await"
                        | "case"
                        | "throw"
                )
            }
            TokenKind::Punctuator => {
                // After a closing `)`/`]`/`}` a `/` is division; otherwise regex.
                !matches!(self.token_str(prev), ")" | "]" | "}")
            }
            // Comments are filtered out by `last_significant_token`.
            TokenKind::LineComment | TokenKind::BlockComment => true,
            TokenKind::TemplateHead | TokenKind::TemplateMiddle => true,
        }
    }

    fn last_significant_token(&self) -> Option<&Token> {
        self.tokens
            .iter()
            .rev()
            .find(|token| !token.kind.is_comment())
    }

    fn token_str(&self, token: &Token) -> &str {
        // SAFETY-free: ranges always fall on UTF-8 boundaries because tokens are
        // built from byte scans that never split multibyte identifier bytes.
        std::str::from_utf8(&self.bytes[token.start..token.end]).unwrap_or("")
    }
}

fn is_ident_start(byte: u8) -> bool {
    byte == b'_' || byte == b'$' || byte.is_ascii_alphabetic() || byte >= 0x80
}

fn is_ident_continue(byte: u8) -> bool {
    is_ident_start(byte) || byte.is_ascii_digit()
}

/// Returns the byte length of the punctuator at the start of `rest`, matching
/// the longest valid operator. Always returns at least 1 for any input.
fn punctuator_len(rest: &[u8]) -> usize {
    const FOUR: &[&[u8]] = &[b">>>="];
    const THREE: &[&[u8]] = &[
        b"===", b"!==", b">>>", b"**=", b"<<=", b">>=", b"&&=", b"||=", b"??=", b"...",
    ];
    const TWO: &[&[u8]] = &[
        b"=>", b"==", b"!=", b"<=", b">=", b"&&", b"||", b"??", b"?.", b"++", b"--", b"+=", b"-=",
        b"*=", b"/=", b"%=", b"&=", b"|=", b"^=", b"<<", b">>", b"**",
    ];
    if rest.len() >= 4 && FOUR.contains(&&rest[..4]) {
        return 4;
    }
    if rest.len() >= 3 && THREE.contains(&&rest[..3]) {
        return 3;
    }
    if rest.len() >= 2 && TWO.contains(&&rest[..2]) {
        return 2;
    }
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(source: &str) -> Vec<(TokenKind, &str)> {
        tokenize(source)
            .into_iter()
            .map(|token| (token.kind, &source[token.start..token.end]))
            .collect()
    }

    #[test]
    fn lexes_basic_punctuators_and_identifiers() {
        assert_eq!(
            kinds("const x = 1;"),
            vec![
                (TokenKind::Identifier, "const"),
                (TokenKind::Identifier, "x"),
                (TokenKind::Punctuator, "="),
                (TokenKind::Number, "1"),
                (TokenKind::Punctuator, ";"),
            ]
        );
    }

    #[test]
    fn matches_longest_punctuator() {
        assert_eq!(
            kinds("a >>>= b ?.c ?? d"),
            vec![
                (TokenKind::Identifier, "a"),
                (TokenKind::Punctuator, ">>>="),
                (TokenKind::Identifier, "b"),
                (TokenKind::Punctuator, "?."),
                (TokenKind::Identifier, "c"),
                (TokenKind::Punctuator, "??"),
                (TokenKind::Identifier, "d"),
            ]
        );
    }

    #[test]
    fn lexes_strings_and_comments() {
        assert_eq!(
            kinds("'a\\'b' /* c */ // d"),
            vec![
                (TokenKind::String, "'a\\'b'"),
                (TokenKind::BlockComment, "/* c */"),
                (TokenKind::LineComment, "// d"),
            ]
        );
    }

    #[test]
    fn distinguishes_regex_from_division() {
        assert_eq!(
            kinds("a = /ab+/gi"),
            vec![
                (TokenKind::Identifier, "a"),
                (TokenKind::Punctuator, "="),
                (TokenKind::Regex, "/ab+/gi"),
            ]
        );
        assert_eq!(
            kinds("a / b / c"),
            vec![
                (TokenKind::Identifier, "a"),
                (TokenKind::Punctuator, "/"),
                (TokenKind::Identifier, "b"),
                (TokenKind::Punctuator, "/"),
                (TokenKind::Identifier, "c"),
            ]
        );
    }

    #[test]
    fn lexes_template_with_substitution() {
        assert_eq!(
            kinds("`a${ b + 1 }c`"),
            vec![
                (TokenKind::TemplateHead, "`a${"),
                (TokenKind::Identifier, "b"),
                (TokenKind::Punctuator, "+"),
                (TokenKind::Number, "1"),
                (TokenKind::TemplateTail, "}c`"),
            ]
        );
    }

    #[test]
    fn lexes_nested_braces_in_substitution() {
        assert_eq!(
            kinds("`${ {a: 1} }`"),
            vec![
                (TokenKind::TemplateHead, "`${"),
                (TokenKind::Punctuator, "{"),
                (TokenKind::Identifier, "a"),
                (TokenKind::Punctuator, ":"),
                (TokenKind::Number, "1"),
                (TokenKind::Punctuator, "}"),
                (TokenKind::TemplateTail, "}`"),
            ]
        );
    }

    #[test]
    fn lexes_nested_templates() {
        assert_eq!(
            kinds("`${`${x}`}`"),
            vec![
                (TokenKind::TemplateHead, "`${"),
                (TokenKind::TemplateHead, "`${"),
                (TokenKind::Identifier, "x"),
                (TokenKind::TemplateTail, "}`"),
                (TokenKind::TemplateTail, "}`"),
            ]
        );
    }

    #[test]
    fn lexes_numbers() {
        assert_eq!(
            kinds("0xFF 1_000 1.5e-3 10n"),
            vec![
                (TokenKind::Number, "0xFF"),
                (TokenKind::Number, "1_000"),
                (TokenKind::Number, "1.5e-3"),
                (TokenKind::Number, "10n"),
            ]
        );
    }

    #[test]
    fn regex_after_return_keyword() {
        assert_eq!(
            kinds("return /x/"),
            vec![(TokenKind::Identifier, "return"), (TokenKind::Regex, "/x/"),]
        );
    }
}
