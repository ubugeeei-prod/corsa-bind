#!/bin/sh
# Cargo's rustc wrapper (RUSTC_WRAPPER) for the Nix dev shell and the Rust CI
# jobs. See "Rust build accelerators" in docs/ci_guide.md.
#
# Cargo runs: rustc_wrapper.sh <rustc or clippy-driver> [rustc] <arguments>
#
# - Workspace crates compile with rustc's parallel frontend. Only a crate whose
#   manifest is inside this checkout and whose --crate-name is the one Cargo is
#   building qualifies: dependencies and build-script probes compile exactly as
#   Cargo asked, so RUSTC_BOOTSTRAP never flips a dependency's nightly probe.
#   `-Zthreads` is used because the dev shell's compiler predates its
#   `--jobs-frontend` spelling; current stable accepts both.
# - With CORSA_KACHE set, every call goes through kache, which shares compiled
#   crates across worktrees and target directories on the machine.
case "${CORSA_RUSTC_FRONTEND_JOBS:-1}" in
  '' | 0 | 1) ;;
  *)
    workspace="${0%/scripts/rustc_wrapper.sh}"
    case "${CARGO_MANIFEST_DIR:-}" in
      "$workspace"/*)
        previous=
        for argument in "$@"; do
          if [ "$previous" = --crate-name ]; then
            if [ "$argument" = "${CARGO_CRATE_NAME:-}" ]; then
              RUSTC_BOOTSTRAP="$argument"
              export RUSTC_BOOTSTRAP
              set -- "$@" "-Zthreads=$CORSA_RUSTC_FRONTEND_JOBS"
            fi
            break
          fi
          previous="$argument"
        done
        ;;
    esac
    ;;
esac
if [ -n "${CORSA_KACHE:-}" ]; then
  exec "$CORSA_KACHE" "$@"
fi
exec "$@"
