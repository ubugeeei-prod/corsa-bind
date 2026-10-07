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

## Wire Dialects

Upstream does not version its stdio API, and it reshapes it between TypeScript
releases. The pin follows upstream `main`; consumers run whatever `typescript`
they installed. Those are routinely different generations of the protocol, so
the client detects which one it is talking to and adapts it, instead of making
every consumer follow each move. This is the charter's rule 1 applied to the
wire: `corsa-bind` pays the upgrade once.

| Dialect             | Runtime                           | What defines it                                                                                                                                    |
| ------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-snapshots` | TypeScript 7.0                    | one implicit snapshot lineage per connection; symbols are bare numeric ids                                                                         |
| `derived-snapshots` | TypeScript 7.1 development builds | `createSnapshot` plus `updateSnapshot` from an explicit base; symbols are references owned by a source file or a snapshot; tagged callback results |

The dialect is read off the `initialize` response, which is the first thing a
runtime says: 7.0 reports `useCaseSensitiveFileNames`, 7.1 reports
`caseSensitivity`. `ApiClient::dialect()` returns it.

What the client keeps identical across dialects:

| Public behavior                                                         | On `derived-snapshots`                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InitializeResponse.use_case_sensitive_file_names`                      | derived from `caseSensitivity`                                                                                                                                                                                          |
| `update_snapshot` accumulates opened projects and reported file changes | the client keeps the latest snapshot as the base of the next update, asks the runtime to rebuild the programs a file change dirtied, and carries the full project list forward (an update only reports what it changed) |
| `ManagedSnapshot` releases its handle on drop or `release()`            | the handle is shared with that base, so it is released once neither needs it                                                                                                                                            |
| `SymbolHandle` is one opaque string per symbol                          | the handle is the compact reference; the client completes it with the owning file's descriptor, or the request's project, when it is sent back                                                                          |
| `ApiFileSystem` callbacks                                               | answers are encoded as `{ kind, value }`                                                                                                                                                                                |

Two things are deliberately _not_ adapted:

- **A mention is still only a mention.** A symbol id embedded in another
  response — a type's `symbol`, a signature's `parameters` — resolves on 7.0 only
  once the runtime has handed that symbol out in full. On 7.1 it resolves once
  its owner is known the same way. The client does not issue hidden requests to
  paper over the difference; `get_symbol_of_type`, `get_parameters_of_signature`,
  and their siblings are how a caller asks for the symbol itself, on both
  dialects. A premature use fails as a stale handle either way
  (`ApiClient::is_stale_handle_error`).
- **Raw endpoints stay raw.** `raw_json_request` / `callJson` send params in
  the shape the connected runtime expects. Symbol handles are still translated
  in both directions, so handles from typed and raw calls mix freely, but a
  7.0-shaped `updateSnapshot` sent to a 7.1 runtime fails the way upstream fails
  it.

The contract is held by the same assertions on both sides:
`tests/real_corsa_dialect.rs` runs against the pinned build and, through
`vp run -w test_released_runtime`, against the `typescript` release on npm;
`tests/api_dialect.rs` runs against the mock's stateful emulation of
`derived-snapshots`, which rejects what the real runtime rejects, so the
adaptation is also covered where no Corsa binary exists.

When a dialect's runtime leaves support, its branch is deleted, not kept.
