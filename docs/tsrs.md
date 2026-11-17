---
title: Using tsrs
description: Run corsa-bind on tsrs, the Rust port of the TypeScript 7 checker, through the same stdio API and LSP.
---

# Using tsrs

[tsrs](https://github.com/oxc-project/tsrs) is a Rust port of the TypeScript 7
type checker. It serves the same `--api` stdio protocol and `--lsp` server as
TypeScript's native binary, so `corsa-bind` drives it with no code changes:
point any binding at the tsrs binary instead of `tsc`.

tsrs releases track a TypeScript version (`7.1.0-beta.tsrs2` targets the
TypeScript 7.1 beta), and the client talks to it on the
[`derived-snapshots` wire dialect](./corsa_upstream_dependency.md#wire-dialects),
like the TypeScript 7.1 beta itself. CI runs the real-runtime regression,
typecheck and dialect suites against the `tsrs` version pinned in the root
`package.json` (`vp run -w test_tsrs_runtime`).

## Install and locate the binary

```bash
pnpm add -D tsrs@next
```

The `tsrs` package installs its native binary through a per-platform optional
dependency, `@tsrs/<platform>-<arch>` (with a `-gnu` or `-musl` suffix on
Linux). Spawn that binary directly:

```text
node_modules/@tsrs/darwin-arm64/tsrs
node_modules/@tsrs/linux-x64-gnu/tsrs
node_modules/@tsrs/win32-x64/tsrs.exe
```

`node_modules/.bin/tsrs` is a Node launcher that execs the same binary; it works,
but every spawn then pays Node's startup.

> [!IMPORTANT]
> The npm binary loads `lib.*.d.ts` from the directory it lives in and has no
> embedded copy. Use it in place or through a symlink. If you copy the binary
> elsewhere, point `TSRS_LIB_PATH` at the original package directory, or it
> panics at startup and every request fails with "process is closed".

## Rust

```rust
use corsa::{
    api::{ApiClient, ApiSpawnConfig},
    runtime::block_on,
};

fn main() -> Result<(), corsa::CorsaError> {
    block_on(async {
        let client =
            ApiClient::spawn(ApiSpawnConfig::new("node_modules/@tsrs/darwin-arm64/tsrs")).await?;
        let capabilities = client.describe_capabilities().await?;
        assert_eq!(capabilities.runtime.kind.as_deref(), Some("tsrs"));
        client.close().await?;
        Ok(())
    })
}
```

`LspSpawnConfig::new` takes the same path for the language server. A binary
named `tsrs` (or `tsrs.exe`) is reported as runtime kind `tsrs`, with the same
LSP capabilities as TypeScript's binary.

## Node.js

```ts
import { CorsaApiClient } from "@corsa-bind/napi";

const client = CorsaApiClient.spawn({
  executable: "node_modules/@tsrs/darwin-arm64/tsrs",
  cwd: process.cwd(),
  mode: "msgpack",
});
```

## corsa-oxlint

Without `parserOptions.corsa.executable` or `CORSA_EXECUTABLE`, `corsa-oxlint`
discovers the runtime from the workspace's `node_modules`:

1. `typescript` 7 or newer
2. `tsrs`
3. `.cache/corsa`

A workspace that installs only `tsrs` therefore needs no configuration. When
both packages are installed, TypeScript's own binary wins; prefer tsrs with
`runtime`:

```js
settings: {
  corsaOxlint: {
    parserOptions: {
      project: ["./tsconfig.json"],
      corsa: { runtime: "tsrs" },
    },
  },
},
```

`runtime: "tsrs"` fails with an install hint when tsrs is missing, instead of
falling back to another runtime. `runtime: "typescript"` never picks tsrs.

## Differences to know

These come from tsrs's own [compatibility](https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md)
and [defaults](https://github.com/oxc-project/tsrs/blob/main/docs/DEFAULTS.md)
documents. Check them for the version you install.

- **Fast mode is inherited.** `--api` and `--lsp` processes read `TSRS_FAST`. With
  `TSRS_FAST=1` they use lazy members and canonical checker history, which can
  change history- or depth-sensitive diagnostics. Leave it unset when results
  must match `tsc`.
- **Content mappers** work with `runExternalCode`, exactly as on TypeScript's
  binary (see [Content mappers](./content_mappers.md)).
- **Profiling requests** (`startCPUProfile`, `stopCPUProfile`,
  `saveHeapProfile`) are not implemented and answer "unsupported". The typed
  `corsa-bind` API never sends them; raw calls see the error.
- **Build orchestration** through the API runs programs single-threaded, so
  `builders` and checker parallelism do not speed up API builds.
- **Language server**: automatic type acquisition, profiling, and localized
  messages are not ported.
- **Version checks**: `--version` prints the TypeScript version it targets
  (`7.1.0-beta`) followed by the tsrs version, so code that gates on the
  TypeScript version treats it as that TypeScript release.
