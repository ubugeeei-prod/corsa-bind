---
title: Stylistic benchmark
description: Throughput of the native corsa stylistic engine versus the upstream @stylistic ESLint plugin on the same corpus and rule set.
---

# Stylistic Benchmark

This benchmark compares the native corsa stylistic engine (Rust, single source
scan) against the **real upstream [`@stylistic`](https://eslint.style) ESLint
plugin** (JavaScript, ESLint + a TypeScript parser) on the *same* corpus and the
*same* rule set.

Run it with:

```bash
node bench/stylistic/compare.mjs
```

On first run it bootstraps `@stylistic/eslint-plugin`, `eslint`, and
`@typescript-eslint/parser` into a git-ignored `.cache/bench_stylistic/`
prefix (the same approach as the conformance oracle), then writes
`.cache/bench_stylistic.json`.

## What is measured

- **Corpus** — the package's own TypeScript sources
  (`src/bindings/nodejs/corsa_oxlint/ts`): 63 files, ~358 KB, ~11.7 k lines of
  real-world TS.
- **Rule set** — the intersection of the rules corsa implements and the rules
  `@stylistic` ships: **41 rules**, each at `error` with default options.
- **Workload** — both engines lint every file from source on each iteration
  (corsa re-lexes; `@stylistic` re-parses via ESLint's `Linter`), so the
  comparison is apples-to-apples on identical inputs.
- The corsa side is timed by the `bench_stylistic_compare` Rust binary; the
  `@stylistic` side is timed in-process through ESLint's `Linter.verify`.

## Results

Median milliseconds to lint the whole corpus once (120 iterations, warm):

| engine       | median ms |   p95 ms |   MB/s | diagnostics |
| ------------ | --------: | -------: | -----: | ----------: |
| **corsa**    |     12.66 |    13.14 |  27.60 |       3 662 |
| `@stylistic` |    259.95 |   288.98 |   1.34 |       3 710 |

**corsa is ≈20× faster** than `@stylistic` on this workload (the ratio runs
20–25× across machines; corsa's time is steady while ESLint's varies with V8
warm-up and GC).

The two engines report nearly the same number of diagnostics — **3 662 vs
3 710 (98.7 %)** — consistent with the
[conformance harness](./stylistic_rules.md#parity-verification): the small gap
is the handful of cases that genuinely need a full AST or type information (for
example a `?:` ternary in `space-infix-ops`), which corsa tracks explicitly
rather than guessing at.

## Why the gap

The speed comes from the architecture, not from doing less work per rule:

- **One scan, all rules.** corsa lexes and bracket-matches each source **once**
  and shares that scan across every enabled rule. `@stylistic` runs each rule as
  a separate ESLint AST visitor over a full parse tree.
- **No AST round-trip.** corsa's rules reason about a flat token stream plus
  light structural context; `@stylistic` needs a complete ESTree/TS AST and the
  ESLint rule runtime (scope analysis, source-code service, per-rule listeners).
- **Native hot path.** the scan and all rule logic are zero-cost Rust; the JS
  side only batches the request.

This mirrors the single-native-scan model described in the
[stylistic rules reference](./stylistic_rules.md#the-native-scan-engine).

## Caveats

- `@stylistic` operates on a real AST, so it is correct on constructs corsa's
  heuristics approximate; the diagnostic-count parity above quantifies how close
  the two are in practice on real code.
- Numbers depend on the corpus and hardware. Re-run `bench/stylistic/compare.mjs`
  (optionally `--corpus <dir>` / `--iterations <n>`) to measure your own.

## See also

- [Stylistic rules](./stylistic_rules.md) — the native scan engine and parity methodology.
- [Performance](./performance.md) — the broader benchmark suite (CLI, transport, bindings).
