---
title: API reference generation
description: How the generated API reference is produced from documentation comments.
---

# API reference generation

The documentation build uses the Vite plugin in `docs/build` to extract public
TypeScript exports from the Node packages and render the final static site with
Ox Content.

## Documented entrypoints

- `@corsa-bind/napi`
- `corsa-oxlint`
- `corsa-oxlint/rules`
- `corsa-oxlint/stylistic`

The generated reference pages are emitted directly into `dist/docs/api` during
`vp run -w docs_build`. Source Markdown stays in `docs`, and the generated HTML
stays out of the repository.

## Authoring rule

Public functions, classes, and constants should carry JSDoc comments that explain
the contract callers rely on. The generator intentionally excludes private and
internal tags so the site stays focused on supported API surface.
