---
title: corsa documentation
description: Guides and generated API reference for the corsa workspace.
---

# corsa documentation

This documentation is built with Ox Content from the Markdown files in this
directory and API reference pages generated from TypeScript documentation
comments.

## Start here

- [Project guide](./project_guide.md) explains the workspace architecture.
- [CI guide](./ci_guide.md) explains local and GitHub checks.
- [Release guide](./release_guide.md) explains publish and verification flows.
- [API reference](./api/index.md) is generated from the public Node entrypoints.

## Build and deploy

Build the static documentation site locally:

```bash
vp run -w docs_build
```

Deploy the generated `dist/docs` directory with Void:

```bash
vp run -w docs_deploy
```
