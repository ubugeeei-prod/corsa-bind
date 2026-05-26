# Changelog

## Unreleased

## 0.7.1 - 2026-05-16

### Added

- production-oriented transport controls for request timeout, shutdown timeout, and bounded outbound queues
- bounded local orchestrator caches plus lightweight orchestrator stats
- an explicit guard around unstable upstream endpoints such as `printNode`
- cross-platform CI coverage for the main quality job
- package metadata, security guidance, and production-readiness documentation

### Changed

- `printNode` now requires explicit opt-in through `ApiSpawnConfig::with_allow_unstable_upstream_calls(true)`
- local worker orchestration now enforces configured resource limits instead of growing unbounded
- pinned Corsa upstream has been refreshed to the 2026-05-15 upstream main revision
- package publishing now requires tag refs for manual runs, and GitHub Release creation uses the release environment
