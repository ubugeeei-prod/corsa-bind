# Changelog

Only releases that carried a documented change are listed here. Many versions
between 0.7.1 and 1.9.0 shipped without changelog entries; this file does not
reconstruct them, and the [GitHub Releases](https://github.com/ubugeeei-prod/corsa-bind/releases) page has the full list of
published versions.

## Unreleased

### Removed

- default runtime discovery no longer looks for `@typescript/native-preview`. TypeScript 7 ships the same native binary through the same mechanism — `typescript` declares `@typescript/typescript-<platform>-<arch>` as an optional dependency and reads `lib/tsc` out of it, exactly as the preview channel did with `lib/tsgo` — so the preview lookup only ever won on machines with no TypeScript 7 installed. Resolution is now `typescript` 7 or newer, then `.cache/corsa`. Consumers still on the preview package can point at it with `CORSA_EXECUTABLE`, `parserOptions.corsa.executable`, or `resolveFrom`. This supersedes the `@typescript/native-preview` discovery entries in 1.0.0-beta.2 and 1.6.0.

## 1.9.0 - 2026-08-18

1.8.0 was bumped on `main` but never tagged, so it was never published. Everything
below shipped in 1.9.0.

### Added

- `ApiClient` gained project-scoped variants for every relation endpoint that previously only had a project-less form: `get_type_parameters_of_type_in_project`, `get_outer_type_parameters_of_type_in_project`, `get_local_type_parameters_of_type_in_project`, `get_object_type_of_type_in_project`, `get_index_type_of_type_in_project`, `get_check_type_of_type_in_project`, `get_extends_type_of_type_in_project`, `get_base_type_of_type_in_project`, `get_parent_of_symbol_in_project`, `get_members_of_symbol_in_project`, `get_exports_of_symbol_in_project`, and `get_export_symbol_of_symbol_in_project`. Stable TypeScript 7 runtimes reject the project-less forms.
- `ApiClient::get_parameters_of_signature` and `ApiClient::get_this_parameter_of_signature` expose the upstream endpoints that resolve a signature's parameter symbol handles.
- `NodeHandle::declaring_path` reads the declaring file out of both node handle wire formats, including the compact stable-runtime form that `NodeHandle::parse` rejects.

### Fixed

- type relation requests that carry a type handle now always name the project that issued it, so `getTypesOfType` returns union members instead of throwing `empty project ID for type handle <n>` ([#440](https://github.com/ubugeeei-prod/corsa-bind/issues/440)). The same omission silently affected `getTargetOfType`, `getTypeParametersOfType`, `getOuterTypeParametersOfType`, `getLocalTypeParametersOfType`, `getObjectTypeOfType`, `getIndexTypeOfType`, `getCheckTypeOfType`, `getExtendsTypeOfType`, and `getBaseTypeOfType`, which are fixed with it.
- signature parameter symbols now come from the checker via `getParametersOfSignature` instead of being reconstructed by scanning the declaration out of the source file, so construct signatures of classes with an explicit constructor expose `parameterSymbols` on stable TypeScript 7 runtimes ([#441](https://github.com/ubugeeei-prod/corsa-bind/issues/441)). The old reconstruction only ever worked when the declaration handle carried source offsets, and silently produced nothing once stable runtimes moved to compact handles. `thisParameterSymbol` is resolved the same way, through `getThisParameterOfSignature`.
- type-handle requests now resolve in the project that issued the handle rather than the snapshot's first project, which matters once a snapshot spans several projects.

## 1.7.0 - 2026-08-10

### Fixed

- `corsa-oxlint` no longer treats a compact TypeScript 7 declaration handle as a source range, resolves type symbols in the project that owns the type handle, and ignores `class` text inside comments and string literals when recovering a declaration position.

## 1.6.0 - 2026-08-07

### Fixed

- type, signature, and symbol relation requests now mirror numeric handles into the `objectId` field that TypeScript 7 stable runtimes expect, so `getSymbolOfType`, `getBaseTypes` metadata, and `getImplementedTypesOfType` keep working for class types imported from other files ([#427](https://github.com/ubugeeei-prod/corsa-bind/issues/427)).
- `corsa-oxlint` recovers class-declaration positions for compact TypeScript 7 declaration handles instead of misreading node ids as source offsets, keeping same-named classes in different scopes distinct.
- the default runtime discovery now resolves the `@typescript/native-preview` platform executable (`lib/tsgo`, `tsgo.exe` on Windows) instead of the meta package's Node bin script, which Windows cannot spawn ([#428](https://github.com/ubugeeei-prod/corsa-bind/issues/428)).

## 1.3.0 - 2026-07-30

### Removed

- The `corsa-oxlint/stylistic` entrypoint, native stylistic lint engine, and stylistic benchmarks have moved to [`ubugeeei-prod/oxlint-plugins`](https://github.com/ubugeeei-prod/oxlint-plugins).

## 1.0.0-beta.5 - 2026-07-18

### Fixed

- `corsa-oxlint` now resolves nominal type symbols for interface and class property annotations.
- `corsa-oxlint` now returns direct and inherited implemented interfaces after symbol, base-type, and generic-argument traversal while accepting compact TypeScript 7 declaration handles.

## 1.0.0-beta.2 - 2026-07-13

### Fixed

- `corsa-oxlint` now discovers the native Corsa runtime shipped with TypeScript 7 or newer before falling back to `@typescript/native-preview`.

## 0.43.0 - 2026-06-08

### Added

- `corsa-oxlint` now exposes a `RuleContext<MessageId, Options>` type and generic `defineRule` wrapper for narrowing rule options and report message IDs.

## 0.42.0 - 2026-06-08

### Added

- `corsa-oxlint` now exposes per-node-type `ESTree.*` aliases from the root entrypoint.

### Fixed

- `corsa-oxlint` now reports a dependency-focused error when no default Corsa runtime executable can be found.
- constructor signature parameter symbol fallback now preserves non-ASCII parameter names.
- imported inherited constructor signatures with non-ASCII JSDoc retain resolvable parameter symbols.

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
