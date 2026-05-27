# Release Guide

This document is the operational release guide for `corsa`.

## Distribution Decisions

Public Rust crates:

- `corsa_core`
- `corsa_runtime`
- `corsa_jsonrpc`
- `corsa_client`
- `corsa_lsp`
- `corsa_orchestrator`
- `corsa`

Internal Rust crates:

- `corsa_ref`
- `corsa_node`

Public npm packages:

- `@corsa-bind/napi` (`src/bindings/nodejs/corsa_node`)
- `corsa-oxlint` (`src/bindings/nodejs/corsa_oxlint`)

The npm packages do not bundle the Corsa executable. Consumers must
point them at a compatible Corsa binary at runtime.

`@corsa-bind/napi` is built with `napi-rs`. The publish workflow now ships
the root package plus target-specific native binary packages for:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64-gnu`
- `linux-arm64-musl`
- `linux-x64-gnu`
- `linux-x64-musl`
- `win32-arm64-msvc`
- `win32-x64-msvc`

That native build matrix is derived from
[`src/bindings/nodejs/corsa_node/package.json`](../src/bindings/nodejs/corsa_node/package.json)
via its `napi.triples` config, so target changes should start there rather than
by editing the workflow matrix directly.

Trusted publishing must be configured for each of those target-specific native
packages as well as the `@corsa-bind/napi` root package.

The root package stays JS-only at publish time and resolves the correct native
binding through optional dependencies.

## Rust Publish Order

Publish crates in dependency order:

1. `corsa_core`
2. `corsa_runtime`
3. `corsa_jsonrpc`
4. `corsa_client`
5. `corsa_lsp`
6. `corsa_orchestrator`
7. `corsa`

## npm Publish Order

Publish npm packages in dependency order:

1. `@corsa-bind/napi-win32-x64-msvc`
2. `@corsa-bind/napi-win32-arm64-msvc`
3. `@corsa-bind/napi-darwin-x64`
4. `@corsa-bind/napi-darwin-arm64`
5. `@corsa-bind/napi-linux-x64-gnu`
6. `@corsa-bind/napi-linux-x64-musl`
7. `@corsa-bind/napi-linux-arm64-gnu`
8. `@corsa-bind/napi-linux-arm64-musl`
9. `@corsa-bind/napi`
10. `corsa-oxlint`

## Tag Release Flow

After the initial bootstrap is done, the normal release path is:

```bash
git switch main
git pull --ff-only
vp run -w release minor
```

`vp run -w release <patch|minor|major>` now:

- requires a clean checkout
- expects `main` by default
- bumps every Rust and npm package version together
- runs only a lightweight local preflight by default
- creates `release: vX.Y.Z`
- creates an annotated `vX.Y.Z` tag
- pushes the branch and the tag

Pushing the tag triggers both publish workflows. Rust and npm publish from the
tagged commit through GitHub Actions trusted publishing.
The heavier release gates run in GitHub Actions after the tag is pushed. Use
`vp run -w release <patch|minor|major> --full-gates` only when you explicitly
want to rerun the full gate set locally before tagging.
After both publish workflows complete successfully, the `GitHub Release`
workflow creates a GitHub Release for the tag with generated release notes.

## Dry Run

Local dry run:

```bash
vp run -w release_dry_run
```

This performs:

- `cargo package` for every public Rust crate
- a temporary workspace patch overlay so interdependent unpublished crates can be packaged before the first crates.io release
- staging of the JS-only `@corsa-bind/napi` root package plus any locally available native binary packages
- `pnpm pack` for each publishable npm package so `workspace:*` ranges are rewritten exactly as they will be for publish
- `npm publish --dry-run <tarball>` for the packed npm tarballs

CI also runs the same release dry-run workflow.

## Release Checks

The local release command runs:

- `vp check`
- `cargo fmt --all --check`

The tag-triggered GitHub Actions release gates run the heavier checks before
publishing:

Before publishing Rust crates:

- `vp check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `vp run -w test`
- `vp run -w verify_ref`
- `vp run -w bench_verify`
- `cargo deny check advisories bans licenses sources`
- `vp run -w release_dry_run`

Before publishing npm packages, run the same gates plus a fresh `vp run -w build`.
The GitHub publish workflow fan-outs native binding builds per target, downloads
those `.node` artifacts into the publish job, and only then publishes the root
package and `corsa-oxlint`.

## Trusted Publishing

### crates.io

After the first manual release of each public crate, configure crates.io Trusted
Publishing to trust this repository and the [`publish-rust.yml`](../.github/workflows/publish-rust.yml)
workflow.

The workflow uses GitHub OIDC plus `rust-lang/crates-io-auth-action@v1`, so no
long-lived `CARGO_REGISTRY_TOKEN` secret is required after the initial release.

### npm

After the first manual publish of each npm package, configure npm Trusted
Publishing for each package with:

- GitHub organization or user: `ubugeeei`
- repository: `corsa-bind`
- workflow filename: `publish-npm.yml`
- environment: `release`

Configure the same trusted publisher on:

- `corsa-oxlint`
- `@corsa-bind/napi`
- `@corsa-bind/napi-darwin-arm64`
- `@corsa-bind/napi-darwin-x64`
- `@corsa-bind/napi-linux-arm64-gnu`
- `@corsa-bind/napi-linux-arm64-musl`
- `@corsa-bind/napi-linux-x64-gnu`
- `@corsa-bind/napi-linux-x64-musl`
- `@corsa-bind/napi-win32-arm64-msvc`
- `@corsa-bind/napi-win32-x64-msvc`

The npm workflow pins Node `24`, which satisfies npm's Trusted Publishing
minimum (`Node >= 22.14.0`, `npm >= 11.5.1`).

Once npm Trusted Publishing is working, update each package's npm settings to
`Require two-factor authentication and disallow tokens`.

## First Manual Publish

Both registries require an initial manual publish before OIDC-only trusted
publishing can take over.

The repository now supports doing this bootstrap from CI with temporary tokens.
That keeps the first publish reproducible and still avoids local multi-platform
artifact assembly.

### 1. Add Temporary Bootstrap Secrets

Create these temporary secrets in the GitHub `release` environment:

- `CRATES_IO_TOKEN`
- `NPM_TOKEN`

These are only for the first bootstrap publish. Remove them after trusted
publishing is configured and verified.

### 2. Bootstrap Rust from CI

```bash
GitHub Actions -> Publish Rust -> Run workflow
confirm=publish-rust
auth_mode=token
```

This publishes the public crates in dependency order from CI using the same
script as the trusted path, but authenticates with `CRATES_IO_TOKEN` once.

### 3. Bootstrap npm from CI

```bash
GitHub Actions -> Publish npm -> Run workflow
confirm=publish-npm
auth_mode=token
```

This manual CI run still builds every supported native artifact through the
matrix, then publishes the binary packages first, the JS-only `@corsa-bind/napi`
root package second, and `corsa-oxlint` last.

### 4. Attach the Trusted Publishers

Once the packages exist, configure the trusted publishers:

- crates.io: trust this repository and [`publish-rust.yml`](../.github/workflows/publish-rust.yml)
- npm: run the setup helper below, or use the npm package settings UI

```bash
vp exec node --strip-types ./scripts/setup_npm_trusted_publish.ts --dry-run
vp exec node --strip-types ./scripts/setup_npm_trusted_publish.ts
```

The npm trusted publisher must match:

- GitHub organization or user: `ubugeeei`
- repository: `corsa-bind`
- workflow filename: `publish-npm.yml`
- environment: `release`

### 5. Remove the Bootstrap Tokens

After both trusted publish paths are confirmed working:

- remove `CRATES_IO_TOKEN`
- remove `NPM_TOKEN`
- keep using tag-triggered CI publishes only

### 6. Normal Releases After Bootstrap

After that first bootstrap, releases become:

```bash
git switch main
git pull --ff-only
vp run -w release patch
```

If a bootstrap publish partially succeeds, rerun from the first missing target:

```bash
CARGO_PUBLISH_START_AT=corsa node --strip-types ./scripts/publish_rust.ts
NPM_PUBLISH_START_AT=corsa-oxlint NAPI_ARTIFACTS_DIR=./artifacts node --strip-types ./scripts/publish_npm.ts
```

## Changelog Expectations

Each public release should ship with GitHub release notes that call out:

- changed public crates
- any experimental-surface changes
- breaking changes or required upgrades
- benchmark or regression notes when performance-sensitive behavior changed

## Automation

Workflows:

- `CI`: quality, experimental-surface validation, real-Corsa smoke, and benchmark verification
- `Release Dry Run`: validates publishable artifacts without publishing them
- `Publish Rust`: tag-triggered trusted publish path, plus one-time token bootstrap mode
- `Publish npm`: tag-triggered trusted publish path, plus one-time token bootstrap mode
- `GitHub Release`: waits for both tag-triggered publish workflows and creates generated release notes
- `Supply Chain`: runs dependency policy checks

The publish workflows are intentionally separate from the dry run so that
artifact validation stays cheap and safe on pull requests.

For dependency-policy and advisory handling, see [./supply_chain_policy.md](./supply_chain_policy.md).
