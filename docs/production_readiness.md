# Production Readiness Guide

This document is the short operational checklist for running `corsa-bind` in production-style environments.

For the current source-level gap register, see [Production Readiness Audit](./production_readiness_audit.md).

## Scope

The current production target is:

- local Rust and JS API clients
- published JS bindings for Node.js, Deno, and Bun with prebuilt packages for supported targets
- LSP stdio integrations
- local worker orchestration and cache reuse

The following remains experimental:

- upstream endpoints called out as unstable by this repository

Distributed orchestration was removed in 2.0; see
[support_policy.md](./support_policy.md).

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
- wire a `CorsaObserver` into spawn/orchestrator configs so timeouts and evictions reach your telemetry stack
- leave unstable upstream endpoints disabled unless you have a concrete need and a rollback plan

For editor-like integrations:

- use stable cache keys for snapshots
- prewarm a small worker fleet instead of spawning per request
- acquire project leases (`ApiOrchestrator::acquire_project`) instead of leasing
  raw workers, so each project stays on the worker that is already warm for it
- drain a fleet with `ApiOrchestrator::shutdown_profile` after a `tsconfig`
  change or an upstream binary upgrade, rather than letting it grow

## Scaling Story

Scale a single machine first:

```text
one machine
  ├ worker 1 — project A
  ├ worker 2 — project B
  ├ worker 3 — project C
  └ worker 4 — spare
```

Checker state has strong affinity to a repo and its project graph, so requests
are not interchangeable across nodes and replicated snapshot state buys little.
When one machine is genuinely not enough, shard at the repo level — repo A to
machine A, repo B to machine B. That is why the Raft-backed replication layer
was removed in 2.0 rather than promoted.

## Release Checklist

- `vp check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `vp run -w test`
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

Real Corsa smoke coverage now runs across the supported OS matrix, while the
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
