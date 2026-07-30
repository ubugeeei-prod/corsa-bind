---
title: Node.js binding
description: Use @corsa-bind/napi from Node.js, Deno, and Bun — spawn options, sync vs. async, virtual documents, checker queries, and the raw call escape hatches.
---

# Node.js Binding (`@corsa-bind/napi`)

`@corsa-bind/napi` exposes the `corsa` Rust workspace to JavaScript runtimes
through `napi-rs`. The performance-critical work stays in Rust; the package
gives you an ergonomic, Promise-friendly TypeScript surface on top.

This guide covers the public API. For the authoring model of type-aware lint
rules built on the same Rust core, see the [Oxlint guide](./oxlint_guide.md).

## Install

```bash
npm i @corsa-bind/napi
```

The published root package is JS-only and pulls in the matching native binary
through platform-specific optional dependencies. Supported runtimes:

| Runtime | Minimum version |
| ------- | --------------- |
| Node.js | `22+`           |
| Deno    | `2.0+`          |
| Bun     | `1.2+`          |

Deno needs npm resolution with a local `node_modules` directory and native
addon permissions:

```bash
deno run --node-modules-dir=auto --allow-ffi --allow-read --allow-env --allow-run ./main.ts
```

Bun installs and imports the package directly:

```bash
bun add @corsa-bind/napi
bun run ./main.ts
```

> [!IMPORTANT]
> The package never bundles a Corsa executable. You must provide a compatible
> binary yourself and pass its path through `CorsaApiClient.spawn({ executable })`.
> During local development the repo-local mock binary
> (`vp run -w build_mock`) is enough for most flows.

## Sync vs. async

Every client method ships in two forms:

- **`*Async` (Promise-based)** — the right choice for production Node services
  and editor integrations. Work runs off the JavaScript call path.
- **synchronous** — convenient for short scripts and latency-bounded tooling,
  but it runs on the JS call path and will block the event loop.

The examples below use the synchronous form for brevity; prepend `Async` and
`await` for the non-blocking variant.

## Spawning an API client

`CorsaApiClient.spawn(options)` starts a Corsa process and returns a client.

```ts
import { CorsaApiClient } from "@corsa-bind/napi";

const client = CorsaApiClient.spawn({
  executable: "/path/to/corsa",
  cwd: process.cwd(),
  mode: "msgpack",
});
```

### `ApiClientOptions`

| Field                        | Type                     | Default      | Notes                                                          |
| ---------------------------- | ------------------------ | ------------ | -------------------------------------------------------------- |
| `executable`                 | `string`                 | _(required)_ | Path to the Corsa binary you provide.                          |
| `cwd`                        | `string`                 | process cwd  | Working directory the checker resolves projects against.       |
| `mode`                       | `"jsonrpc" \| "msgpack"` | `"msgpack"`  | Transport. `msgpack` is fastest on the pinned upstream commit. |
| `requestTimeoutMs`           | `number`                 | `30000`      | Per-request timeout.                                           |
| `shutdownTimeoutMs`          | `number`                 | `2000`       | Graceful shutdown budget on `close()`.                         |
| `outboundCapacity`           | `number`                 | `256`        | Outbound request queue capacity.                               |
| `allowUnstableUpstreamCalls` | `boolean`                | `false`      | Opt in to unstable upstream endpoints such as `printNode`.     |

Always pair a `spawn()` with a `close()` (use `try`/`finally`):

```ts
try {
  client.initialize();
  // ... work ...
} finally {
  client.close();
}
```

## A complete checker roundtrip

```ts
import { CorsaApiClient } from "@corsa-bind/napi";

const client = CorsaApiClient.spawn({ executable: process.env.CORSA_BIN!, mode: "jsonrpc" });

let snapshotHandle: string | undefined;
try {
  const init = client.initialize();

  const snapshot = client.updateSnapshot({ openProject: "./tsconfig.json" });
  snapshotHandle = snapshot.snapshot;
  const project = snapshot.projects[0];
  if (!project) throw new Error("no project resolved");

  // Read a source file as it sees it.
  const sourceFile = client.getSourceFile(snapshot.snapshot, project.id, "./src/index.ts");
  console.log(Buffer.from(sourceFile ?? []).toString("utf8"));

  // Query a type and stringify it.
  const stringType = client.getStringType(snapshot.snapshot, project.id);
  console.log(client.typeToString(snapshot.snapshot, project.id, stringType.id));

  console.log("checker cwd:", init.currentDirectory);
} finally {
  if (snapshotHandle) client.releaseHandle(snapshotHandle);
  client.close();
}
```

### Snapshots and handles

`updateSnapshot()` returns a `snapshot` handle plus the resolved `projects`.
Most query methods take `(snapshot, projectId, …)`. Handles are owned by the
Rust side — release them with `releaseHandle(handle)` when you are done, and
always `close()` the client.

`updateSnapshot()` accepts:

- `openProject` — a `tsconfig.json` to open
- `fileChanges` — on-disk file change notifications
- `overlayChanges` — in-memory overlay edits

## Query methods

All of these have `*Async` counterparts.

| Method                                                   | Returns                                        |
| -------------------------------------------------------- | ---------------------------------------------- |
| `initialize()`                                           | `InitializeResponse` (e.g. `currentDirectory`) |
| `parseConfigFile(file)`                                  | `ConfigResponse`                               |
| `updateSnapshot(params?)`                                | `{ snapshot, projects }`                       |
| `getSourceFile(snapshot, project, file)`                 | `Buffer \| null`                               |
| `getStringType(snapshot, project)`                       | `TypeResponse`                                 |
| `getTypeAtPosition(snapshot, project, file, position)`   | `TypeResponse \| null`                         |
| `getSymbolAtPosition(snapshot, project, file, position)` | symbol response                                |
| `getTypeArguments(snapshot, project, type)`              | type list                                      |
| `getTypeOfSymbol(snapshot, project, symbol)`             | `TypeResponse \| null`                         |
| `getDeclaredTypeOfSymbol(snapshot, project, symbol)`     | `TypeResponse \| null`                         |
| `typeToString(snapshot, project, type)`                  | `string`                                       |

For endpoints without a typed wrapper, drop down to the raw calls below.

## Raw calls (escape hatch)

When you need an endpoint that does not have a dedicated method, call it
directly. `callJson` is the readable path; `callBinary` returns the raw msgpack
payload for hot loops.

```ts
const result = client.callBinary("getSomethingCustom", { snapshot, project: project.id });
```

`callJson`/`callBinary` are how the advanced `checker_queries` and `raw_calls`
examples reach symbol, signature, and relation endpoints.

> [!NOTE]
> `printNode` and other unstable upstream endpoints are disabled unless you
> pass `allowUnstableUpstreamCalls: true`. The pinned Corsa commit can panic in
> `internal/printer` on real project data — opt in only when you accept that.

## Virtual documents

`CorsaVirtualDocument` edits in-memory documents without any Corsa process.
This is the fastest way to prototype rules and editor flows.

```ts
import { CorsaVirtualDocument } from "@corsa-bind/napi";

const document = CorsaVirtualDocument.untitled(
  "/virtual/example.ts",
  "typescript",
  "const answer = 41;\n",
);

document.applyChanges([
  {
    range: { start: { line: 0, character: 15 }, end: { line: 0, character: 17 } },
    text: "42",
  },
]);

console.log(document.state()); // { uri, languageId, version, text }
```

- `CorsaVirtualDocument.untitled(path, languageId, text)` — untitled document
- `CorsaVirtualDocument.inMemory(authority, path, languageId, text)` — authority-scoped document
- `document.replace(text)` — full-text replace
- `document.applyChanges(changes)` — incremental LSP-style edits
- `document.state()` — current `{ uri, languageId, version, text }`

A `VirtualChange` with a `range` splices that range; omit the `range` to replace
the whole document.

## Type helpers and `Utils`

The binding re-exports the Rust-backed type-text helpers used by the lint layer.
They work on type-text strings (e.g. `"Promise<any>"`) with no checker process:

```ts
import { isUnsafeAssignment, isUnsafeReturn, classifyTypeText, Utils } from "@corsa-bind/napi";

isUnsafeAssignment({ sourceTypeTexts: ["Set<any>"], targetTypeTexts: ["Set<string>"] }); // true
isUnsafeReturn({ sourceTypeTexts: ["Promise<any>"], targetTypeTexts: ["Promise<string>"] });
classifyTypeText("string[]");
```

`Utils` groups the predicate family: `isStringLikeTypeTexts`,
`isNumberLikeTypeTexts`, `isPromiseLikeTypeTexts`, `splitTopLevelTypeText`,
`splitTypeText`, and friends. The native lint entry points
(`runNativeLintRule`, `nativeLintRuleMetas`) are also exported here and are
what `corsa-oxlint` builds on.

## LSP and distributed orchestration

- The Rust crate `corsa_lsp` provides full LSP client support with virtual
  document overlays; the Node binding surfaces the document primitives shown
  above. See the Rust `lsp_overlay` example for the `didOpen`/`didChange`/
  `didClose` flow.
- `CorsaDistributedOrchestrator` exposes the experimental replicated-state API
  (`campaign`, `leaderId`, `openVirtualDocument`, `changeVirtualDocument`). This
  is behind the experimental distributed work — see
  [Support policy](./support_policy.md) for its scope.

## Development

Build and test the binding from the workspace:

```bash
vp install
vp run -w build_wrapper
vp test run --config ./vite.config.ts src/bindings/nodejs/corsa_node/ts/**/*.test.ts
```

Benchmarks for the Node binding:

```bash
vp run -w bench_ts
```

## See also

- [Getting started](./getting_started.md) — first program in Node and Rust
- [Oxlint guide](./oxlint_guide.md) — type-aware rules on the same Rust core
- [Performance](./performance.md) — transport measurements and benchmark entry points
- [Examples](https://github.com/ubugeeei/corsa-bind/tree/main/examples) — runnable Node samples
