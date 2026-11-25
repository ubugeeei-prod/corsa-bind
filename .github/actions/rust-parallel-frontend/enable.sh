#!/usr/bin/env bash
set -euo pipefail
[[ "$CORSA_RUSTC_FRONTEND_JOBS" =~ ^[1-9][0-9]*$ ]]
wrapper="$GITHUB_WORKSPACE/scripts/rustc_wrapper.sh"
# A job that set its own wrapper, or checked out a tree without this one,
# keeps its compiler invocation unchanged.
if [[ -z "${RUSTC_WRAPPER:-}" && -x "$wrapper" ]]; then
  {
    printf 'RUSTC_WRAPPER=%s\n' "$wrapper"
    printf 'CORSA_RUSTC_FRONTEND_JOBS=%s\n' "$CORSA_RUSTC_FRONTEND_JOBS"
  } >> "$GITHUB_ENV"
fi
