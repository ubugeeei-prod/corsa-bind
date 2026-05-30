---
title: corsa-bind
description: Native Rust and JavaScript bindings for the Corsa TypeScript checker — type-aware Oxlint, stdio API + LSP, and zero-cost hot paths, with a strict no-forks-no-patches upstream policy.
---

# corsa-bind

Native Rust and JavaScript bindings for the **Corsa** TypeScript checker — fast,
type-aware tooling without reimplementing the checker and without forking it.

`corsa-bind` is a multi-crate workspace for talking to
[Corsa](https://devblogs.microsoft.com/typescript/typescript-native-port/) (the
native TypeScript 7 implementation line) over stdio. Hot paths live in Rust and
stay zero-cost; `napi-rs` and a shared C ABI surface that performance to
JavaScript, C, C++, Go, Zig, C#, Swift, and MoonBit — so you can build custom
checker tooling and type-aware lint rules on top of the real upstream checker.

## Quick start

```bash
nix develop
vp install
vp run -w build
```

```rust
use corsa::{
    api::{ApiClient, ApiSpawnConfig},
    runtime::block_on,
};

fn main() -> Result<(), corsa::CorsaError> {
    block_on(async {
        let client = ApiClient::spawn(ApiSpawnConfig::new(".cache/corsa")).await?;
        let init = client.initialize().await?;
        println!("{}", init.current_directory);
        client.close().await
    })
}
```

New here? The [Getting started guide](./getting_started.md) walks through the
Rust, Node.js, and type-aware Oxlint entry points from a clean checkout.

## Why corsa-bind

- **Rust-first performance.** Hot paths are zero-cost Rust with msgpack-first
  stdio defaults; JS/TS authoring keeps full ergonomics through `napi-rs`.
- **Type-aware Oxlint.** Author Oxlint plugins with real Corsa type information,
  backed by [native rule implementations](./native_rules.md) ported from
  `tsgolint`.
- **Bindings everywhere.** One C ABI (`corsa_ffi`) powers C, C++, Go, Zig, C#,
  Swift, and MoonBit; `@corsa-bind/napi` covers Node.js, Deno, and Bun.
- **Reproducible upstream.** `ref/corsa-upstream` is pinned by exact commit with
  a strict **no forks, no patches** policy, so behavior stays auditable.

## Start here

- [Getting started](./getting_started.md) — first program in Rust, Node.js, and Oxlint.
- [Architecture](./project_guide.md) — workspace shape, upstream policy, extension points.

## Use the bindings

- [Node.js binding](./nodejs_binding.md) — the full `@corsa-bind/napi` surface for Node, Deno, and Bun.
- [Language bindings](./language_bindings.md) — the `corsa_ffi` C ABI for C, C++, Go, Zig, C#, Swift, MoonBit.
- [Type-aware Oxlint](./oxlint_guide.md) — `corsa-oxlint` rule authoring, native rules, and stylistic rules.
- [Native rules](./native_rules.md) — the full set of type-aware rules implemented natively in Rust.
- [Stylistic rules](./stylistic_rules.md) — the Rust-backed `@stylistic`-compatible formatting rules.

## Run and ship

- [CI and local checks](./ci_guide.md) — reproduce the GitHub checks locally.
- [Performance commands](./performance.md) — benchmark entrypoints and the artifacts they write.
- [Stylistic benchmark](./stylistic_benchmark.md) — native stylistic throughput vs the upstream `@stylistic` plugin.
- [Release process](./release_guide.md) — package publishing and release verification.
- [API index](./api/index.md) — generated reference pages for the public Node entrypoints.

## Operational reference

- [Production readiness](./production_readiness.md) — supported runtime controls and release gates.
- [Support policy](./support_policy.md) — supported platforms, bindings, and experimental scope.
- [Supply chain](./supply_chain_policy.md) — dependency and publishing policy.
- [Upstream pin](./corsa_upstream_dependency.md) — how the checked-in Corsa revision is synced and verified.

## Build and deploy

Build the static documentation site locally:

```bash
vp run -w docs_build
```

Deploy with Void. The root `void.json` points Void at the docs build and
`dist/docs` output directory, so this runs from the repository root:

```bash
npx void deploy
```
