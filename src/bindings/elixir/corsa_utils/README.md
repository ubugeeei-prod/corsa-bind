# CorsaUtils for Elixir

Elixir bindings for `corsa-bind`, backed by a Rustler NIF.

The package exposes the same three surfaces as the other native bindings:

- `Corsa` for pure type-text utility predicates.
- `Corsa.VirtualDocument` for in-memory LSP document edits.
- `Corsa.ApiClient` for checker API calls against a caller-provided Corsa executable.

## Build

```bash
cd src/bindings/elixir/corsa_utils
mix deps.get
mix test
```

The Rust NIF is built by the Rustler Mix compiler from
`native/corsa_elixir`. The API client does not bundle a Corsa executable; pass
one with `Corsa.ApiClient.spawn/1`.

## Example

```elixir
iex> Corsa.classify_type_text("string[]")
"array"

iex> {:ok, doc} = Corsa.VirtualDocument.untitled("/demo.ts", "typescript", "const value = 1;")
iex> :ok = Corsa.VirtualDocument.replace(doc, "const value = 2;")
iex> Corsa.VirtualDocument.text(doc)
"const value = 2;"
```

API client calls return `{:ok, value}` or `{:error, reason}`:

```elixir
{:ok, client} =
  Corsa.ApiClient.spawn(%{
    executable: "/path/to/corsa",
    cwd: File.cwd!(),
    mode: "msgpack"
  })

{:ok, init} = Corsa.ApiClient.initialize(client)
:ok = Corsa.ApiClient.close(client)
```
