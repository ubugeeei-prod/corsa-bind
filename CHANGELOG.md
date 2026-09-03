# Changelog

Only releases that carried a documented change are listed here. Many versions
between 0.7.1 and 1.9.0 shipped without changelog entries; this file does not
reconstruct them, and the [GitHub Releases](https://github.com/ubugeeei-prod/corsa-bind/releases) page has the full list of
published versions.

## Unreleased

### Fixed

- published Node wrapper types now declare the 1.13.0 named methods `getSymbolsAtPositions`, `getAliasedSymbol`, `getImmediateAliasedSymbol`, and `getExportsOfModule`. The N-API binary already exposed them; `dist/index.d.mts` lagged because `ts/index.ts` was not updated.
- the JSON driver mirrored numeric handles into `objectId` for only 26 of the 33 upstream methods that read it, so `getReturnTypeOfSignature`, `getApparentType`, `getApparentPropertiesOfType`, `getNonNullableType`, `getReducedType`, `getConstraintOfTypeParameter`, and `getDefaultFromTypeParameter` silently returned `null` on stable TypeScript 7 runtimes. `isTypeAssignableTo`'s `source`/`target` handles are now numeric-encoded as well.
- `checker.getTypeAtLocation(callExpression)` resolved the touching token (the callee leaf) instead of the call result; call expressions now resolve through the callee's call signatures, `await` expressions unwrap the promise reference, and compound (`typeof A | typeof B`) constructor types keep their compound instance types through `new` expressions.
- 33 of the 59 native rules were authored against a checker-fact vocabulary the JS bridge never produced, leaving whole rule paths silent in production (only synthetic-fact unit tests exercised them). Every rule's documented facts are now wired through per-rule fact providers, and all 59 rules carry `RuleTester` valid/invalid suites that run against the real pinned binary.
- the orchestrator's `fleet()` had a check-then-insert race that could orphan freshly spawned worker processes, `prewarm()` could overshoot the replica target under concurrency, and the experimental Raft layer's configured `snapshot_threshold` never triggered compaction because `maybe_compact_log` was implemented but never called.
- `no-deprecated` no longer re-derives JSDoc deprecation by reading source files off disk and scanning for `@deprecated` markers; the bridge asks the checker's `getJsDocTags` and forwards the deprecation (and its reason) as facts.
- `no-base-to-string` no longer false-positives on functions and arrays of safe element types; array/tuple element types are inspected the way upstream's join-certainty walk does, and nominal types are judged by their checker-provided member lists.
- the Nix dev shell builds again: the `blacksmith` and `moonbit` latest-channel hashes had drifted, and `nix/vite-plus` pinned a lockfile for vite-plus 0.1.21 against a manifest asking for 0.2.9.

### Added

- the Node binding exposes named sync/async wrappers for project-scoped
  `getTypesAtPositions`, so batched type lookups no longer need untyped
  `callJson` strings. The handwritten wrapper interface is updated in the
  same change so published `dist/index.d.mts` keeps the names.
  `getPropertyOfType` and `isTypeAssignableTo`. These are thin checker
  relations; `getSignaturesOfType` stays on `callJson` because that path
  fills `parameterTypeTexts`.
- the Node binding exposes named sync/async wrappers for project-scoped
  `getSymbolsAtPositions`, `getAliasedSymbol`, and
  `getImmediateAliasedSymbol`, avoiding untyped `callJson` calls on common
  symbol-resolution hot paths. The same facade now exposes
  `getExportsOfModule` for checker-owned module export enumeration.
- full typescript-eslint option parity for the native rule set, including `ignoreVoid`/`ignoreIIFE`/`checkThenables`/`allowForKnownSafeCalls`/`allowForKnownSafePromises` (no-floating-promises), `allow`/`allowRethrowing`/`allowThrowingAny`/`allowThrowingUnknown` (only-throw-error), `checkUnknown`/`ignoredTypeNames` (no-base-to-string), `allow` lists for restrict-template-expressions, prefer-promise-reject-errors, and prefer-readonly-parameter-types (plus `treatMethodsAsReadonly`), `allowSingleElementEquality` with the `s[0] === "a"` detection family (prefer-string-starts-ends-with), and `defaultCaseCommentPattern` (switch-exhaustiveness-check). [`docs/typescript_eslint_parity.md`](./docs/typescript_eslint_parity.md) tracks the per-rule status.
- `no-floating-promises` and `only-throw-error` moved to the upstream message catalogs (`floating*`, `object`/`undef`); their previous local `unexpected` IDs no longer exist.
- the corsa-oxlint checker shim exposes `getJsDocTags` and `isTypeAssignableTo`, backed by the corresponding upstream endpoints with per-snapshot caching.
- `LintRuleRegistry::run_rule_owned`, `run_default_type_aware_rule_owned`, and the shared `default_type_aware_registry()` avoid rebuilding the 59-rule registry and deep-cloning the node on every bridge call; JSON-RPC envelopes classify via the new consuming `RawMessage::into_kind`.

### Changed

- the napi addon builds with the new `release-napi` cargo profile (`panic = "unwind"`): with the previous `panic = "abort"`, any Rust panic inside the addon aborted the host Node.js process instead of surfacing as a JS exception.
- native rule metas declare a permissive options schema so Oxlint accepts configured rule options end to end.
- the upstream pin moved to microsoft/TypeScript `0c8f63f745ec` (2026-08-25, past Content mappers round 2); the full real-Corsa validation matrix is green with no binding adaptations.
- per-query overheads trimmed across the stack: optional responses decode in one pass (no intermediate `serde_json::Value`), the per-type-query `statSync` is throttled, cross-file source reads are memoized, and signature parameter symbols resolve through one batched `getTypesOfSymbols` call.

### Removed

- `corsa_core::fast` no longer re-exports `Bump`/`BumpString`, and the workspace no longer depends on `bumpalo`; `corsa_lsp` drops its unused `log` dependency; `corsa_orchestrator` only pulls `lsp-types` when the `experimental-distributed` feature is enabled.
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
