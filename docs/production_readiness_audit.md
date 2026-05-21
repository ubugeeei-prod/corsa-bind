# Production Readiness Audit

This audit records the source-level gaps that blocked a fully production-ready
posture in the 2026-05-21 review of the Rust core, JSON-RPC transport, client
lifecycle, orchestrator, real `tsgo` typecheck/type emit coverage, Node binding,
oxlint integration, C ABI, non-Node bindings, CI, and release workflows.

The project already had meaningful production controls: bounded defaults,
release dry runs, cargo-deny, pinned GitHub Actions, npm provenance, Scorecard
monitoring, and an explicit experimental scope for distributed mode. The items
below are the issues that were tracked from the audit and their remediation
status.

## Remediation Status

| Priority | Issue                                                     | Area               | Status                                                                                    |
| -------- | --------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| P0       | [#94](https://github.com/ubugeeei/corsa-bind/issues/94)   | Orchestrator       | Covered by unbounded result fan-in and regression tests for oversized batches and panics. |
| P0       | [#98](https://github.com/ubugeeei/corsa-bind/issues/98)   | C ABI              | C strings now carry explicit lengths and tolerate interior NUL bytes.                     |
| P1       | [#96](https://github.com/ubugeeei/corsa-bind/issues/96)   | JSON-RPC           | Connections now close outbound state and join reader threads with bounded fallback.       |
| P1       | [#97](https://github.com/ubugeeei/corsa-bind/issues/97)   | Client lifecycle   | Initialize and capability handshakes now use singleflight caching.                        |
| P1       | [#99](https://github.com/ubugeeei/corsa-bind/issues/99)   | FFI wrappers       | Optional byte payloads now expose explicit error, none, and some status.                  |
| P1       | [#101](https://github.com/ubugeeei/corsa-bind/issues/101) | oxlint integration | Type-aware sessions send in-memory source overlays when the runtime supports them.        |
| P1       | [#105](https://github.com/ubugeeei/corsa-bind/issues/105) | Semantic coverage  | Real `tsgo` positive and negative semantic fixtures are covered in the Rust test suite.   |
| P2       | [#95](https://github.com/ubugeeei/corsa-bind/issues/95)   | Snapshot cleanup   | Snapshot releases flow through a bounded shared cleanup worker.                           |
| P2       | [#100](https://github.com/ubugeeei/corsa-bind/issues/100) | Node binding       | Promise-based N-API methods are available for tsgo requests and lifecycle operations.     |
| P2       | [#102](https://github.com/ubugeeei/corsa-bind/issues/102) | CI coverage        | CI now smoke-checks the supported C ABI, C++ header, and Go wrapper surfaces.             |
| P2       | [#103](https://github.com/ubugeeei/corsa-bind/issues/103) | Supply chain       | Release and supply-chain workflows now generate SPDX SBOM artifacts.                      |

## Readiness Gate

Before declaring a release production-ready, the release owner should still:

- confirm all audit remediation issues are closed by the release PR
- rerun real typecheck and type emit fixtures against the pinned `tsgo`
- ensure every supported binding compile and smoke-test job is green
- keep unsupported or experimental bindings explicit in the public support matrix
- attach generated SBOM artifacts for public binary distribution
- rerun the release checklist in [Production Readiness Guide](./production_readiness.md)

## Review Notes

This audit intentionally tracks production-readiness gaps as issues. Each issue
contains implementation evidence and acceptance criteria so fixes can be
reviewed, tested, and released with clear provenance.
