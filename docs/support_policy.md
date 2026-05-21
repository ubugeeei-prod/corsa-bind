# Support Policy

This document defines what `corsa` treats as supported for production-style
use and what remains experimental.

## Supported Surface

The supported production surface is currently:

- local Rust API clients
- published Node bindings for the documented prebuilt targets
- LSP stdio integrations
- local worker orchestration and cache reuse
- C ABI, C++ headers, and Go wrappers that pass the non-Node binding CI smoke suite

The following remains experimental and outside the production support
commitment:

- the `experimental-distributed` cargo feature
- the in-process Raft replication layer
- upstream endpoints explicitly called out as unstable
- C#, Swift, Zig, and MoonBit wrappers until their toolchains are added to the
  required CI matrix

## Release Channels

- `main`: active development branch; fixes land here first
- latest published `0.x` release line: intended support target for external consumers
- older `0.x` releases: unsupported once a newer `0.x` line is available

Until the first public release series is cut, `main` remains the only line that
receives fixes.

## Compatibility Matrix

- Rust: `1.85+`
- Node.js runtime for published packages: `22+`
- Node.js tooling for repository scripts and examples: `24+`
- Go: the version declared by `ref/typescript-go/go.mod`
- Operating systems: Linux, macOS, and Windows for the supported local surface
- Published Node prebuilds: `darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-arm64-musl`, `linux-x64-gnu`, `linux-x64-musl`, `win32-arm64-msvc`, `win32-x64-msvc`

CI is expected to exercise:

- workspace quality checks on Linux, macOS, and Windows
- real `tsgo` smoke coverage on Linux, macOS, and Windows
- C ABI, C++ header, and Go wrapper smoke coverage on Ubuntu
- benchmark verification on Ubuntu

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
