---
title: Language bindings
description: Use the native Corsa bindings from Elixir, C, C++, Go, Zig, C#, Swift, and MoonBit — build the shared library or Rustler NIF and call the utils, API client, and virtual document surfaces.
---

# Language Bindings

Most non-Node bindings are layered on a single shared C ABI crate,
[`corsa_ffi`](https://github.com/ubugeeei/corsa-bind/tree/main/src/bindings/c/corsa_ffi).
It exposes the Rust `corsa_client::ApiClient`, `corsa_core::utils`, and
`corsa_lsp::VirtualDocument` surfaces over a stable C interface, and the thin
per-language wrappers add idiomatic ergonomics on top.

Elixir uses a Rustler NIF instead of the C ABI because BEAM runtimes need a NIF
or port boundary. It exposes the same utils, virtual-document, and API-client
surfaces through `Corsa`, `Corsa.VirtualDocument`, and `Corsa.ApiClient`.

```
corsa_client / corsa_core::utils / corsa_lsp        (Rust)
                  │
            corsa_ffi  (C ABI: cdylib + staticlib)
                  │
   ┌────────┬─────┴──────┬──────┬──────┬──────────┐
   C       C++          Go     Zig    C#   Swift / MoonBit

corsa_client / corsa_core::utils / corsa_lsp        (Rust)
                  │
            Rustler NIF
                  │
                Elixir
```

The Node.js binding is documented separately in the
[Node binding guide](./nodejs_binding.md); it uses `napi-rs` rather than this
C ABI.

## What each binding exposes

All language wrappers cover the same three surfaces:

- **Utils** — Rust-backed type-text predicates and splitters
  (`classify_type_text`, `is_string_like_type_texts`, `split_type_text`, …),
  with no checker process required.
- **Virtual document** — in-memory document editing
  (`untitled`, `apply_changes`, `replace`, `state`).
- **API client** — spawn a Corsa process and run checker queries
  (`spawn`, `initialize`, `update_snapshot`, …).

| Language | Wrapper location                   | Header / module                                                   |
| -------- | ---------------------------------- | ----------------------------------------------------------------- |
| C        | `src/bindings/c/corsa_ffi`         | `include/corsa_utils.h`                                           |
| C++      | `src/bindings/cpp`                 | `corsa_api.hpp`, `corsa_utils.hpp`, `corsa_virtual_document.hpp`  |
| Go       | `src/bindings/go/corsa_utils`      | `github.com/ubugeeei-prod/corsa-bind/src/bindings/go/corsa_utils` |
| Zig      | `src/bindings/zig`                 | `corsa_api.zig`, `corsa_utils.zig`, `corsa_virtual_document.zig`  |
| C#       | `src/bindings/csharp/CorsaUtils`   | `CorsaUtils.csproj`                                               |
| Swift    | `src/bindings/swift/CorsaUtils`    | `Package.swift`                                                   |
| MoonBit  | `src/bindings/moonbit/corsa_utils` | `moon.pkg.json`                                                   |
| Elixir   | `src/bindings/elixir/corsa_utils`  | `Corsa`, `Corsa.VirtualDocument`, `Corsa.ApiClient`               |

> [!IMPORTANT]
> Like the Node binding, these wrappers do **not** bundle a Corsa executable.
> The API client surface requires a Corsa binary you provide at runtime. The
> utils and virtual-document surfaces need no external process.

## Build the shared library

C ABI bindings link against `corsa_ffi`. Build it first; the C ABI crate is
configured as both a `cdylib` and a `staticlib`. Elixir builds its Rustler NIF
from the `src/bindings/elixir/corsa_utils` package instead.

```bash
cargo build -p corsa_ffi
```

This writes the artifacts into the Cargo target directory:

| Platform | Shared library                    | Static library                |
| -------- | --------------------------------- | ----------------------------- |
| Linux    | `target/debug/libcorsa_ffi.so`    | `target/debug/libcorsa_ffi.a` |
| macOS    | `target/debug/libcorsa_ffi.dylib` | `target/debug/libcorsa_ffi.a` |
| Windows  | `target/debug/corsa_ffi.dll`      | `target/debug/corsa_ffi.lib`  |

The C header lives at
`src/bindings/c/corsa_ffi/include/corsa_utils.h` and declares the full struct
set (`CorsaStrRef`, `CorsaString`, `CorsaBytes`, `CorsaApiClient`,
`CorsaVirtualDocument`, …) and functions.

> [!NOTE]
> When you link the dynamic library, the loader has to find it at runtime. Add
> `target/debug` to `LD_LIBRARY_PATH` (Linux) or `DYLD_LIBRARY_PATH` (macOS),
> or link the static library instead.

## C

Include the header and link the library:

```c
#include "corsa_utils.h"

int main(void) {
  CorsaStrRef text = { (const uint8_t *)"string[]", 8 };
  CorsaString kind = corsa_utils_classify_type_text(text);
  /* use kind.ptr / kind.len, then free Rust-owned strings via the take APIs */
  return 0;
}
```

```bash
cargo build -p corsa_ffi
cc main.c \
  -I src/bindings/c/corsa_ffi/include \
  -L target/debug -lcorsa_ffi \
  -o main
LD_LIBRARY_PATH=target/debug ./main
```

Strings returned as `CorsaString` are owned by Rust; release the thread-local
last-error string with `corsa_error_message_take()` where the API documents it.

## C++

The C++ headers are header-only RAII wrappers over the same ABI. Include the
headers and add both the `cpp` and C header directories to the include path:

```cpp
#include "corsa_api.hpp"
#include "corsa_utils.hpp"
#include "corsa_virtual_document.hpp"

int main() {
  auto ref = corsa::utils::to_ref("string");
  return ref.len == 0 ? 1 : 0;
}
```

```bash
cargo build -p corsa_ffi
c++ -std=c++20 \
  -I src/bindings/cpp \
  -I src/bindings/c/corsa_ffi/include \
  main.cpp \
  -L target/debug -lcorsa_ffi \
  -o main
```

`corsa::api::corsa_api_client` is move-only and closes the underlying handle in
its destructor, so client lifetime follows normal RAII scoping.

## Go

The Go module wraps the C ABI with cgo. Build the shared library, then point
the loader at it:

```bash
cargo build -p corsa_ffi
cd src/bindings/go/corsa_utils
LD_LIBRARY_PATH=$PWD/../../../../target/debug go test ./...
```

Import it as:

```go
import corsa "github.com/ubugeeei-prod/corsa-bind/src/bindings/go/corsa_utils"
```

The package provides the utils predicates plus `VirtualDocument` and
`ApiClient` types mirroring the Rust surface.

## Zig

The Zig wrapper imports the C header through `@cImport` and exposes typed
`ApiClient`, `VirtualDocument`, and utils APIs:

```zig
const corsa = @import("corsa_api.zig");

const client = try corsa.ApiClient.spawn(allocator, .{
    .executable = "/path/to/corsa",
    .cwd = ".",
    .mode = .msgpack,
});
defer client.deinit();
```

`SpawnOptions` mirrors the C ABI spawn options (`executable`, `cwd`, `mode`,
`request_timeout_ms`, `shutdown_timeout_ms`, `outbound_capacity`,
`allow_unstable_upstream_calls`). Add `target/debug` to the library search path
and link `corsa_ffi`.

## C#

The `CorsaUtils` project provides `CorsaUtils`, `CorsaApiClient`, and
`CorsaVirtualDocument` over P/Invoke:

```bash
cargo build -p corsa_ffi
dotnet build src/bindings/csharp/CorsaUtils/CorsaUtils.csproj
```

Ensure the native loader can find `corsa_ffi` at runtime (set the platform
library path or copy the shared library next to the managed assembly).

## Swift

The Swift package links `corsa_ffi` from the Cargo target directory:

```bash
cargo build -p corsa_ffi
cd src/bindings/swift/CorsaUtils
swift build
```

`Package.swift` links the library with `-L ../../../../target/debug
-lcorsa_ffi`. The `Sources/CorsaUtils` module exposes `CorsaUtils`,
`CorsaApiClient`, and `CorsaVirtualDocument`.

## MoonBit

The MoonBit package wraps the C ABI through a small C shim (`cwrap.c`):

```bash
cargo build -p corsa_ffi
cd src/bindings/moonbit/corsa_utils
moon test
```

See `README.mbt.md` in that directory for the MoonBit-specific build details.
The package mirrors the same utils, API client, and virtual document surfaces.

## Elixir

The Elixir package is backed by a Rustler NIF rather than the C ABI:

```bash
cd src/bindings/elixir/corsa_utils
mix deps.get
mix test
```

Use it as:

```elixir
Corsa.classify_type_text("string[]")

{:ok, doc} = Corsa.VirtualDocument.untitled("/demo.ts", "typescript", "const value = 1;")
:ok = Corsa.VirtualDocument.replace(doc, "const value = 2;")
```

`Corsa.ApiClient` accepts a caller-provided executable path and mirrors the C
ABI API-client surface. Map-based helpers decode JSON through Jason; `_json`
variants expose the raw JSON strings.

## How they are verified

CI builds `corsa_ffi`, runs the Go binding tests, and compiles a C++ smoke
translation unit against the headers in the `non-node-bindings` job. The
Elixir NIF crate is part of the Rust workspace and is covered by Rust format,
build, and clippy checks; Mix-level tests remain experimental until Elixir is
added to the required CI matrix. The binding benchmark harness
(`scripts/bench_bindings.ts`, `vp run -w bench_bindings`) builds and links the
C, C++, and Go bindings against the same shared library. See the
[CI guide](./ci_guide.md) for the full job layout.

## See also

- [Node.js binding](./nodejs_binding.md) — the `napi-rs` JavaScript surface
- [Architecture](./project_guide.md) — where `corsa_ffi` sits in the workspace
- [Support policy](./support_policy.md) — supported platforms and experimental scope
