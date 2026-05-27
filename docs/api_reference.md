---
title: API reference generation
description: How the generated API reference is produced from documentation comments.
---

# API reference generation

The documentation build uses `ox_content_docs` to extract public TypeScript
exports from the Node packages and `ox_content_ssg` to render the final static
site.

## Documented entrypoints

- `@corsa-bind/napi`
- `corsa-oxlint`
- `corsa-oxlint/rules`

The generated reference pages are written into the build-only content tree under
`.cache/corsa-docs/content/api` before Ox Content renders the full site into
`dist/docs`.

## Authoring rule

Public functions, classes, and constants should carry JSDoc comments that explain
the contract callers rely on. The generator intentionally excludes private and
internal tags so the site stays focused on supported API surface.
