---
title: Stylistic rules
description: The Rust-backed @stylistic-compatible formatting rules in corsa-oxlint — the native scan engine, configuration, the full rule list, and how parity is verified against the real @stylistic plugin.
---

# Stylistic Rules

`corsa-oxlint/stylistic` ships a set of **formatting rules that need no type
information**. They are re-implementations of the
[`@stylistic`](https://eslint.style) ESLint plugin, but the decision logic runs
entirely in Rust (`corsa_core::lint::stylistic`) on a single scan of the source
text. The JS layer is a thin bridge that batches every enabled rule into one
N-API call.

Unlike the [native type-aware rules](./native_rules.md), stylistic rules never
talk to the Corsa checker — so they have no per-node type queries, no project
loading, and no `requiresTypeChecking` cost. They are pure source-to-diagnostics
functions.

> [!NOTE]
> Coverage is expanding toward full `@stylistic` parity. The authoritative,
> always-current list is exported programmatically as
> `implementedStylisticRuleNames` from `corsa-oxlint/stylistic`; the table below
> is generated from the same registry.

## The native scan engine

Every stylistic rule shares one pass over the source. There is no AST round-trip
to the checker; instead the engine builds, lazily and at most once per source:

1. **A lexer** (`stylistic/lexer.rs`) — a lenient TypeScript/JavaScript
   tokenizer that never fails and preserves byte ranges for every token. It
   handles the parts of the grammar that token-level rules care about:
   longest-match punctuators, identifiers/keywords, numeric/string literals,
   template literals with nested `${…}` substitutions, regular-expression
   literals (resolved from the previous significant token), and both comment
   forms. Whitespace is *not* tokenized — rules recover it from the gaps between
   adjacent token ranges.

2. **A structural context** (`stylistic/context.rs`, `Scan`) — bracket matching
   plus light classifiers that answer the questions a flat token list cannot:
   - **`brace_kind`** — does this `{` open a block or an object-like group
     (object literal/pattern, `import`/`export` bindings)?
   - **`bracket_kind`** — is this `[` an array literal or a computed member
     access?
   - **`paren_use`** — is this `(` a control header (`if`/`for`/…), a function
     definition, a call, or a grouping?

   These classifiers are heuristics, not a parser. They resolve the vast
   majority of real-world TypeScript/JavaScript; the handful of cases that
   genuinely need a full AST (for example distinguishing a computed object key
   `{ [k]: v }` from a nested array) are documented on each classifier and are
   covered by the parity harness below.

Three rule families are layered on top:

| Layer | Module | Needs |
| --- | --- | --- |
| Line rules | `line_rules.rs` | line index only (e.g. `max-len`, `eol-last`) |
| Token rules | `token_rules.rs` | the token stream (e.g. `comma-spacing`) |
| Context rules | `context_rules.rs` | the token stream **and** the structural classifiers (e.g. `object-curly-spacing`) |

A rule is only charged for the work it needs: the line index and the
token/bracket scan are each built lazily, and only when an enabled rule requires
them.

## Enabling them

Register the plugin under any namespace and enable rules. Options can be passed
inline:

```ts
import { corsaStylisticPlugin } from "corsa-oxlint/stylistic";

export default [
  {
    plugins: { stylistic: corsaStylisticPlugin },
    rules: {
      "stylistic/quotes": ["error", "single", { avoidEscape: true }],
      "stylistic/comma-dangle": ["error", "always-multiline"],
      "stylistic/object-curly-spacing": ["error", "always"],
      "stylistic/space-before-function-paren": "error",
    },
  },
];
```

### Sharing one native scan

Oxlint runs each JS plugin rule independently, but the stylistic rules can all
share **one** Rust scan per source. To take that fast path, mirror the same
option payloads under `settings.corsaStylistic.rules`; the bridge then batches
every configured rule into a single N-API call and caches the diagnostics so
each `stylistic/<rule>` report reads from the shared result:

```ts
export default [
  {
    settings: {
      corsaStylistic: {
        rules: {
          "eol-last": ["always"],
          "no-multiple-empty-lines": [{ max: 1, maxBOF: 0, maxEOF: 1 }],
          quotes: ["single", { avoidEscape: true }],
          "comma-dangle": ["always-multiline"],
          semi: ["always"],
        },
      },
    },
    plugins: { stylistic: corsaStylisticPlugin },
    rules: {
      "stylistic/eol-last": "error",
      "stylistic/no-multiple-empty-lines": "error",
      "stylistic/quotes": "error",
      "stylistic/comma-dangle": "error",
    },
  },
];
```

Option shapes match `@stylistic` exactly, so existing configs port over by
swapping the plugin namespace.

## Supported rules

Rules are grouped by family. The default column states the behaviour with no
explicit options.

### Whitespace and lines

| Rule | Description | Default |
| --- | --- | --- |
| `eol-last` | Require or disallow a newline at the end of files. | `always` |
| `linebreak-style` | Enforce consistent linebreak characters. | `unix` |
| `no-multiple-empty-lines` | Limit consecutive blank lines. | `max: 2` |
| `no-trailing-spaces` | Disallow whitespace at the end of lines. | — |
| `no-tabs` | Disallow tab characters. | — |
| `no-multi-spaces` | Disallow multiple spaces between tokens. | — |
| `max-len` | Enforce a maximum line length. | `code: 80, tabWidth: 4` |
| `unicode-bom` | Require or disallow a Unicode byte order mark. | `never` |

### Spacing around tokens and operators

| Rule | Description | Default |
| --- | --- | --- |
| `arrow-spacing` | Spacing before/after the `=>` of arrow functions. | `before: true, after: true` |
| `comma-spacing` | Spacing before/after commas. | `before: false, after: true` |
| `semi-spacing` | Spacing before/after semicolons. | `before: false, after: true` |
| `space-in-parens` | Spacing just inside parentheses. | `never` |
| `space-infix-ops` | Require spacing around infix operators. | — |
| `space-unary-ops` | Spacing around unary operators. | `words: true, nonwords: false` |
| `template-curly-spacing` | Spacing inside template `${…}`. | `never` |
| `rest-spread-spacing` | Spacing after a rest/spread `...`. | `never` |
| `template-tag-spacing` | Spacing between a template tag and its literal. | `never` |
| `switch-colon-spacing` | Spacing around `case`/`default` colons. | `after: true, before: false` |
| `yield-star-spacing` | Spacing around the `*` in `yield*`. | `before: false, after: true` |
| `generator-star-spacing` | Spacing around the `*` in generators. | `before: true, after: false` |
| `no-whitespace-before-property` | Disallow whitespace before a `.property`. | — |
| `dot-location` | Newline placement around the member `.`. | `object` |

### Brackets, blocks, and calls

| Rule | Description | Default |
| --- | --- | --- |
| `object-curly-spacing` | Spacing inside object/destructuring/import braces. | `never` |
| `array-bracket-spacing` | Spacing inside array literal brackets. | `never` |
| `computed-property-spacing` | Spacing inside computed member brackets. | `never` |
| `block-spacing` | Spacing inside single-line blocks. | `always` |
| `space-before-blocks` | Spacing before a block's opening brace. | `always` |
| `function-call-spacing` | Spacing between a callee and its call `(`. | `never` |
| `space-before-function-paren` | Spacing before a function/method/catch `(`. | `always` |

### Punctuation and syntax

| Rule | Description | Default |
| --- | --- | --- |
| `quotes` | Enforce single or double quotes for strings. | `double` |
| `comma-dangle` | Require or disallow trailing commas. | `never` |
| `comma-style` | Comma at the end vs. start of a line. | `last` |
| `semi-style` | Semicolon at the end vs. start of a line. | `last` |
| `no-extra-semi` | Disallow unnecessary semicolons. | — |
| `arrow-parens` | Parentheses around a single arrow parameter. | `always` |
| `new-parens` | Parentheses on an argument-less `new`. | `always` |
| `no-floating-decimal` | Disallow leading/trailing decimal points. | — |
| `spaced-comment` | Spacing after a `//` or `/*` marker. | `always` |

## Parity verification

Stylistic conformance is measured **against the real `@stylistic` plugin**, not
against hand-written expectations:

- A differential oracle (`.cache/oracle/oracle.mjs`) runs every rule's spec
  snippets through the genuine `@stylistic` rule under its default options and
  records the true violation count.
- The Rust harness `stylistic_rules_match_spec_vectors`
  (`lint/stylistic_conformance.rs`) runs each native rule over the same snippets
  and compares counts, failing if any aligned rule drops below its recorded
  floor.

This keeps the native re-implementations honest as coverage grows: a rule is
only considered "done" once it matches upstream on the conformance corpus.
Known divergences are limited to cases that genuinely require a full AST or type
information (for example a `?:` ternary in `space-infix-ops`), and are tracked
explicitly rather than silently.

## Adding a rule

1. Implement `check_<rule>(scan, options, diagnostics)` in `line_rules.rs`,
   `token_rules.rs`, or `context_rules.rs`, with `#[cfg(test)]` unit tests.
2. Register it in `stylistic/mod.rs`: a message constant, a `STYLISTIC_RULES`
   table entry, membership in `TOKEN_RULE_NAMES` (or the `needs_lines` set), and
   a dispatch arm.
3. Mirror the name into `stylistic.ts` (`CorsaStylisticRuleName` and
   `implementedStylisticRuleNames`) and `stylistic.test.ts`, keeping the order
   identical to the Rust table.
4. Regenerate the oracle (`cd .cache/oracle && node oracle.mjs`) and confirm the
   conformance harness passes.

## See also

- [Type-aware Oxlint](./oxlint_guide.md) — authoring model and configuration.
- [Native rules](./native_rules.md) — the type-aware Rust rule set.
- [Stylistic benchmark](./stylistic_benchmark.md) — throughput vs the upstream `@stylistic` plugin.
- [Performance](./performance.md) — the single-scan stylistic performance model.
