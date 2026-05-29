---
title: corsa-bind documentation
description: Guides and generated API reference for the corsa-bind workspace.
---

# corsa-bind

Rust, Node.js, and integration tooling around the upstream Corsa checker.
Use this site as the map for architecture, local verification, release work,
and generated API reference pages.

## Start here

- [Getting started](./getting_started.md) takes you from a clean checkout to a
  first program in Rust, Node.js, and the type-aware Oxlint framework.
- [Architecture](./project_guide.md) explains the workspace shape, upstream
  policy, and extension points.

## Use the bindings

- [Node.js binding](./nodejs_binding.md) documents the full `@corsa-bind/napi`
  surface for Node, Deno, and Bun.
- [Language bindings](./language_bindings.md) covers the `corsa_ffi` C ABI and
  the C, C++, Go, Zig, C#, Swift, and MoonBit wrappers.
- [Type-aware Oxlint](./oxlint_guide.md) is the authoring guide for
  `corsa-oxlint` rules, native rules, and stylistic rules.

## Run and ship

- [CI and local checks](./ci_guide.md) is the shortest path for reproducing
  GitHub checks on a local machine.
- [Performance commands](./performance.md) lists benchmark entrypoints and the
  artifacts they write.
- [Release process](./release_guide.md) covers package publishing and release
  verification.
- [API index](./api/index.md) links to generated reference pages for the public
  Node entrypoints.

## Operational reference

- [Production readiness](./production_readiness.md) lists supported runtime
  controls and release gates.
- [Support policy](./support_policy.md) defines supported platforms, bindings,
  and experimental scope.
- [Supply chain](./supply_chain_policy.md) records dependency and publishing
  policy.
- [Upstream pin](./corsa_upstream_dependency.md) explains how the checked-in
  Corsa upstream revision is synced and verified.

## Build and deploy

Build the static documentation site locally:

```bash
vp run -w docs_build
```

Deploy with Void. The root `void.json` points Void at the docs build and
`dist/docs` output directory, so this command can run from the repository root:

```bash
npx void deploy
```
