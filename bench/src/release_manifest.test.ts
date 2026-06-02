import { describe, expect, it } from "vitest";

import {
  publicRustCrateNames,
  publicRustCrates,
  rustReleaseCrates,
} from "../../scripts/release_manifest.ts";

describe("release manifest", () => {
  it("keeps the public Rust publish order explicit and stable", () => {
    expect(publicRustCrateNames).toEqual([
      "corsa_core",
      "corsa_runtime",
      "corsa_jsonrpc",
      "corsa_client",
      "corsa_lsp",
      "corsa_orchestrator",
      "corsa",
    ]);
  });

  it("tracks internal crates separately from public crates", () => {
    expect(
      rustReleaseCrates.filter((crate) => crate.publish === "internal").map((crate) => crate.name),
    ).toEqual(["corsa_ref", "corsa_ffi", "corsa_node", "corsa_elixir"]);

    expect(publicRustCrates.every((crate) => crate.publish === "public")).toBe(true);
  });
});
