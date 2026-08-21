# Corsa Upstream Dependency Management

Corsa upstream is managed as a pinned git dependency via [corsa_ref.lock.toml](../corsa_ref.lock.toml).

Core policy:

- `corsa-bind` follows upstream-supported Corsa integration points.
- `corsa-bind` does not maintain a fork of Corsa upstream.
- `corsa-bind` does not patch Corsa upstream.
- Upstream changes are adopted by updating the pinned commit and adapting our bindings around that exact revision.

Rules:

- The authoritative upstream is `ref/corsa-upstream`.
- The repository is `https://github.com/microsoft/TypeScript.git`; the native
  Go module lives under `ref/corsa-upstream/tsc`.
- The lock file records repository, exact commit hash, tree hash, committer timestamp, author, and subject.
- `ref/corsa-upstream` must remain on a detached `HEAD` at the exact locked commit.
- A dirty worktree fails verification.
- `sync` refuses to touch an existing checkout when the configured remote does not match the locked upstream.

Workflow:

1. `cargo run -p corsa_ref -- sync`
2. `cargo run -p corsa_ref -- verify`
3. When intentionally updating upstream, move `ref/corsa-upstream` to the new commit and run `cargo run -p corsa_ref -- pin-current`

This keeps reproduction commit-exact and leaves an auditable metadata trail for every upstream bump.

If an existing local checkout still points at the retired
`microsoft/typescript-go` repository, remove `ref/corsa-upstream` or update its
`origin` remote to `https://github.com/microsoft/TypeScript.git` before running
`sync`. Fresh CI checkouts clone the locked repository directly.
