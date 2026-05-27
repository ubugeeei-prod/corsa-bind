# Examples

These examples are split into three groups:

- `examples/nodejs/*`: executable `@corsa-bind/napi` samples
- `examples/rust/*`: executable Rust samples
- `examples/corsa_oxlint/*`: reusable `corsa-oxlint` rule/plugin/config samples

If you are picking a first example, use this quick map:

| Goal                                         | Node                                      | Rust                                          |
| -------------------------------------------- | ----------------------------------------- | --------------------------------------------- |
| edit in-memory documents                     | `minimal_start.ts`, `virtual_document.ts` | `minimal_start.rs`, `virtual_document.rs`     |
| inspect symbols, types, and signatures       | `checker_queries.ts`                      | `checker_queries.rs`                          |
| drive snapshot queries with a mock server    | `mock_client.ts`, `raw_calls.ts`          | `mock_client.rs`                              |
| exercise orchestration and observability     | `distributed_orchestrator.ts`             | `orchestrator_cache.rs`, `observer_events.rs` |
| use upstream-only printer APIs intentionally | -                                         | `print_node_opt_in.rs`                        |
| author type-aware Oxlint rules               | `corsa_oxlint/*`                          | -                                             |

## Prerequisites

Enter the Nix dev shell, let Vite+ provision Node, then build the workspace
packages and native bindings first:

```bash
nix develop
vp install
vp run -w build
```

Run all smoke-tested examples:

```bash
vp run -w examples_smoke
```

Run only the Node / TypeScript example suite:

```bash
vp run -w examples_node_smoke
```

Run only the Rust example suite:

```bash
vp run -w examples_rust_smoke
```

Build the real pinned Corsa binary before running the real-snapshot examples:

```bash
vp run -w sync_ref
vp run -w verify_ref
vp run -w build_corsa
vp run -w examples_real
```

Run the experimental distributed Rust example:

```bash
vp run -w examples_rust_experimental
```

## Minimal Start

These examples do not require a real Corsa binary and are the best first touchpoints.

- `examples/nodejs/minimal_start.ts`: zero-binary start that combines virtual-document edits with the Rust-backed unsafe-type helpers
- `examples/nodejs/unsafe_type_flow.ts`: direct `isUnsafeAssignment()` / `isUnsafeReturn()` predicates for quick rule prototyping
- `examples/nodejs/virtual_document.ts`: focused in-memory document editing through `CorsaVirtualDocument`
- `examples/rust/minimal_start.rs`: smallest Rust facade example for `VirtualDocument`, `RequestId`, and `block_on()`
- `examples/rust/virtual_document.rs`: incremental and replace-style edits through the Rust `VirtualDocument`

Run one of them directly with:

```bash
pnpm --dir examples run minimal-start
cargo run -p corsa --example minimal_start
```

## Mock Binary Workflows

These examples use the repo-local mock Corsa binary so you can exercise realistic API and LSP flows without building the real upstream server.

- `examples/nodejs/checker_queries.ts`: advanced checker walkthrough using `callJson()` for symbols, types, signatures, and relation endpoints
- `examples/nodejs/mock_client.ts`: high-level mock API roundtrip through `CorsaApiClient`
- `examples/nodejs/raw_calls.ts`: low-level `callJson()` / `callBinary()` escape hatches for custom endpoints
- `examples/nodejs/distributed_orchestrator.ts`: in-process distributed state replication for virtual documents
- `examples/rust/checker_queries.rs`: typed symbol/type/signature traversal with parsed declaration handles and relation helpers
- `examples/rust/mock_client.rs`: typed snapshot, source-file, and type-string queries through the Rust API client
- `examples/rust/filesystem_callbacks.rs`: custom `ApiFileSystem` callbacks with a virtualized workspace
- `examples/rust/lsp_overlay.rs`: `LspClient` plus `LspOverlay` for `didOpen` / `didChange` / `didClose`
- `examples/rust/orchestrator_cache.rs`: local worker pooling, snapshot caching, and parallel fan-out through `ApiOrchestrator`
- `examples/rust/observer_events.rs`: structured `CorsaEvent` capture for cache eviction and operational telemetry

Run one of them directly with:

```bash
pnpm --dir examples run checker-queries
pnpm --dir examples run raw-calls
cargo run -p corsa --example checker_queries
cargo run -p corsa --example lsp_overlay
```

## Opt-In Upstream Printer

This example is separate because it demonstrates an upstream endpoint that is intentionally opt-in.

- `examples/rust/print_node_opt_in.rs`: enables `allow_unstable_upstream_calls`, turns a type into a serialized node, and renders it through `printNode`

Run it with:

```bash
cargo run -p corsa --example print_node_opt_in
```

## Real Pinned Corsa

These examples hit the exact upstream-pinned checkout under `ref/corsa-upstream`.

- `examples/nodejs/real_snapshot.ts`: opens the pinned project through `@corsa-bind/napi` and fetches a real source file snapshot
- `examples/rust/real_snapshot.rs`: the Rust-side equivalent using the msgpack-first API client

Run one directly with:

```bash
pnpm --dir examples run real-snapshot
cargo run -p corsa --example real_snapshot
```

## Experimental Distributed

This example is intentionally separated because it requires the cargo feature.

- `examples/rust/distributed_orchestrator.rs`: replicated document and cached-result flow through `DistributedApiOrchestrator`

Run it with:

```bash
cargo run -p corsa --features experimental-distributed --example distributed_orchestrator
```

## `corsa-oxlint` Examples

- `examples/corsa_oxlint/custom_rule.ts`: custom type-aware rule using `OxlintUtils.getParserServices()`
- `examples/corsa_oxlint/custom_plugin.ts`: plugin wrapper around the custom rule
- `examples/corsa_oxlint/custom_rules_config.ts`: flat config using the custom plugin
- `examples/corsa_oxlint/native_rules_config.ts`: flat config using the built-in native rules
- `examples/corsa_oxlint/rule_tester.ts`: executable `RuleTester` example against the real pinned Corsa binary
- `examples/corsa_oxlint/native_rule_tester.ts`: executable `RuleTester` example for the built-in Rust-backed and TS-native rules
