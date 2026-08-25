---
title: typescript-eslint parity
description: Per-rule implementation status of the native rule set against typescript-eslint — options, facts, message IDs, and test coverage.
---

# typescript-eslint Parity Tracker

This page tracks the native rule set against **typescript-eslint** (and its
native companion surface, `tsgolint/internal/rules`, which is the exact
59-rule target the plugin ships). Every rule listed here:

- is implemented in Rust (`corsa_core::lint`) and exposed as an Oxlint plugin
  rule under the `typescript/` namespace,
- receives its full documented fact vocabulary from the JS bridge (type
  facts come from the pinned Corsa checker — none of the decision inputs are
  synthesized only in tests),
- has Rust unit tests over its decision logic **and** a `RuleTester`
  valid/invalid suite that runs against the real pinned Corsa binary in CI
  (`real-corsa-smoke`).

## Column legend

- **Options** — parity with the upstream typescript-eslint option schema.
  `full` means every documented option is honored. `TypeOrValueSpecifier`
  entries (`allow`, `allowForKnownSafePromises`, …) are matched by type/value
  *name* (array sugar included); the `from:` package/file domain is not
  derivable over the stdio API, so a name match is honored for every domain,
  which errs toward silence.
- **Messages** — whether the rule's message IDs mirror upstream
  typescript-eslint (`upstream`) or use a legacy local catalog (`local`).
  Local IDs are kept where they predate this tracker; migrating them is a
  breaking change for `messageId` matchers and is done rule by rule
  (no-floating-promises and only-throw-error migrated in 1.13).
- **Notes** — residual, deliberate divergences. "conservative" means the rule
  stays silent where a fact cannot be proven over the upstream API (the
  documented degradation contract) instead of guessing.

## Rules

| Rule | Options | Messages | Notes |
| ---- | ------- | -------- | ----- |
| `await-thenable` | full (none) | local (`unexpected`) | |
| `consistent-return` | full | upstream | implicit-return detection is last-statement based, not full control-flow analysis |
| `consistent-type-exports` | full | upstream | cross-module re-exports (`export { X } from '…'`) and `export *` value detection stay conservative |
| `dot-notation` | full | upstream | `private`/`protected` modifiers resolve for same-file declarations |
| `no-array-delete` | full (none) | local (`unexpected`) | |
| `no-base-to-string` | full | local (`unexpected`) | nominal types flag through checker member lists; upstream's certainty tiers collapse to one message |
| `no-confusing-void-expression` | full | upstream | |
| `no-deprecated` | full | upstream | deprecation resolves through the checker's `getJsDocTags`; `allow` matches by reported name |
| `no-duplicate-type-constituents` | full | upstream | duplicates detected by checker type identity (aliases included) |
| `no-floating-promises` | full | upstream | overloaded callees resolve through the first call signature |
| `no-for-in-array` | full (none) | local (`unexpected`) | |
| `no-implied-eval` | full (none) | local (`unexpected`) | |
| `no-meaningless-void-operator` | full | upstream | |
| `no-misused-promises` | full | upstream | contextual function types derive from annotations, call signatures, and JSX attribute symbols; object-literal properties in contextual positions stay conservative |
| `no-misused-spread` | full | upstream | |
| `no-mixed-enums` | full (none) | upstream | |
| `no-redundant-type-constituents` | full (none) | upstream | |
| `no-unnecessary-boolean-literal-compare` | full¹ | upstream | |
| `no-unnecessary-condition` | partial: `checkTypePredicates` not implemented¹ | upstream | type-guard positions and no-overlap comparisons stay conservative |
| `no-unnecessary-qualifier` | full (none) | upstream | namespace scope resolution is AST-based (same-file namespaces) |
| `no-unnecessary-template-expression` | full (none) | upstream | |
| `no-unnecessary-type-arguments` | full (none) | upstream | |
| `no-unnecessary-type-assertion` | full¹ | upstream | `exactOptionalPropertyTypes` special case and use-before-assign flow analysis approximate |
| `no-unnecessary-type-conversion` | full (none) | upstream | |
| `no-unnecessary-type-parameters` | full (none) | upstream | usage counts are AST-reference based |
| `no-unsafe-argument` | full (none) | upstream | |
| `no-unsafe-assignment` | full (none) | local (`unsafe`) | any-flow detection walks rendered generic type texts (see below) |
| `no-unsafe-call` | full (none) | upstream | |
| `no-unsafe-enum-comparison` | full (none) | upstream | |
| `no-unsafe-member-access` | full | upstream | |
| `no-unsafe-return` | full (none) | local (`unsafe`) | |
| `no-unsafe-type-assertion` | full (none) | upstream | |
| `no-unsafe-unary-minus` | full (none) | upstream | |
| `no-useless-default-assignment` | full¹ | upstream | |
| `non-nullable-type-assertion-style` | full (none) | upstream | |
| `only-throw-error` | full | upstream | rethrow detection covers catch bindings and rejection handlers; thenable receiver verification stays conservative |
| `prefer-find` | full (none) | local (`unexpected`) | |
| `prefer-includes` | full (none) | local (`unexpected`) | |
| `prefer-nullish-coalescing` | full¹ | upstream | conditional-test detection is parent-based, not the full ancestor walk |
| `prefer-optional-chain` | full | upstream | |
| `prefer-promise-reject-errors` | full | upstream | |
| `prefer-readonly` | full | upstream | reassignment analysis walks the declaring class body |
| `prefer-readonly-parameter-types` | full | upstream | readonly-ness of deep object types is text-based; unprovable types report (fails closed, matching upstream defaults) |
| `prefer-reduce-type-parameter` | full (none) | upstream | |
| `prefer-regexp-exec` | full (none) | local (`unexpected`) | |
| `prefer-return-this-type` | full (none) | upstream | |
| `prefer-string-starts-ends-with` | full | upstream | |
| `promise-function-async` | full | upstream | |
| `related-getter-setter-pairs` | full (none) | upstream | assignability comes from the checker's `isTypeAssignableTo` |
| `require-array-sort-compare` | full | upstream | |
| `require-await` | full (none) | upstream | `await using` counts as an await-like operation |
| `restrict-plus-operands` | full | upstream | |
| `restrict-template-expressions` | full | upstream | |
| `return-await` | full | upstream | |
| `strict-boolean-expressions` | full¹ | upstream | |
| `strict-void-return` | full | upstream | |
| `switch-exhaustiveness-check` | full | upstream | `defaultCaseCommentPattern` evaluates as a real JS regular expression |
| `unbound-method` | full | upstream | `static` modifiers resolve for same-file declarations; unknowable staticness under `ignoreStatic` degrades to silence |
| `use-unknown-in-catch-callback-variable` | full (none) | local (`unexpected`) | |

¹ `allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing` is intentionally a
no-op: the native lane reads `strictNullChecks` from the project's compiler
options and emits the upstream `noStrictNullCheck` diagnostic where the rule
defines one, but it never hard-errors the whole run the way typescript-eslint
does, so there is nothing for the escape hatch to bypass.

## Beyond the tsgolint surface

typescript-eslint ships more rules than the type-checked surface tracked
here. The rest fall into two groups:

- **Syntax-only rules** (`ban-ts-comment`, `array-type`, `naming-convention`'s
  syntactic core, …) — these need no checker and belong to Oxlint's own
  native rule set, not to this plugin.
- **Type-aware extension candidates** not yet in `tsgolint/internal/rules`
  (e.g. the type-aware half of `naming-convention`). These enter this tracker
  when the upstream parity target adopts them.

## Known engineering trade-offs

Two implementation strategies in the native lane are deliberate and worth
understanding before filing parity bugs:

1. **Rendered-type-text analysis.** Rules like `no-unsafe-assignment`
   detect unsafe `any` flow by parsing the checker's *rendered* generic type
   texts (`Set<any>` → `Set<string>`) instead of walking live checker type
   objects. The upstream API resolves types per request over stdio; a
   recursive structural walk would multiply round trips per node, and the
   checker's `isTypeAssignableTo` cannot answer "unsafe any flow" (any is
   assignable to everything). The text walk mirrors the same structure the
   upstream Go rule walks, at zero additional round trips.
2. **Position-based lookups.** The upstream API addresses types by file
   position (the touching token). Call results, await unwrapping, and
   construct results resolve through callee signatures instead; anonymous
   function literals have no addressable type at all, so their facts derive
   from the literal's AST. This is why a handful of notes above say
   "conservative": where neither a position nor a signature reaches the
   needed type, the rule prefers silence over guessing.

## How this page stays honest

- `implementedNativeRuleNames + pendingNativeRuleNames` is asserted against
  the upstream `tsgolint/internal/rules` directory listing in
  `native_rules.test.ts`; the surface cannot silently drift.
- Every rule's RuleTester suite runs against the real pinned binary in the
  `real-corsa-smoke` CI job (`CORSA_REQUIRE_INTEGRATION=1` turns a missing
  runtime into a hard failure).
- The fact vocabulary consumed by the Rust rules is cross-checked against
  what the bridge produces; a fact consumed but never produced is a bug, not
  a degradation.

## See also

- [Native rules](./native_rules.md) — the rule catalog and bridge design
- [Type-aware Oxlint](./oxlint_guide.md) — authoring model and configuration
