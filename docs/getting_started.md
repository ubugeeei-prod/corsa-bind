---
title: Getting started
description: Install the toolchain and run your first corsa-bind program from Rust, Node.js, and the type-aware Oxlint framework.
---

# Getting Started

This guide takes you from a clean checkout to a working `corsa-bind` program.
It covers three entry points:

- the **Rust facade** crate (`corsa`)
- the **Node.js binding** (`@corsa-bind/napi`)
- the **type-aware Oxlint** framework (`corsa-oxlint`)

You can complete the first two sections without building the real Corsa
upstream binary. The [Real pinned Corsa](#run-against-the-real-pinned-corsa)
section shows how to wire in the actual checker when you want end-to-end
behavior.

For the bigger picture and design rationale, read the
[Architecture guide](./project_guide.md). For everything that ships as runnable
code, see the [examples workspace](https://github.com/ubugeeei/corsa-bind/tree/main/examples).

## 1. Set up the toolchain

`corsa-bind` is a multi-language workspace. The Nix dev shell provides every
toolchain used by the Rust crates, the Node binding, and the
[language bindings](./language_bindings.md):

```bash
nix develop
vp install
```

`vp` is [Vite+](https://vite.plus); it manages Node `24`, pnpm, `oxfmt`, and
`oxlint` for the JS side. The Nix shell is authored in `flake.tnix` and compiled
to `flake.nix` with `tnix`.

Build the whole workspace once so the native binding and mock server exist:

```bash
vp run -w build
```

This produces, among other things:

- the Rust workspace crates
- the `@corsa-bind/napi` native addon and its TypeScript wrapper
- the repo-local **mock Corsa binary** used by examples and tests

> [!TIP]
> The mock binary lets you exercise realistic API and LSP flows without
> building the real upstream checker. Build only the mock with
> `vp run -w build_mock`.

## 2. First program in Rust

The `corsa` facade crate re-exports the API client, LSP types, virtual
documents, and the lightweight runtime. The smallest useful program edits an
in-memory document — no Corsa binary required:

```rust
use corsa::{
    lsp::{VirtualChange, VirtualDocument},
    runtime::block_on,
};
use lsp_types::{Position, Range};

fn main() -> Result<(), corsa::CorsaError> {
    block_on(async {
        let mut document =
            VirtualDocument::untitled("/virtual/minimal.ts", "typescript", "const answer = 41;\n")?;

        let events = document.apply_changes(&[VirtualChange::splice(
            Range::new(Position::new(0, 15), Position::new(0, 17)),
            "42",
        )])?;

        println!("emitted {} change event(s)", events.len());
        Ok(())
    })
}
```

Run the bundled equivalent directly from the workspace:

```bash
cargo run -p corsa --example minimal_start
```

When you want to talk to a checker, spawn an `ApiClient`. Point
`ApiSpawnConfig` at a cache directory and a working directory that contains a
Corsa-resolvable project:

```rust
use corsa::{
    api::{ApiClient, ApiSpawnConfig},
    runtime::block_on,
};

fn main() -> Result<(), corsa::CorsaError> {
    block_on(async {
        let client = ApiClient::spawn(
            ApiSpawnConfig::new(".cache/corsa")
                .with_cwd("ref/corsa-upstream/packages/typescript"),
        )
        .await?;

        let init = client.initialize().await?;
        println!("current directory: {}", init.current_directory);

        client.close().await?;
        Ok(())
    })
}
```

`ApiSpawnConfig::new()` defaults to the `SyncMsgpackStdio` transport, which is
the fastest transport on the pinned upstream commit. See the
[Architecture guide](./project_guide.md) for the crate layout behind these
types.

For actual checker questions, open a `ProjectSession` and ask through
`semantics()`. That surface is `corsa-bind`'s own vocabulary: it answers with
opaque handles and keeps its signatures when upstream renames endpoints
underneath it.

```rust
use corsa::{
    api::{ApiSpawnConfig, ProjectSession},
    runtime::block_on,
};

fn main() -> Result<(), corsa::CorsaError> {
    block_on(async {
        let session = ProjectSession::spawn(
            ApiSpawnConfig::new(".cache/corsa")
                .with_cwd("ref/corsa-upstream/packages/typescript"),
            "ref/corsa-upstream/packages/typescript/tsconfig.json",
            Some("ref/corsa-upstream/packages/typescript/src/typescript.ts".into()),
        )
        .await?;

        let facts = session.semantics();
        let file = "ref/corsa-upstream/packages/typescript/src/typescript.ts";
        if let Some(symbol) = facts.symbol_at(file, 0).await? {
            if let Some(value_type) = facts.type_of(&symbol.id).await? {
                println!("{} : {}", symbol.name, facts.type_text(&value_type.id).await?);
            }
        }

        session.close().await?;
        Ok(())
    })
}
```

The upstream-shaped methods on `ProjectSession` and `ApiClient`
(`get_type_at_position`, `is_type_assignable_to`, …) stay available underneath
and mirror upstream naming exactly — reach for them when you need the full
upstream payload, and accept that they move when upstream moves. The
[Architecture charter](./architecture_charter.md) explains the split.

## 3. First program in Node.js

Install the published binding into any Node `22+`, Deno `2.0+`, or Bun `1.2+`
project. The root package is JS-only and pulls in the matching native binary
through platform-specific optional dependencies:

```bash
npm i @corsa-bind/napi
```

The no-binary minimal start mirrors the Rust example — edit a virtual document
and call the Rust-backed type helpers:

```ts
import { CorsaVirtualDocument, isUnsafeAssignment } from "@corsa-bind/napi";

const document = CorsaVirtualDocument.untitled(
  "/virtual/minimal.ts",
  "typescript",
  "const answer = 41;\n",
);

document.applyChanges([
  {
    range: { start: { line: 0, character: 15 }, end: { line: 0, character: 17 } },
    text: "42",
  },
]);

console.log(document.state());
console.log(
  isUnsafeAssignment({ sourceTypeTexts: ["Set<any>"], targetTypeTexts: ["Set<string>"] }),
);
```

To drive a checker, spawn `CorsaApiClient` with the path to a Corsa
executable. The promise-based methods (`spawnAsync`, `initializeAsync`,
`updateSnapshotAsync`, `callJsonAsync`, …) are the right choice for services and
editor integrations; the synchronous variants stay available for short scripts:

```ts
import { CorsaApiClient } from "@corsa-bind/napi";

const client = CorsaApiClient.spawn({
  executable: process.env.CORSA_BIN!, // you provide the Corsa binary
  cwd: process.cwd(),
  mode: "msgpack",
});

try {
  const init = client.initialize();
  const snapshot = client.updateSnapshot({ openProject: "./tsconfig.json" });
  const project = snapshot.projects[0];
  const stringType = client.getStringType(snapshot.snapshot, project.id);
  console.log(client.typeToString(snapshot.snapshot, project.id, stringType.id));
} finally {
  client.close();
}
```

> [!IMPORTANT]
> `@corsa-bind/napi` never bundles a Corsa executable. You must provide a
> compatible binary and pass its path through `spawn({ executable })`. During
> development the repo-local mock binary (`vp run -w build_mock`) works for most
> flows.

The full Node surface — spawn options, sync vs. async, virtual documents,
`callJson`/`callBinary`, and LSP overlays — is documented in the
[Node binding guide](./nodejs_binding.md).

## 4. Type-aware Oxlint

`corsa-oxlint` lets you author Oxlint JS plugins with real type information
sourced from Corsa, keeping the `typescript-eslint`-style authoring model:

```ts
import { OxlintUtils } from "corsa-oxlint";

const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);

export const noStringPlusNumber = createRule({
  name: "no-string-plus-number",
  meta: {
    type: "problem",
    docs: { description: "forbid string + number", requiresTypeChecking: true },
    messages: { unexpected: "string plus number is forbidden" },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = OxlintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();
    return {
      BinaryExpression(node) {
        if (node.operator !== "+") return;
        const left = checker.getTypeAtLocation(node.left);
        const right = checker.getTypeAtLocation(node.right);
        if (
          checker.typeToString(checker.getBaseTypeOfLiteralType(left) ?? left) === "string" &&
          checker.typeToString(checker.getBaseTypeOfLiteralType(right) ?? right) === "number"
        ) {
          context.report({ node, messageId: "unexpected" });
        }
      },
    };
  },
});
```

Type-aware settings live under `settings.corsaOxlint`. The full authoring model
and native rule set are covered in the [Oxlint guide](./oxlint_guide.md).

## 5. Explore the examples

The repository ships executable examples for Rust, `@corsa-bind/napi`, and
`corsa-oxlint`. The smoke-tested set runs without the real upstream binary:

```bash
vp run -w examples_smoke          # all smoke examples
vp run -w examples_node_smoke     # Node / TypeScript only
vp run -w examples_rust_smoke     # Rust only
```

Run a single example directly:

```bash
pnpm --dir examples run minimal-start
cargo run -p corsa --example minimal_start
```

The [examples README](https://github.com/ubugeeei/corsa-bind/tree/main/examples)
has a goal-oriented map from minimal edits up through checker queries,
orchestration, and observability.

## Run against the real pinned Corsa

When you want end-to-end behavior against the exact upstream commit, sync and
verify the pinned checkout, build the real binary, then run the real examples:

```bash
vp run -w sync_ref      # materialize ref/corsa-upstream at the pinned commit
vp run -w verify_ref    # confirm the checkout matches corsa_ref.lock.toml
vp run -w build_corsa   # build the real Corsa binary into .cache/corsa
vp run -w examples_real # run the real-snapshot examples
```

The pinned ref is the source of truth for reproducibility; how it is synced and
verified is documented in
[Upstream dependency management](./corsa_upstream_dependency.md).

## Where to go next

- [Architecture](./project_guide.md) — workspace shape, upstream policy, and extension points
- [Node binding guide](./nodejs_binding.md) — the full `@corsa-bind/napi` surface
- [Language bindings](./language_bindings.md) — Elixir, C, C++, Go, Zig, C#, Swift, and MoonBit
- [Oxlint guide](./oxlint_guide.md) — type-aware and native rule authoring
- [CI and local checks](./ci_guide.md) — reproduce the GitHub checks locally
- [Production readiness](./production_readiness.md) — runtime controls and release gates
