# corsa

Rust bindings, orchestration layers, and Node bindings for `typescript-go` over stdio.

> [!WARNING]
> This repository is still evolving.
> The local Rust and Node API/LSP surfaces are now hardened for production-style use,
> but distributed orchestration remains behind the `experimental-distributed`
> cargo feature and some upstream-facing endpoints remain explicitly experimental.

> [!IMPORTANT]
> `corsa` is intentionally built around upstream-supported `typescript-go`
> workflows. We follow `tsgo`'s recommended stdio/API/LSP integration points,
> keep `ref/typescript-go` as an exact upstream checkout, and preserve a strict
> `no forks, no patches` policy.

## What This Is

`corsa` is a multi-crate workspace for talking to `typescript-go` from Rust and Node.js without patching upstream, with a Rust-backed native FFI layer that exposes `tsgo` API, virtual-document, and `utils` surfaces across C-family and other native languages.

In practice, that means:

- use `typescript-go` through the interfaces it already intends consumers to use
- track upstream by exact commit so behavior is reproducible and auditable
- never maintain a fork and never carry local patches against upstream `tsgo`
- implement hot paths in Rust, keep them zero-cost and high-performance, and
  expose them to JS through `napi-rs` so end users can author custom plugins
  and custom rules in JS/TS

Current focus:

- Full Rust-side stdio bindings for the tsgo API
- stdio LSP bindings with virtual-file support
- zero-cost-lean hot paths with msgpack-first defaults
- `napi-rs` bindings that surface Rust performance to JS/TS authoring workflows
- Rust-backed `tsgo` API, `utils`, and virtual-document bindings for C, C++, Go, Zig, C#, Swift, and MoonBit
- local multi-process orchestration, cache reuse, and experimental replicated state
- strict upstream pinning by exact `typescript-go` commit
- regression tests and benchmarks against the real pinned upstream server

## Current Status

- License: MIT
- Upstream policy: `ref/typescript-go` is pinned and tracked by exact commit, with no local patching
- Default API transport: `SyncMsgpackStdio`
- Runtime: custom in-house runtime, no `tokio`
- Fast-path bias: `CompactString`, `SmallVec`, `bumpalo`, `memchr`, `phf`, `FxHash`
- JS toolchain: Vite+ (`vp`) with vp-managed Node `24`, pnpm `10`, `oxfmt`, and `oxlint`
- Repo automation: `scripts/*.ts` executed directly through Node `24` with `--strip-types`
- Node bindings: `@corsa-bind/napi` (`src/bindings/nodejs/corsa_node`) and `corsa-oxlint` (`src/bindings/nodejs/typescript_oxlint`) (public npm packages that still expect a caller-managed `typescript-go` executable)
- Distributed orchestration: `experimental-distributed` cargo feature
- TS benchmark project: `bench`
- Example workspace: `examples`
- Default request timeout: `30s`
- Default graceful shutdown timeout: `2s`
- Default outbound queue capacity: `256`
- Unstable upstream endpoints such as `printNode` are opt-in
- Structured event sink: `TsgoObserver` / `TsgoEvent`

Pinned upstream at the time of writing:

- Repository: `https://github.com/microsoft/typescript-go.git`
- Commit: `9c19dee6ab88ae11444837f16efa16a6b3dc9f59`
- Lock file: [`tsgo_ref.lock.toml`](./tsgo_ref.lock.toml)

## Workspace Layout

- `corsa_core`: shared errors, process handles, and fast-path primitives
- `corsa_jsonrpc`: stdio JSON-RPC framing and connection management
- `corsa_client`: typed tsgo stdio client bindings for JSON-RPC and msgpack
- `corsa_lsp`: LSP client support plus virtual-document overlays
- `corsa_orchestrator`: local orchestration, caching, and experimental replicated state / Raft core
- `corsa_runtime`: lightweight custom runtime and task primitives
- `corsa_ref`: exact upstream pin, sync, and verification tooling
- `corsa`: top-level facade crate, mock server, and native benchmark binaries
- `src/bindings/c/corsa_ffi`: shared C ABI over the Rust `corsa_client::ApiClient`, `corsa_core::utils`, and `corsa_lsp::VirtualDocument` surfaces
- `src/bindings/cpp`, `src/bindings/go`, `src/bindings/zig`, `src/bindings/csharp`, `src/bindings/swift`, `src/bindings/moonbit`: thin language bindings layered on top of `corsa_ffi`
- `src/bindings/nodejs/corsa_node`: `napi-rs` native bindings and the `@corsa-bind/napi` TypeScript wrapper package
- `src/bindings/nodejs/typescript_oxlint`: type-aware Oxlint rule framework powered by `tsgo`
- `bench`: Vitest benchmark project for the Node binding
- `examples`: curated `examples/nodejs`, `examples/rust`, and `examples/typescript_oxlint` flows from minimal start to real-project runs

For a detailed architecture walkthrough, design strategy, and implementation tips, see [docs/project_guide.md](./docs/project_guide.md).
For deployment-oriented defaults, supported scope, and release checks, see [docs/production_readiness.md](./docs/production_readiness.md).
For support guarantees, compatibility, and semver expectations, see [docs/support_policy.md](./docs/support_policy.md).
For distribution decisions and release dry-runs, see [docs/release_guide.md](./docs/release_guide.md).
For dependency-policy and release-hardening expectations, see [docs/supply_chain_policy.md](./docs/supply_chain_policy.md).

Once trusted publishing is bootstrapped, a release is cut from `main` with:

```bash
vp run -w release minor
```

## Quick Start

Enter the Nix dev shell first. It includes the toolchains for every binding
target under `src/bindings`:

```bash
nix develop
vp install
```

The Nix shell itself is authored in [`flake.tnix`](./flake.tnix) and compiled
to [`flake.nix`](./flake.nix) with `tnix`:

```bash
tnix check-project .
tnix compile ./flake.tnix -o ./flake.nix
```

`flake.tnix` is intentionally kept as a thin `tnix` entrypoint, while the full
outputs implementation lives in [`nix/flake-outputs.nix`](./nix/flake-outputs.nix).
That split avoids current `tnix` edges around some larger flake constructs.
See [docs/tnix_notes.md](./docs/tnix_notes.md) for the current limitations and
the reasoning behind the layout.

Sync and verify the pinned upstream checkout:

```bash
vp run -w sync_ref
vp run -w verify_ref
```

Build everything through Vite+:

```bash
vp install
vp run -w build
vp check
```

Repository automation scripts now assume Node `24` so they can run TypeScript
directly through `node --strip-types`. The published npm packages themselves
still target Node `22+`.

## Examples

The repository now ships executable examples for Rust, `@corsa-bind/napi`, and
`corsa-oxlint` under [`examples/`](./examples/README.md), from
minimal virtual-document edits up through checker-query walkthroughs and
opt-in upstream printer flows.

Run the smoke-tested examples with:

```bash
vp run -w examples_smoke
```

Run only the Rust smoke examples with:

```bash
vp run -w examples_rust_smoke
```

Run only the Node / TypeScript smoke examples with:

```bash
vp run -w examples_node_smoke
```

Run the real pinned-`tsgo` examples with:

```bash
vp run -w sync_ref
vp run -w verify_ref
vp run -w build_tsgo
vp run -w examples_real
```

Run the experimental distributed Rust example with:

```bash
vp run -w examples_rust_experimental
```

## Type-Aware Oxlint

`corsa-oxlint` lets us write Oxlint JS plugins with a compact, self-hosted
type-aware authoring model while sourcing type information from the pinned
`tsgo` binary. The heavy lifting stays in Rust, then `napi-rs` binds
that implementation into JS so end users can keep writing custom plugins and
custom rules in JS/TS.

```ts
import { OxlintUtils } from "corsa-oxlint";

const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);

export const noStringPlusNumber = createRule({
  name: "no-string-plus-number",
  meta: {
    type: "problem",
    docs: {
      description: "forbid string + number",
      requiresTypeChecking: true,
    },
    messages: {
      unexpected: "string plus number is forbidden",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = OxlintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      BinaryExpression(node) {
        if (node.operator !== "+") {
          return;
        }
        const left = checker.getTypeAtLocation(node.left);
        const right = checker.getTypeAtLocation(node.right);
        if (!left || !right) {
          return;
        }
        if (
          checker.typeToString(checker.getBaseTypeOfLiteralType(left) ?? left) === "string" &&
          checker.typeToString(checker.getBaseTypeOfLiteralType(right) ?? right) === "number"
        ) {
          context.report({ node, messageId: "unexpected" });
        }
      },
    };
  },
});
```

The rule-side type-aware config lives under `settings.typescriptOxlint`. Package
details and caveats are documented in [`src/bindings/nodejs/typescript_oxlint/README.md`](./src/bindings/nodejs/typescript_oxlint/README.md).

`corsa-oxlint/rules` exposes a TS-native type-aware rule set and plugin:

```ts
import { typescriptOxlintPlugin } from "corsa-oxlint/rules";

export default [
  {
    plugins: {
      typescript: typescriptOxlintPlugin,
    },
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/restrict-plus-operands": ["error", { allowNumberAndString: false }],
    },
  },
];
```

The rule framework is self-hosted and does not depend on third-party
TypeScript lint helper packages. Upstream `tsgolint/internal/rules` is now
used as a parity target and drift oracle rather than as a runtime bridge.

The intended rule architecture has two lanes:

- user-defined type-aware rules keep the `typescript-eslint`-style JS/TS
  authoring model through `OxlintUtils.RuleCreator()` and parser services
- common built-in rules can move onto the Rust hot path through
  `corsa::lint::RustLintRule`, then surface back through the same
  `corsa-oxlint/rules` Oxlint JS plugin shape

This keeps the public integration point aligned with Oxlint's JS plugin API
while leaving room for Rust-authored rule crates, in the spirit of swc-style
Rust extension points. The first Rust-authored builtin rules include
`await-thenable`, `no-array-delete`, `no-for-in-array`, `no-implied-eval`,
`no-mixed-enums`, `no-unsafe-unary-minus`, `only-throw-error`,
`prefer-find`, `prefer-includes`, `prefer-regexp-exec`, and
`use-unknown-in-catch-callback-variable`.

## Example

```rust
use corsa::{
    api::{ApiClient, ApiSpawnConfig},
    runtime::block_on,
};

fn main() -> Result<(), corsa::TsgoError> {
    block_on(async {
        let client = ApiClient::spawn(
            ApiSpawnConfig::new(".cache/tsgo")
                .with_cwd("ref/typescript-go/_packages/native-preview"),
        )
        .await?;

        let init = client.initialize().await?;
        println!("{}", init.current_directory);

        client.close().await?;
        Ok(())
    })
}
```

## Benchmarks

The repo ships two benchmark layers:

- Native Rust benchmark: `vp run -w bench_native`
- Native profiling benchmark: `vp run -w bench_native_profile`
- Node binding benchmark: `vp run -w bench_ts`
- `corsa-oxlint` checker benchmark: `vp test bench --config ./vite.config.ts bench/src/typescript_oxlint.bench.ts`
- `corsa-oxlint` native-rule benchmark: `vp test bench --config ./vite.config.ts bench/src/typescript_oxlint_rules.bench.ts`
- Combined benchmark + budget guard: `vp run -w bench`

The TS benchmark writes machine-readable output to `.cache/bench_ts.json`.
The native benchmark writes machine-readable output to `.cache/bench_native.json`.
The native profiling benchmark writes machine-readable output to `.cache/bench_native_profile.json`.
The native Rust benchmark uses the real pinned tsgo binary through [`bench_real_tsgo`](./src/bindings/rust/corsa/src/bin/bench_real_tsgo/main.rs).

Latest native measurements are documented in [docs/performance.md](./docs/performance.md).
Benchmarking rationale, implementation notes, and usage tips are documented in [docs/benchmarking_guide.md](./docs/benchmarking_guide.md).
CI structure, local reproduction steps, and troubleshooting notes are documented in [docs/ci_guide.md](./docs/ci_guide.md).
On the pinned upstream commit and bundled datasets, `msgpack` was consistently faster than async JSON-RPC, which is why `ApiSpawnConfig::new()` defaults to `SyncMsgpackStdio`.

## Regression Strategy

The repository is intentionally aggressive about change detection because `typescript-go` is still unstable.

- `cargo test --workspace` includes mock-server integration tests, policy tests, and real-tsgo regression tests when `.cache/tsgo` is available
- `src/bindings/rust/corsa/tests/real_tsgo_baseline.rs` locks a real-server API summary to the pinned upstream commit
- `src/bindings/rust/corsa/tests/real_tsgo_regression.rs` checks both transports against the real pinned tsgo binary
- the real-tsgo regression suite includes a hot-path guard that fails if msgpack falls too far behind JSON-RPC on the same machine
- `vp run -w bench_native` and `vp run -w bench_ts` give repeatable transport-level measurements for Rust and Node
- `vp run -w bench_verify` regenerates both reports and fails if benchmark samples disappear or hot-path budgets regress
- `corsa_ref` enforces detached-HEAD exact-commit verification for `ref/typescript-go`
- CI structure and local reproduction notes live in [`docs/ci_guide.md`](./docs/ci_guide.md)

## Upstream Tracking

`typescript-go` is under heavy development, so reproducibility is treated as a hard requirement.

- exact commit metadata lives in [`tsgo_ref.lock.toml`](./tsgo_ref.lock.toml)
- sync and drift tooling lives in [`docs/tsgo_dependency.md`](./docs/tsgo_dependency.md)
- CI and local reproduction details live in [`docs/ci_guide.md`](./docs/ci_guide.md)
- `ref/typescript-go` must remain on detached `HEAD`
- dirty upstream worktrees fail verification

## Known Limitations

- Public APIs are still `0.x`, so compatibility should be treated as conservative rather than frozen.
- `printNode` is disabled by default because the pinned upstream `tsgo` commit can panic in `internal/printer` on real project data; opt in only when you accept that risk.
- The distributed layer currently includes an in-process Raft core; full network transport between nodes is not finished yet.
- Some binary API surfaces are still exposed as opaque encoded payloads rather than fully decoded Rust AST types.

## Development

Useful commands:

```bash
vp install
vp fmt
vp lint
vp test
vp check
vp run -w build
vp run -w bench
vp run -w bench_native
vp run -w bench_native_profile
vp run -w bench_ts
vp run -w bench_verify
vp test run --config ./vite.config.ts
vp test bench --config ./vite.config.ts --outputJson .cache/bench_ts.json
vp run -w sync_ref
vp run -w verify_ref
```
