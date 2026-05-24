# @corsa-bind/napi

`@corsa-bind/napi` exposes the `corsa` Rust workspace to Node.js, Deno, and
Bun through `napi-rs`.

## Install

```bash
npm i @corsa-bind/napi
```

The published root package stays JS-only and pulls in the matching native
binary through platform-specific optional dependencies.

Deno consumers should use npm package resolution with a local `node_modules`
directory and grant native addon access:

```bash
deno run --node-modules-dir=auto --allow-ffi --allow-read --allow-env --allow-run ./main.ts
```

Bun consumers can install and import the npm package directly:

```bash
bun add @corsa-bind/napi
bun run ./main.ts
```

## What it ships

- native JS bindings for the `corsa` API and LSP surface
- an ESM TypeScript wrapper under `dist/`
- no bundled `typescript-go` executable

## Runtime requirement

You must provide a compatible `typescript-go` (`tsgo`) executable yourself and
pass its path through `TsgoApiClient.spawn({ executable: "/path/to/tsgo" })`.

## API style

The wrapper exposes Promise-based methods such as `spawnAsync`,
`initializeAsync`, `updateSnapshotAsync`, `callJsonAsync`, `callBinaryAsync`,
and `closeAsync` for production Node services and editor integrations. The
older synchronous methods remain available for short scripts and latency-bounded
tooling, but they run on the JavaScript call path.

## Development

```bash
vp install
vp run -w build_wrapper
vp test run --config ./vite.config.ts src/bindings/nodejs/corsa_node/ts/**/*.test.ts
```

Repository-level executable examples live under [`examples/`](../../examples/README.md),
including mock-client, virtual-document, distributed-orchestrator, and
real-`tsgo` snapshot samples.
