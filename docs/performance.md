# Performance

`corsa` ships with multiple benchmark layers:

- Native real-tsgo benchmark: `vp run -w bench_native`
- Native deep benchmark: `vp run -w bench_native_deep`
- Native profiling benchmark: `vp run -w bench_native_profile`
- Tooling + orchestration benchmark: `vp run -w bench_tooling_compare`
- Multi-language binding benchmark: `vp run -w bench_bindings`
- Node binding benchmark: `vp run -w bench_ts`
- Combined benchmark + budget guard: `vp run -w bench_verify`
- Combined all-in benchmark entrypoint: `vp run -w bench`

For day-to-day formatting, linting, and testing, prefer `vp fmt`, `vp lint`,
and `vp check`. Those go through Vite+'s `oxfmt` / `oxlint` toolchain. The
`vp run -w ...` commands below are the specialized benchmark entrypoints.

The TS benchmark writes its report to `.cache/bench_ts.json`.
The native benchmark writes its report to `.cache/bench_native.json`.
The native deep benchmark writes its report to `.cache/bench_native_deep.json`.
The native profiling benchmark writes its report to `.cache/bench_native_profile.json`.
The tooling benchmark writes its report to `.cache/bench_tooling_compare.json`.
The binding benchmark writes its report to `.cache/bench_bindings.json`.

The native runner is still the main source of truth for transport-level speed because it measures the Rust client directly against the pinned upstream worker.

For the reasoning behind these benchmark layers, implementation notes, and extension tips, see [benchmarking_guide.md](./benchmarking_guide.md).

## Tooling Runner

The tooling benchmark is the `bench_tooling_compare` binary. It tracks two workloads:

- `project_check`: `tsc`, `tsgo`, `typescript-eslint`, and `tsgolint` on the same dataset
- `editor_workflow`: `corsa` msgpack cold and warm orchestration over a representative multi-query API flow

Before running it for the first time, install the comparison dependencies:

```bash
vp run -w bench_tooling_setup
```

Then run:

```bash
cargo run --release -p corsa --bin bench_tooling_compare -- \
  --iterations 10 \
  --warmup-iterations 2 \
  --json-output .cache/bench_tooling_compare.json
```

`project_check` is the apples-to-apples CLI comparison.
`editor_workflow` is intentionally a different workload: it asks whether session reuse and orchestration can beat rerunning a full `tsgo --noEmit` project check.

The runner creates temporary overlay `tsconfig` files for CLI parity, enforces per-process timeouts, and always kills plus reaps spawned children before returning.

## Binding Runner

`vp run -w bench_bindings` builds small benchmark executables for the non-Node bindings and writes `.cache/bench_bindings.json`.

The current binding runner measures:

- `c`
- `cpp`
- `go`
- `swift`

Each language currently runs two scenarios:

- `classify_type_text`
- `spawn_initialize`

The goal of this layer is different from `bench_tooling_compare`: it is meant to compare wrapper overhead and end-to-end binding startup behavior across the language surfaces shipped in this repository.

## Native Runner

The native benchmark runner is the `bench_real_tsgo` binary:

```bash
cargo run --release -p corsa --bin bench_real_tsgo -- \
  --cold-iterations 5 \
  --warm-iterations 20 \
  --json-output .cache/bench_native.json
```

For a heavier pass that is better suited to before/after comparisons, use:

```bash
cargo run --release -p corsa --bin bench_real_tsgo -- \
  --cold-iterations 10 \
  --warm-iterations 80 \
  --json-output .cache/bench_native_deep.json
```

For a detailed breakdown of request encode / transport / decode phases on the default fast path, use:

```bash
cargo run --release -p corsa --bin bench_real_tsgo -- \
  --profile \
  --transport msgpack \
  --cold-iterations 5 \
  --warm-iterations 40 \
  --json-output .cache/bench_native_profile.json
```

Warm scenarios perform one untimed warm-up call before sampling.
The runner now emits sample count, `p99`, standard deviation, coefficient of variation, and per-scenario msgpack-vs-jsonrpc comparison rows in both stdout and JSON output.
`profiling` mode additionally emits per-method phase rows so you can see whether time is going to request serialization, transport, or response decoding.

Default native scenarios now cover both transport and type-query hot paths:

- `spawn_initialize`
- `parse_config`
- `update_snapshot_cold`
- `update_snapshot_warm`
- `default_project`
- `get_source_file`
- `get_symbol_at_position`
- `get_type_at_position`
- `get_type_of_symbol`
- `get_string_type`
- `type_to_string`
- `resolve_type_text`

## Datasets

| dataset          | files |   bytes |  lines | config                                                     |
| ---------------- | ----: | ------: | -----: | ---------------------------------------------------------- |
| `ast`            |    29 | 630,429 | 14,653 | `ref/typescript-go/_packages/ast/tsconfig.json`            |
| `native-preview` |    71 | 939,501 | 21,144 | `ref/typescript-go/_packages/native-preview/tsconfig.json` |
| `_extension`     |    13 |  78,255 |  2,022 | `ref/typescript-go/_extension/tsconfig.json`               |

## 2026-03-31 Tooling Compare

All numbers below are median milliseconds from:

```bash
vp run -w bench_tooling_compare
```

### Project Check

| dataset      |   `tsc` | `tsgo` | `typescript-eslint` |
| ------------ | ------: | -----: | ------------------: |
| `ast`        | 425.527 | 23.995 |            1690.141 |
| `api`        | 440.209 | 35.783 |            1341.204 |
| `_extension` | 612.055 | 58.801 |            1136.773 |

### Editor Workflow

These rows are intentionally not the same workload as a full compiler CLI check.
They model a `corsa` session that opens a project once and then runs a representative query flow (`default project` + `source file` + `symbol` + `type` + `typeToString`).

| dataset      | `tsgo` CLI project check | `corsa` cold workflow | `corsa` warm workflow |
| ------------ | -----------------------: | --------------------: | --------------------: |
| `ast`        |                   23.995 |                19.666 |                 0.376 |
| `api`        |                   35.783 |                30.049 |                 0.181 |
| `_extension` |                   58.801 |                45.811 |                 0.186 |

The interesting part is not that `corsa` somehow beats the underlying engine on identical work.
It does not.
The interesting part is that orchestration plus session reuse can beat rerunning `tsgo --noEmit` when the workload is editor-like rather than a full project check.

## 2026-03-30 Native Bench

All numbers below are median milliseconds from:

```bash
vp run -w bench_native
```

| mode      | dataset      | spawn+initialize | parseConfigFile | updateSnapshot cold | updateSnapshot warm | getDefaultProject | getSourceFile | getStringType | typeToString |
| --------- | ------------ | ---------------: | --------------: | ------------------: | ------------------: | ----------------: | ------------: | ------------: | -----------: |
| `jsonrpc` | `ast`        |           20.385 |           0.205 |              28.934 |               0.075 |             0.040 |         0.389 |         0.025 |        0.025 |
| `jsonrpc` | `api`        |           19.846 |           0.289 |              32.262 |               0.070 |             0.040 |         0.113 |         0.024 |        0.024 |
| `jsonrpc` | `_extension` |           19.678 |           0.194 |              44.434 |               0.068 |             0.030 |         0.083 |         0.029 |        0.022 |
| `msgpack` | `ast`        |            6.546 |           0.166 |              16.104 |               0.052 |             0.020 |         0.167 |         0.011 |        0.010 |
| `msgpack` | `api`        |            6.226 |           0.266 |              22.039 |               0.050 |             0.024 |         0.046 |         0.013 |        0.013 |
| `msgpack` | `_extension` |            6.671 |           0.172 |              33.712 |               0.046 |             0.012 |         0.033 |         0.015 |        0.011 |

## TS Benchmark Notes

`vp run -w bench_ts` runs the Node binding through Vitest benchmark mode and emits `.cache/bench_ts.json`.
`vp run -w bench_verify` regenerates both benchmark reports and then runs a guard test over `.cache/bench_ts.json` and `.cache/bench_native.json`.

The current Vitest bench summary is useful for relative ranking but the JSON files are the better artifacts to inspect when tracking regressions over time.

## Notes

- `ApiSpawnConfig::new()` defaults to `SyncMsgpackStdio`, because it is still consistently ahead on the measured real-tsgo paths.
- `getSourceFile` benefits strongly from msgpack because async JSON-RPC has to carry binary payloads through JSON framing.
- `bench/src/report_guard.test.ts` fails when benchmark samples go missing or when the measured hot paths drift past the configured budget.
- `src/bindings/rust/corsa/tests/real_tsgo_baseline.rs` pins the real upstream API summary for the locked `tsgo` commit.
- `printNode` is intentionally excluded from the default native suite at the pinned upstream commit because the real `tsgo` server can still panic inside `internal/printer` on real project data.
