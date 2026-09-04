---
title: Content mappers
description: Run TypeScript content mappers through corsa-bind, decode mapped source files, and map checker positions back into the file the user edits.
---

# Content mappers

A **content mapper** is a package a project declares in `tsconfig.json` that
turns otherwise unsupported file content — `.vue`, `.svelte`, `.astro`, a
framework's own dialect — into virtual TypeScript while the program is built.
Corsa spawns the mapper as a child process, talks JSON-RPC to it over stdio, and
parses whatever TypeScript it returns in place of the file's real text.

That substitution is the thing every tool built on `corsa-bind` has to know
about: for a mapped file, **the checker's positions are positions in the virtual
TypeScript, not in the file the user edits**. `corsa-bind` exposes the mapper
identity, both texts, and the span map between them, so results land where the
user is looking.

## Trusting a workspace

Mappers are external processes, so Corsa refuses to run them unless the caller
opts in with `--runExternalCode`. `corsa-bind` never sets that by itself.

```rust
use corsa::api::ApiSpawnConfig;

// Only for workspaces you trust: this lets configured mappers spawn processes.
let config = ApiSpawnConfig::new("./.cache/corsa").with_run_external_code(true);
```

```ts
const client = CorsaApiClient.spawn({
  executable: "./.cache/corsa",
  runExternalCode: true,
});
```

In `corsa-oxlint` the same switch lives at
`settings.corsaOxlint.parserOptions.corsa.runExternalCode`. Leave it unset for
untrusted checkouts; the checker then reports the mapped files as unresolved
instead of executing anything.

## Declaring a mapper

The project names the package and the extensions it claims:

```json
{
  "compilerOptions": { "strict": true },
  "contentMappers": [{ "package": "vue-mapper", "extensions": [".vue"] }]
}
```

The mapper package's own `package.json` says how to run it:

```json
{
  "name": "vue-mapper",
  "version": "1.2.3",
  "typescript": { "contentMapper": { "exec": ["node", "./mapper.mjs"] } }
}
```

`corsa-bind` reads the declared mappers back off a parsed config:

```rust
let config = client.parse_config_file("./tsconfig.json").await?;
for mapper in config.content_mappers() {
    println!("{} claims {:?}", mapper.package, mapper.extensions);
}
```

```ts
const config = client.parseConfigFile("./tsconfig.json");
for (const mapper of contentMappersFromConfig(config)) {
  console.log(mapper.package, mapper.extensions);
}
```

Both read the `contentMappers` array out of the raw `tsconfig` object the
runtime returns alongside the normalized compiler options, and both return an
empty list when the project declares none — including on runtimes that predate
content mappers.

## Decoding a mapped source file

`getSourceFile` returns Corsa's binary AST payload. Decoding its source-file
level fields tells you whether a mapper produced the file:

```rust
let source_file = client
    .get_encoded_source_file(snapshot.handle.clone(), project, "./src/App.vue")
    .await?
    .expect("the project contains the file");

if let Some(mapping) = source_file.content_mapping() {
    println!("{} produced {}", mapping.content_mapper, mapping.virtual_file_name);
    println!("virtual: {}", source_file.text);
    println!("authored: {}", source_file.original_text);
}
```

```ts
const sourceFile = client.getEncodedSourceFile(snapshot.snapshot, project.id, "./src/App.vue");
if (sourceFile?.contentMapping) {
  console.log(sourceFile.contentMapping.contentMapper);
  console.log(sourceFile.text); // virtual TypeScript
  console.log(sourceFile.originalText); // what is on disk
}
```

The decoded record carries:

| Field                                        | Meaning                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `text`                                       | What the checker parsed — the virtual TypeScript for a mapped file. |
| `originalText`                               | What is on disk. Equal to `text` when no mapper was involved.       |
| `contentMapping.contentMapper`               | The mapper's `name@version` identity.                               |
| `contentMapping.virtualFileName`             | Filename whose extension decided how the virtual text was parsed.   |
| `contentMapping.spanMap`                     | Segments relating virtual and original positions.                   |
| `contentMapping.diagnosticDirectives`        | Ranges where the mapper suppressed or required a diagnostic.        |
| `contentMapping.supplementalSourceFileNames` | Extra outputs the mapper attached to this file.                     |
| `contentMapping.canonicalSourceFileName`     | Set when this file is itself a supplemental output.                 |

`contentMapping` is absent for files no mapper touched, which is the cheap way
to branch: `isContentMappedSourceFile(payload)` in JavaScript,
`EncodedSourceFile::is_content_mapped` in Rust.

Decoding is versioned. The payload's protocol byte is checked first, and a
payload from a newer binary protocol is reported as an error rather than
guessed at — `get_source_file` keeps returning the raw bytes either way.

## Mapping positions

The span map is a list of segments, each relating one half-open virtual range to
one half-open original range, in UTF-16 code units. Queries answer in both
directions and say how faithful the answer is.

```rust
use corsa::api::{SpanMapFeature, SpanMapFidelity, TextRange};

let span_map = source_file.span_map().expect("the file is mapped");

// A checker range -> where to underline in the `.vue` file.
let mapped = span_map.virtual_to_original_span(TextRange::new(13, 18));
assert_eq!(mapped.fidelity, SpanMapFidelity::Exact);

// An editor position -> where to ask the checker.
for projection in span_map.original_to_virtual_positions(16, SpanMapFeature::HOVER) {
    println!("ask the checker at {}", projection.position);
}
```

```ts
const spanMap = spanMapForSourceFile(payload)!;
spanMap.virtualToOriginalSpan(13, 18); // { range: { pos, end }, fidelity }
spanMap.originalToVirtualPositions(16, SpanMap.Feature.Hover);
```

Three things make this different from a plain offset shift:

**Fidelity.** A result is `Exact` when it passed through one verbatim segment,
`Atom` when it landed inside an indivisible segment and had to widen to that
segment's bounds, `Approximate` when its endpoints went through different
segments, and `None` when the input has no counterpart at all — synthesized
prologue text the mapper generated, or authored text it never emitted. Only
`Exact` is safe to drive an edit with; `SpanMapFidelity::is_single_segment`
covers `Exact` and `Atom` for highlighting.

**Features.** A mapper may let a segment serve hover but not rename. Pass the
feature you are serving and the query skips segments that opted out, returning
`None` fidelity rather than a plausible-looking wrong answer. The bit values are
`SpanMapFeature` in Rust and `SpanMap.Feature` in JavaScript.

**Multiplicity.** One piece of authored text can appear several times in the
virtual output — a template expression checked once per scope, say. The
original-to-virtual queries therefore return a list, ordered by virtual
position, and a range that starts in one copy and ends in another yields the
smallest candidate around each location instead of one range spanning them all.

## corsa-oxlint

`corsa-oxlint` applies the mapping for you. When the project declares no content
mappers — the common case — nothing changes and nothing extra is requested. When
it does, files whose extension a mapper claims get their span map resolved once,
and the session translates the linter's authored positions into checker
positions before every type and symbol lookup. Authored text the mapper never
emitted resolves to no type at all, rather than to whatever the checker happens
to have at that raw offset.

Rules that need the mapping themselves can read it off the program:

```ts
const program = getParserServices(context).program;
const mapping = program.getContentMapping();
if (mapping) {
  const authored = mapping.spanMap.virtualToOriginalPosition(position);
}
```

`program.getContentMappers()` returns the mappers the project's `tsconfig`
declares.

## Limits

- Mapper **option diagnostics** (a mapper rejecting its own configuration) are
  reported by Corsa through config parsing and are not yet surfaced as a typed
  field on the parsed-config response.
- Supplemental outputs are named but not fetched for you; request them with
  `getSourceFile` like any other file, and they carry their own span map plus a
  `canonicalSourceFileName` pointing back at the file they belong to.
- The binary source-file decoder reads the source-file level fields only. The
  node table is still returned untouched as raw bytes.

## See also

- [Node.js binding](./nodejs_binding.md) — the full `@corsa-bind/napi` surface.
- [Type-aware Oxlint](./oxlint_guide.md) — `settings.corsaOxlint` and rule authoring.
- [Upstream pin](./corsa_upstream_dependency.md) — the Corsa revision these
  semantics are mirrored from.
