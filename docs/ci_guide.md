# CI and Local Reproduction Guide

This document explains how the repository's CI is structured, how to reproduce it locally, and what changed to make it reliable.

It is intentionally operational.
If [benchmarking_guide.md](./benchmarking_guide.md) explains why the benchmark model exists, this guide explains how the day-to-day CI path is supposed to work.

## Why This Exists

This repository has a slightly unusual shape:

- Rust crates
- Node bindings through `napi-rs`
- JS and TS code checked through Vite+ and Oxlint
- a pinned Corsa upstream checkout under `ref/corsa-upstream`
- regression tests and benchmarks that talk to the real pinned upstream binary

That means "CI is green" is not just one compiler succeeding.
It means several layers agree on:

- workspace type and lint state
- Rust correctness
- Node wrapper correctness
- upstream pin cleanliness
- real Corsa integration behavior
- benchmark report availability

## CI Topology

The workflow lives in [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml).

It currently has these jobs in the main workflow:

- `js-format`
- `js-lint-types`
- `rust-format`
- `rust-lint`
- `build`
- `test`
- `public-facade`
- `quality`
- `real-Corsa-smoke`
- `bench-corsa-ref` (`Corsa Ref Bench`)

The PR performance workflow lives in
[`../.github/workflows/pr-performance.yml`](../.github/workflows/pr-performance.yml).
On PR open, reopen, ready-for-review, and synchronize events it benchmarks:

- PR base branch versus PR head branch
- TypeScript `6` versus the npm `next` TypeScript channel
- five measured samples per row, reported by mean milliseconds

The workflow uploads the four benchmark reports as artifacts, then updates one
sticky PR comment with faster, slower, and stable rows. Rows within 3% are marked
stable to avoid treating benchmark noise as a regression.

## `quality`

The `quality` job answers:

- does the workspace format cleanly?
- do JS and TS lint and type checks pass?
- does Rust pass `fmt` and `clippy`?
- can the workspace build?
- do unit, integration, and JS tests pass?
- does the main path stay healthy across Linux, macOS, and Windows?

The important commands are:

```bash
vp check
vp run -w fmt_check_rust
vp run -w lint_rust
vp run -w build
vp run -w test
```

## `real-Corsa-smoke`

The `real-Corsa-smoke` job answers:

- is the pinned upstream checkout exactly where the lockfile says it should be?
- can the pinned upstream Corsa binary actually build?
- do real-server smoke and typecheck tests pass against that binary on every supported OS?

The important commands are:

```bash
vp run -w sync_ref
vp run -w verify_ref
vp run -w build_corsa
cargo test -p corsa --no-default-features --test real_corsa_regression --test real_corsa_typecheck
```

## `bench-corsa-ref`

The `bench-corsa-ref` job, displayed as `Corsa Ref Bench`, keeps the heavier Ubuntu-only path:

- baseline validation against the pinned upstream server
- benchmark report regeneration
- benchmark guard validation

## Non-Node Binding Smoke Checks

The `non-node-bindings` job validates the production-supported native wrappers
outside Node:

- builds the Rust C ABI crate and mock Corsa server
- runs the Go wrapper tests in `src/bindings/go/corsa_utils`
- compiles the C++ header surface against the generated C ABI header

C#, Swift, Zig, and MoonBit remain tracked as experimental wrappers until their
toolchains are promoted into the required matrix.

## Local Reproduction

## Recommended Environment

The easiest local reproduction path is a shell that provides:

- `vp` for Vite+, Node `24`, and package-manager access
- `rust 1.85+`
- `go 1.26`
- the native-language toolchains under `src/bindings` (`clang`, `zig`, `dotnet`, `swift`, `moon`)

This repository now ships a `flake.nix` for that environment.
The generated flake comes from a thin `tnix` entrypoint in
[`../flake.tnix`](../flake.tnix), with the heavier outputs implementation kept
in plain Nix under [`../nix/flake-outputs.nix`](../nix/flake-outputs.nix) to
avoid current `tnix` limitations. A short summary of those constraints lives in
[`tnix_notes.md`](./tnix_notes.md).

The most reliable interactive path is:

```bash
nix develop
vp check
```

The most reliable one-shot reproduction command is:

```bash
nix develop -c sh -c 'vp check'
```

The same pattern works for the rest of the CI commands.

Examples:

```bash
nix develop -c sh -c 'vp run -w build'
nix develop -c sh -c 'vp run -w test'
nix develop -c sh -c 'vp run -w bench_verify'
```

Using `sh -c` instead of a login shell matters here.
It makes the tool resolution deterministic, especially for `go`, which would otherwise be shadowed by a preexisting shell profile on some machines.

## Reproducing the Full Workflow

This sequence mirrors the current CI most closely:

```bash
nix develop -c sh -c 'vp check'
nix develop -c sh -c 'cargo fmt --all --check'
nix develop -c sh -c 'cargo clippy --workspace --all-targets -- -D warnings'
nix develop -c sh -c 'vp run -w build'
nix develop -c sh -c 'vp run -w test'
nix develop -c sh -c 'vp run -w sync_ref'
nix develop -c sh -c 'vp run -w verify_ref'
nix develop -c sh -c 'vp run -w build_corsa'
cargo test -p corsa --test real_corsa_baseline --test real_corsa_regression
nix develop -c sh -c 'vp run -w bench_verify'
```

This Node `24` baseline matters because the repository now executes
TypeScript-authored automation scripts directly through `node --strip-types`.

## What Broke and Why

The CI work that made this path reliable fell into three buckets:

- JS and TS check-time correctness
- upstream Go toolchain correctness
- reproducible benchmark build behavior

## 1. `vp check` Failed Before the Node Wrapper Was Built

The first failure mode came from `corsa_oxlint`.

The original `tsconfig` path mapping for `@corsa-bind/napi` pointed at:

- `../corsa_node/dist/index.d.mts`

That works after the wrapper package has already been built.
It is the wrong dependency edge for `vp check`, because `vp check` is supposed to validate source state before build artifacts exist.

The fix was to map the package name to source instead:

- [`../src/bindings/nodejs/corsa_oxlint/tsconfig.json`](../src/bindings/nodejs/corsa_oxlint/tsconfig.json)

This makes `vp check` depend on the checked-in TypeScript source surface rather than on generated output.

That is an important distinction:

- `check` should validate source
- `build` should generate artifacts

If `check` depends on `dist/`, the repository can look broken even when the source is correct.

## 2. `corsa_oxlint` Had Drifted from the Current Type Shape

After module resolution was fixed, several TypeScript errors remained in `corsa_oxlint`.

The important ones were:

- `CorsaType` access patterns assuming an `id` path while the checker only knew a narrower local shape
- an unnecessary cast around `texts`
- a cached config path that could be inferred as `undefined`

These were corrected in:

- [`../src/bindings/nodejs/corsa_oxlint/ts/session.ts`](../src/bindings/nodejs/corsa_oxlint/ts/session.ts)
- [`../src/bindings/nodejs/corsa_oxlint/ts/rules/type_utils.ts`](../src/bindings/nodejs/corsa_oxlint/ts/rules/type_utils.ts)

The practical lesson is that `corsa_oxlint` is part compatibility layer and part consumer.
It needs to follow the real wrapper API shape closely, otherwise CI fails long before runtime tests do.

## 3. The Pinned Upstream Checkout Requires Go 1.26

The pinned upstream ref now declares:

- `go 1.26`

in:

- [`../ref/corsa-upstream/go.mod`](../ref/corsa-upstream/go.mod)

That means CI cannot rely on whatever `go` version happens to be preinstalled on a runner.
Without an explicit setup step, `vp run -w build_corsa` can fail even if the repository itself is otherwise correct.

The workflow now sets Go explicitly through:

- [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml)

using `actions/setup-go` and `go-version-file: ref/corsa-upstream/go.mod`.

This keeps the workflow aligned with the actual upstream requirement instead of duplicating a version string elsewhere.

## 4. `build_corsa` Needed a Repository-Local Build Cache

Once the Go version was correct, another issue appeared locally:

- `go build` tried to use a cache path outside the repository
- that cache path was not always writable in the execution environment

The fix was not to disable caching.
The correct fix was to make the cache explicit and local to the repository:

- [`../vite.config.ts`](../vite.config.ts)

`build_corsa` now creates `.cache/go-build` and passes an absolute `GOCACHE` path to `go build`.

That matters for two reasons:

- it avoids permission-dependent failures
- it makes the build behavior more reproducible across developer machines and CI runners

One subtle detail here is that `GOCACHE` must be absolute.
A relative path looks harmless but is rejected by the Go toolchain.

## 5. `verify_ref` Is Supposed to Be Strict

The `corsa_ref` checks are intentionally unforgiving.

They enforce that `ref/corsa-upstream` is:

- on the exact pinned commit
- detached at `HEAD`
- clean in tracked files

This is not overkill.
It is what makes real regression tests and performance claims auditable.

While reproducing CI locally, `verify_ref` briefly failed because a tracked file inside the managed ref had drifted:

- `ref/corsa-upstream/package-lock.json`

That drift came from local package-manager behavior, not from intended upstream changes.
The correct response was to restore the tracked file, not to weaken verification.

Ignored files such as these are fine:

- `ref/corsa-upstream/.cache/`
- `ref/corsa-upstream/node_modules/`
- generated `*.tsbuildinfo`

Tracked changes are not.

## 6. Benchmark Tasks Must Also Be Operationally Safe

This repository already treated process cleanup as a correctness property.
The CI pass validated that expectation under real benchmark execution too.

The benchmark path:

- rebuilt the real pinned Corsa
- regenerated `.cache/bench_native.json`
- regenerated `.cache/bench_ts.json`
- ran the benchmark guard tests

After the run, no leftover Corsa, `bench_real_corsa`, or related benchmark worker processes remained.

That matters because benchmark pipelines that leak processes are not just untidy.
They are measurement bugs waiting to happen.

## Design Intent Behind the Fixes

The changes were not random CI band-aids.
They reflect a few design rules.

## Source Checks Should Depend on Source, Not Generated Artifacts

This was the core reason to change `corsa_oxlint`'s path mapping.

If `vp check` depends on a generated declaration file, then the logical order becomes:

1. build
2. then check

That is backwards for CI.
Checks should be able to fail before build, because that is how they protect the source tree.

## Version Truth Should Come from the Upstream Ref

The CI workflow should not hardcode a Go version if the upstream ref already declares one.

Using `go-version-file` means:

- the lock is in one place
- CI follows upstream automatically when the pinned ref moves
- there is less room for silent drift

Because `ref/corsa-upstream` is a managed checkout, fresh CI jobs must run
`corsa_ref sync` before `actions/setup-go` can read `ref/corsa-upstream/go.mod`.

## Reproducibility Beats Convenience

Repo-local caches, explicit shell environments, and strict ref verification all make the workflow a little more opinionated.
That is intentional.

The goal is not to create the shortest possible happy path.
The goal is to make failures explainable and successes trustworthy.

## Files Involved

The most important files for this CI stabilization work are:

- [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml)
- [`../vite.config.ts`](../vite.config.ts)
- [`../src/bindings/nodejs/corsa_oxlint/tsconfig.json`](../src/bindings/nodejs/corsa_oxlint/tsconfig.json)
- [`../src/bindings/nodejs/corsa_oxlint/ts/session.ts`](../src/bindings/nodejs/corsa_oxlint/ts/session.ts)
- [`../src/bindings/nodejs/corsa_oxlint/ts/rules/type_utils.ts`](../src/bindings/nodejs/corsa_oxlint/ts/rules/type_utils.ts)
- [`../ref/corsa-upstream/go.mod`](../ref/corsa-upstream/go.mod)

## Branch Protection Readiness

Production releases assume that `main` represents reviewed, fully validated
state. Configure branch protection so direct pushes are blocked and pull
requests cannot merge until the current CI surface is green.

Required status checks for `main` should include:

- `Quality (blacksmith-32vcpu-ubuntu-2404)`
- `Quality (macos-latest)`
- `Quality (windows-latest)`
- `Real Corsa Smoke (blacksmith-32vcpu-ubuntu-2404)`
- `Real Corsa Smoke (macos-latest)`
- `Real Corsa Smoke (windows-latest)`
- `Corsa Ref Bench`
- `Cargo Deny`
- `Release Dry Run`

Enable merge queue once the repository starts accepting concurrent feature PRs
or release-prep PRs from more than one maintainer. The queue should use the same
required checks as normal pull requests so release tags are cut only from a
post-merge commit that has been validated in final `main` order.

The `release` environment should require maintainer approval for workflows that
publish public artifacts:

- [`publish-rust.yml`](../.github/workflows/publish-rust.yml)
- [`publish-npm.yml`](../.github/workflows/publish-npm.yml)
- [`github-release.yml`](../.github/workflows/github-release.yml)

Keep temporary bootstrap secrets scoped to that environment, and remove them
after trusted publishing is configured for crates.io and npm.

OpenSSF Scorecard is handled by
[`scorecard.yml`](../.github/workflows/scorecard.yml) as scheduled monitoring,
not as a required merge check. Keep it runnable manually after changing
repository security settings, but avoid adding it to branch protection unless the
team explicitly wants release flow to wait on repository-wide posture scans.

## Troubleshooting

## `vp check` says `@corsa-bind/napi` cannot be found

Check whether `corsa_oxlint` is resolving the package to source or to `dist/`.
For source validation, it should resolve to the source TypeScript entrypoint, not to generated declarations.

## `build_corsa` fails with a Go version error

Check:

- `go version`
- whether the shell actually exposes Go 1.26
- whether CI is using `actions/setup-go` with `ref/corsa-upstream/go.mod`

If a login shell is overriding the toolchain, prefer the `nix develop -c sh -c '...'` pattern.

## `build_corsa` fails with a cache permission error

Check whether `GOCACHE` is:

- set explicitly
- absolute
- inside a writable path

This repository now uses `.cache/go-build` under the workspace for that reason.

## `verify_ref` fails even though `sync_ref` just ran

Look specifically for tracked file drift inside `ref/corsa-upstream`:

```bash
git -C ref/corsa-upstream status --short
git -C ref/corsa-upstream diff --stat
```

Ignored files are usually not the problem.
Tracked files are.

## `bench_verify` takes a while and looks stuck

That is normal as long as it is still progressing through:

- Node benches
- native benches
- report guard tests

The slowest part is usually rebuilding or rerunning the real pinned upstream binary and then collecting benchmark samples.

## Practical Tips

- Run CI repro commands in a non-login shell when you need deterministic tool resolution.
- Treat `ref/corsa-upstream` as managed state, not as a normal workspace directory.
- Keep generated outputs out of source-time type checking.
- Use repo-local caches when external cache directories may be sandboxed or permission-sensitive.
- If benchmark jobs pass but leave child processes behind, treat that as a bug, not as cleanup debt.

## Related Documents

- [README.md](../README.md)
- [performance.md](./performance.md)
- [benchmarking_guide.md](./benchmarking_guide.md)
- [corsa_upstream_dependency.md](./corsa_upstream_dependency.md)
