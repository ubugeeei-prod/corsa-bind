# Production Readiness Audit

This audit records the source-level gaps that currently block a fully
production-ready posture. It was prepared from the tracked implementation on
2026-05-21, covering the Rust core, JSON-RPC transport, client lifecycle,
orchestrator, Node binding, oxlint integration, C ABI, non-Node bindings, CI,
and release workflows.

The project already has meaningful production controls: bounded defaults,
release dry runs, cargo-deny, pinned GitHub Actions, npm provenance, Scorecard
monitoring, and an explicit experimental scope for distributed mode. The items
below are the remaining issues that should be resolved or explicitly accepted
before treating every public surface as production-ready.

## Findings

| Priority | Issue                                                     | Area               | Production risk                                                                                                   |
| -------- | --------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| P0       | [#94](https://github.com/ubugeeei/corsa-bind/issues/94)   | Orchestrator       | `execute_all` can deadlock when bounded work and result queues apply backpressure to larger batches.              |
| P0       | [#98](https://github.com/ubugeeei/corsa-bind/issues/98)   | C ABI              | Returned strings assume no interior NUL bytes, so user-controlled text can panic across FFI boundaries.           |
| P1       | [#96](https://github.com/ubugeeei/corsa-bind/issues/96)   | JSON-RPC           | Connection shutdown drops the reader handle instead of deterministically closing and joining it.                  |
| P1       | [#97](https://github.com/ubugeeei/corsa-bind/issues/97)   | Client lifecycle   | Concurrent `initialize` and capability callers can race and send duplicate handshakes.                            |
| P1       | [#99](https://github.com/ubugeeei/corsa-bind/issues/99)   | FFI wrappers       | Optional payloads and errors share the same absent-byte shape, making wrappers misclassify valid empty responses. |
| P1       | [#101](https://github.com/ubugeeei/corsa-bind/issues/101) | oxlint integration | Type-aware lint sessions can compute type data from stale on-disk text instead of the source being linted.        |
| P2       | [#95](https://github.com/ubugeeei/corsa-bind/issues/95)   | Snapshot cleanup   | Snapshot drop spawns detached cleanup work per release and hides release failures.                                |
| P2       | [#100](https://github.com/ubugeeei/corsa-bind/issues/100) | Node binding       | Synchronous N-API methods block the JavaScript event loop during tsgo requests.                                   |
| P2       | [#102](https://github.com/ubugeeei/corsa-bind/issues/102) | CI coverage        | Non-Node language bindings are present without first-class compile or smoke-test coverage.                        |
| P2       | [#103](https://github.com/ubugeeei/corsa-bind/issues/103) | Supply chain       | Published artifacts do not yet include generated SBOMs.                                                           |

## Readiness Gate

Before declaring the whole project production-ready, the release owner should:

- close or explicitly risk-accept every P0 and P1 issue
- make each supported binding compile and smoke-test in CI
- document unsupported or experimental bindings in the public support matrix
- attach SBOMs, or document a replacement attestation strategy, for public binary
  distribution
- rerun the release checklist in [Production Readiness Guide](./production_readiness.md)

## Review Notes

This audit intentionally tracks gaps as issues instead of bundling large behavior
changes into the documentation pull request. The issues contain implementation
evidence and acceptance criteria so each fix can be reviewed, tested, and
released independently.
