# Production Readiness Guide

This document is the short operational checklist for running `corsa` in production-style environments.

For the current source-level gap register, see [Production Readiness Audit](./production_readiness_audit.md).

## Scope

The current production target is:

- local Rust and JS API clients
- published JS bindings for Node.js, Deno, and Bun with prebuilt packages for supported targets
- LSP stdio integrations
- local worker orchestration and cache reuse

The following remains experimental:

- the `experimental-distributed` cargo feature
- the in-process Raft replication layer
- upstream endpoints called out as unstable by this repository

## Default Safety Controls

The default runtime configuration now includes:

- per-request timeout: `30s`
- graceful shutdown timeout: `2s`
- bounded outbound queue capacity: `256`
- unstable upstream endpoints disabled by default

These defaults can be overridden through:

- `ApiSpawnConfig`
- `LspSpawnConfig`
- `ApiOrchestratorConfig`

## Recommended Settings

For long-lived services:

- keep `request_timeout` enabled
- reduce `outbound_capacity` if you prefer earlier backpressure
- tune `max_cached_snapshots` and `max_cached_results` to fit process memory budgets
- wire a `TsgoObserver` into spawn/orchestrator configs so timeouts and evictions reach your telemetry stack
- leave unstable upstream endpoints disabled unless you have a concrete need and a rollback plan

For editor-like integrations:

- use stable cache keys for snapshots
- prewarm a small worker fleet instead of spawning per request
- treat the distributed orchestrator as experimental unless you are actively developing it

## Release Checklist

- `vp check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `vp run -w test`
- `cargo test -p corsa --no-default-features --test orchestrator`
- `cargo test -p corsa --features experimental-distributed --test orchestrator`
- `vp run -w bench_verify`
- `vp run -w verify_ref`
- `cargo deny check advisories bans licenses sources`
- non-Node binding smoke coverage for the supported C ABI, C++, and Go surfaces
- SPDX SBOM generation for Rust, npm, and native release artifacts
- `vp run -w release_dry_run`

## Cross-Platform Expectations

The main quality workflow is intended to stay green on:

- Linux
- macOS
- Windows

Real `tsgo` smoke coverage now runs across the supported OS matrix, while the
heavier benchmark verification remains concentrated in the Ubuntu benchmark job.

Published JS prebuild coverage currently targets:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64-gnu`
- `linux-arm64-musl`
- `linux-x64-gnu`
- `linux-x64-musl`
- `win32-arm64-msvc`
- `win32-x64-msvc`

Release safety rule: do not publish `@corsa-bind/napi` for a new version until all
eight native binding packages for that version are built and staged. The root
package's optional dependencies are versioned, so a partial first publish would
leave later platforms stranded until the next release.
