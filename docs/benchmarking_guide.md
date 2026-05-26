# Benchmarking Principles, Concepts, and Tips

This document explains how `corsa` thinks about performance work.
It is intentionally more conceptual than [performance.md](./performance.md), which is the place for commands and measured numbers.
For CI structure, local reproduction, and troubleshooting, see [ci_guide.md](./ci_guide.md).

## Why This Exists

`corsa` wraps the Corsa upstream.
That creates an important constraint:

- if `corsa` and the Corsa CLI do exactly the same work, `corsa` should usually aim for parity, not miracles
- the realistic place to win is the end-to-end workflow, not the compiler engine itself

That is why this repository keeps benchmark layers separate.
We want to answer different questions with different tools instead of forcing one number to mean everything.

## Core Principles

### 1. No Forks, No Patches, No Fake Wins

`corsa` follows a strict upstream policy:

- use upstream-supported Corsa entry points
- pin an exact upstream commit
- do not patch `ref/typescript-go`

That matters for benchmarking.
If we changed upstream locally, every performance claim would become harder to trust.

### 2. Separate Engine Speed from Wrapper Speed

There are two different questions:

1. How fast is the underlying engine and transport?
2. How fast is the actual user workflow we are building around it?

Those are not the same question.

Examples:

- Corsa CLI vs `tsc` is an engine and compiler CLI comparison
- `msgpack` vs `jsonrpc` is a transport comparison
- `corsa` warm workflow vs Corsa CLI `--noEmit` is an orchestration comparison

If those get mixed together, conclusions become misleading very quickly.

### 3. Cold and Warm Behavior Must Be Measured Separately

Cold runs include process startup, initialization, config loading, and project open cost.
Warm runs ask a different question: what happens after we already paid those setup costs?

For `corsa`, warm behavior is especially important because session reuse is one of the main reasons to exist.

### 4. Apples-to-Apples First, Then Product Reality

We intentionally keep two layers:

- an apples-to-apples CLI comparison for the same project input
- a product-shaped workflow comparison for editor-like usage

The first keeps us honest.
The second tells us whether orchestration is actually worth building.

### 5. Cleanup Is Part of Correctness

A benchmark runner that leaks child processes is not production-ready.
It can distort later measurements, waste resources, and make failures harder to debug.

This repository therefore treats process cleanup as part of benchmark correctness, not as an optional nicety.

## Benchmark Layers

## Native Runner

The native runner is [`bench_real_tsgo`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/main.rs).

Its purpose:

- measure the Rust client directly against the real pinned Corsa binary
- compare transports such as `msgpack` and `jsonrpc`
- inspect hot paths like `updateSnapshot`, `getSourceFile`, and type queries

This is the main source of truth for transport-level questions.

## Tooling Runner

The tooling runner is [`bench_tooling_compare`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/main.rs).

It has two workloads:

- `project_check`
- `editor_workflow`

`project_check` compares:

- `tsc`
- Corsa CLI
- `typescript-eslint`

on the same dataset and the same effective project configuration.

`editor_workflow` compares a realistic `corsa` session:

- open project once
- reuse a live session
- run a representative chain of symbol and type queries

This is the layer that answers whether orchestration actually changes the user-facing speed story.

## Key Concepts

## Why `corsa` Cannot Reliably Beat Corsa on Identical Work

If a wrapper talks to the same engine and asks it to do the same work, it usually inherits:

- the same parsing cost
- the same type-checking cost
- the same project graph cost

So the healthy target is:

- same work: roughly equal to the Corsa CLI, maybe with small overhead
- different workflow: potentially faster if orchestration avoids redundant work

That distinction is the heart of the benchmarking model.

## Where `corsa` Can Win

The realistic win conditions are:

- keep the process alive
- initialize once and amortize setup cost
- prefer the faster transport
- avoid reopening the project for every query
- turn one big CLI-shaped operation into a sequence of smaller targeted queries

That is why `editor_workflow` exists.
It measures the class of work where `corsa` can reasonably outperform rerunning a whole CLI command.

## Why `typescript-eslint` Is Still Useful in Comparisons

`typescript-eslint` is not the same workload as a compiler CLI check.
It performs typed linting, not just compilation.

Even so, it is still a useful reference point because it represents a real type-aware developer workflow on the same codebase.
The comparison should be read as:

- "How expensive is type-aware linting on this project?"

not as:

- "This is the same thing as Corsa CLI `--noEmit`."

## Why Overlay `tsconfig` Files Exist

The tooling runner generates temporary overlay `tsconfig` files.
This is done for fairness and reproducibility.

The overlays are used to:

- add `customConditions: ["@typescript/source"]`
- keep the base project configuration intact
- avoid editing tracked upstream files

There is one subtle but important implementation detail:

- the overlays are created under `ref/typescript-go/.cache/...`, not under the repository root `.cache`

This keeps TypeScript's node module resolution behavior aligned with the upstream workspace, especially for packages like `@types/node`.

## Implementation Walkthrough

## `bench_real_tsgo`

Main files:

- [`args.rs`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/args.rs)
- [`dataset.rs`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/dataset.rs)
- [`scenario.rs`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/scenario.rs)
- [`measure.rs`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/measure.rs)
- [`stats.rs`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/stats.rs)
- [`report.rs`](../src/bindings/rust/corsa/src/bin/bench_real_tsgo/report.rs)

Flow:

1. Parse CLI arguments and choose datasets.
2. Load real project metadata from the pinned Corsa CLI.
3. Run cold and warm scenarios.
4. Collect samples into `Stats`.
5. Emit human-readable tables and machine-readable JSON.

Important design choices:

- warm scenarios perform one untimed call before sampling
- datasets are measured against real `tsconfig` files from the pinned upstream checkout
- symbol/type benchmarks discover a real identifier from the dataset instead of relying on a fake fixture
- `--profile` adds per-method phase samples for `serialize_params`, `transport`, `deserialize_response`, and binary decoding so transport-vs-wrapper costs can be separated quickly

## `bench_tooling_compare`

Main files:

- [`args.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/args.rs)
- [`dataset.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/dataset.rs)
- [`runner.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/runner.rs)
- [`process.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/process.rs)
- [`measure.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/measure.rs)
- [`stats.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/stats.rs)
- [`report.rs`](../src/bindings/rust/corsa/src/bin/bench_tooling_compare/report.rs)

Flow:

1. Load datasets through the real pinned Corsa.
2. Build temporary overlay `tsconfig` files.
3. Run `tsc`, Corsa CLI, `typescript-eslint`, `corsa-oxlint`, and `tsgolint` as child processes for `project_check`.
4. Run a live `corsa` msgpack session for `editor_workflow`.
5. Emit timing tables and JSON.

Important design choices:

- `typescript-eslint`, `corsa-oxlint`, and `tsgolint` are allowed to exit with code `1` because lint findings are expected and should not invalidate timing
- the three lint lanes use the overlapping type-aware rule set currently exported from `corsa-oxlint/rules`
- child processes run with timeouts
- child stdout and stderr are suppressed during timing so the measurement focuses on the actual workload

## Process Cleanup and Safety

The core cleanup utilities live in [`process.rs`](../src/core/corsa_core/src/process.rs).

Key helpers:

- `wait_for_child_exit`
- `terminate_child_process`
- `AsyncChildGuard`

The cleanup policy is:

- try graceful shutdown first when the API supports it
- if the process does not exit in time, kill it
- always reap it with `wait`

This avoids leaving zombie processes behind.

The msgpack worker also follows the same policy via [`msgpack_worker.rs`](../src/core/corsa_client/src/api/msgpack_worker.rs).

## Tips

## Pick the Right Benchmark for the Question

Use:

- `bench_real_tsgo` for transport and API-path questions
- `bench_tooling_compare` for CLI parity and orchestration questions
- Node benchmarks for JS binding overhead and consumer-facing Node workflows

Do not use one benchmark layer to answer a different layer's question.

## Read Workflow Numbers Carefully

If `corsa` beats the Corsa CLI in `editor_workflow`, it does not mean the wrapper is faster than the engine.
It means the wrapper avoided redundant work by reusing state and narrowing the workload.

That is a good outcome, but it is a different claim.

## Treat High Variance as a Signal

If `p95`, `p99`, or `cv%` are high:

- rerun on a quieter machine
- increase warmup or sample count
- check for background work
- check for process leaks or repeated setup costs

Variance often teaches more than the median.

## Keep Setup Reproducible

For tooling benchmarks, install the exact comparison dependencies first:

```bash
vp run -w bench_tooling_setup
```

That keeps `typescript`, `eslint`, and `typescript-eslint` pinned for the comparison runner.

## Never Forget Snapshot and Client Cleanup

If you extend the runners or build new workflows:

- release managed snapshots
- close clients explicitly
- do not rely only on `Drop`

`Drop` is a safety net.
The primary path should still be explicit cleanup.

## Prefer Real Datasets over Toy Fixtures

Toy fixtures are useful for focused regression tests.
They are not enough for performance claims.

The current benchmarks intentionally run on real projects from the pinned upstream checkout because:

- module resolution matters
- project references matter
- file count and file size matter
- hot paths can look very different on real code

## Keep Claims Narrow and Honest

Good claim:

- "`corsa` warm editor workflow is faster than rerunning Corsa CLI `--noEmit` on the same project."

Bad claim:

- "`corsa` is faster than Corsa."

The first says what was actually measured.
The second overstates what the data means.
