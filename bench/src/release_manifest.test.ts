import { describe, expect, it } from "vitest";

import {
  isPrereleaseTag,
  isPrereleaseVersion,
  normalizeReleaseTag,
  parseReleaseVersion,
  publicRustCrateNames,
  publicRustCrates,
  rustReleaseCrates,
  versionToTag,
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

  it("accepts stable and prerelease versions", () => {
    expect(parseReleaseVersion("1.0.0")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: null,
    });
    expect(parseReleaseVersion("1.0.0-beta.1")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: "beta.1",
    });
    expect(versionToTag("1.0.0-beta.1")).toBe("v1.0.0-beta.1");
  });

  it("normalizes stable and prerelease tags", () => {
    expect(normalizeReleaseTag("refs/tags/v1.0.0")).toBe("v1.0.0");
    expect(normalizeReleaseTag("refs/tags/v1.0.0-beta.1")).toBe("v1.0.0-beta.1");
    expect(isPrereleaseVersion("1.0.0")).toBe(false);
    expect(isPrereleaseVersion("1.0.0-beta.1")).toBe(true);
    expect(isPrereleaseTag("v1.0.0")).toBe(false);
    expect(isPrereleaseTag("v1.0.0-beta.1")).toBe(true);
  });

  it("rejects invalid release versions and tags", () => {
    expect(() => parseReleaseVersion("1.0")).toThrow();
    expect(() => parseReleaseVersion("1.0.0-")).toThrow();
    expect(() => parseReleaseVersion("1.0.0-beta..1")).toThrow();
    expect(() => normalizeReleaseTag("1.0.0")).toThrow();
  });
});
