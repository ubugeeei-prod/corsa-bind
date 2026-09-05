# Support Policy

This document defines what `corsa-bind` treats as supported for production-style
use and what remains experimental.

For *why* the surface is shaped this way, see
[architecture_charter.md](./architecture_charter.md).

## Supported Surface

The supported production surface is currently:

- local Rust API clients
- published JS bindings for the documented prebuilt targets
- LSP stdio integrations
- local worker orchestration, project leases, and cache reuse
- C ABI, C++ headers, and Go wrappers that pass the non-Node binding CI smoke suite

The following remains experimental and outside the production support
commitment:

- upstream endpoints explicitly called out as unstable
- C#, Swift, Zig, MoonBit, and Elixir wrappers until their toolchains are added
  to the required CI matrix

## Binding Tiers

Bindings are maintained in two tiers on top of one stable C ABI, so that
maintenance cost does not grow linearly with the language list.

| Tier | Bindings                                 | Commitment                                                                               |
| ---- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1    | Rust, Node.js (`napi-rs`), the C ABI     | covered by the required CI matrix; API design decisions are made here                    |
| 2    | Go, C++, Swift, Zig, C#, MoonBit, Elixir | maintained best-effort on top of the C ABI; may lag tier 1 and do not shape the core API |

Practically:

- a new capability lands in the core and reaches tier 1 first
- tier 2 wrappers are welcome, and breakage in one does not block a release
- tier 2 promotion means adding the toolchain to the required CI matrix, not
  rewriting the wrapper by hand

Go and C++ currently sit in tier 2 by API commitment while still being covered
by the non-Node binding smoke suite listed above.

## Removed Surfaces

Distributed orchestration was **removed in 2.0**: the `experimental-distributed`
cargo feature, `DistributedApiOrchestrator`, the in-process Raft implementation,
the replicated-state model, and the `CorsaDistributedOrchestrator` N-API class
are all gone.

Checker workloads have strong affinity to a repo, its project graph, and mutable
snapshot state, which makes replicated snapshot state a poor fit. The supported
scaling story is a single machine with a well-tuned worker pool — see
`ApiOrchestrator::acquire_project` — and repo-level sharding above that.

Consumers of the removed API have no drop-in replacement, which is the honest
answer: the layer was experimental, never supported for production, and the
capability it approximated is not one this project should own. See
[architecture_charter.md](./architecture_charter.md) rule 8.

## Release Channels

- `main`: active development branch; fixes land here first
- latest published `0.x` release line: intended support target for external consumers
- older `0.x` releases: unsupported once a newer `0.x` line is available

Until the first public release series is cut, `main` remains the only line that
receives fixes.

## Compatibility Matrix

- Rust: `1.85+`
- JavaScript runtimes for published packages: Node.js `22+`, Deno `2.0+`, Bun `1.2+`
- Node.js tooling for repository scripts and examples: `24+`
- Go: the version declared by `ref/corsa-upstream/tsc/go.mod`
- Operating systems: Linux, macOS, and Windows for the supported local surface
- Published Node prebuilds: `darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-arm64-musl`, `linux-x64-gnu`, `linux-x64-musl`, `win32-arm64-msvc`, `win32-x64-msvc`

CI is expected to exercise:

- workspace quality checks on Linux, macOS, and Windows
- Deno and Bun runtime smoke coverage for the published JS wrapper on Linux, macOS, and Windows
- real Corsa smoke coverage on Linux, macOS, and Windows
- C ABI, C++ header, and Go wrapper smoke coverage on Ubuntu
- benchmark verification on Ubuntu

## API Stability Tiers

Two Rust API surfaces exist on purpose, with different stability promises:

| Surface                                         | Promise                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `SemanticQuery` (`ProjectSession::semantics()`) | `corsa-bind`-owned vocabulary; signatures survive upstream renames, and `SEMANTIC_QUERY_VERSION` records the contract |
| `ApiClient` / `ProjectSession` endpoint methods | mirror upstream endpoint names and response shapes; they move when upstream moves                                     |

Consumers that want to be insulated from upstream churn should build against
`SemanticQuery`. Consumers that need the full upstream-shaped payload can use
the mirror, knowingly accepting that churn.

## Semver Policy

The workspace is still in `0.x`.
That means minor releases may include API adjustments, especially around
experimental surfaces.

The intent is still:

- patch releases for bug fixes and low-risk hardening
- minor releases for additive capability and intentional API cleanup
- explicit feature gating for experimental behavior instead of silently widening the stable surface

## Security Maintenance

- security fixes land on `main` first
- the latest supported `0.x` release line should receive security and critical bug fixes
- unsupported lines should not be assumed to receive patches

See also [../SECURITY.md](../SECURITY.md) and
[./production_readiness.md](./production_readiness.md).
