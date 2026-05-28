import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createBinaryPackageManifest,
  createRootBindingPublishManifest,
  getNodeBindingBuildMatrix,
  getNodeBindingTargets,
  parseTargetTriple,
} from "../../scripts/npm_release_utils.ts";

const nodeBindingManifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/bindings/nodejs/corsa_node/package.json"), "utf8"),
) as {
  engines: Record<string, string>;
  exports: Record<string, unknown>;
  files: string[];
  name: string;
  type: string;
  version: string;
};

describe("npm release utils", () => {
  it("declares Deno and Bun support for published JS packages", () => {
    const manifests = [
      nodeBindingManifest,
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "src/bindings/nodejs/corsa_oxlint/package.json"),
          "utf8",
        ),
      ) as { engines: Record<string, string>; exports: Record<string, unknown> },
    ];

    for (const manifest of manifests) {
      expect(manifest.engines).toMatchObject({
        node: ">=22",
        deno: ">=2.0",
        bun: ">=1.2",
      });

      for (const entry of Object.values(manifest.exports)) {
        if (typeof entry === "string") {
          continue;
        }
        expect(entry).toMatchObject({
          deno: expect.any(String),
          bun: expect.any(String),
        });
      }
    }

    expect(nodeBindingManifest.type).toBe("commonjs");
  });

  it("includes the configured native binding targets", () => {
    expect(
      getNodeBindingTargets(nodeBindingManifest).map(
        (target: { platformArchABI: string }) => target.platformArchABI,
      ),
    ).toEqual([
      "win32-x64-msvc",
      "darwin-x64",
      "linux-x64-gnu",
      "darwin-arm64",
      "win32-arm64-msvc",
      "linux-x64-musl",
      "linux-arm64-gnu",
      "linux-arm64-musl",
    ]);
  });

  it("deduplicates repeated native binding targets without changing publish order", () => {
    expect(
      getNodeBindingTargets({
        ...nodeBindingManifest,
        napi: {
          triples: {
            additional: [
              "x86_64-unknown-linux-gnu",
              "aarch64-apple-darwin",
              "aarch64-pc-windows-msvc",
              "x86_64-unknown-linux-musl",
              "aarch64-unknown-linux-gnu",
              "aarch64-unknown-linux-musl",
              "x86_64-unknown-linux-gnu",
            ],
          },
        },
      }).map((target: { platformArchABI: string }) => target.platformArchABI),
    ).toEqual([
      "win32-x64-msvc",
      "darwin-x64",
      "linux-x64-gnu",
      "darwin-arm64",
      "win32-arm64-msvc",
      "linux-x64-musl",
      "linux-arm64-gnu",
      "linux-arm64-musl",
    ]);
  });

  it("derives the GitHub Actions build matrix from the configured native targets", () => {
    expect(getNodeBindingBuildMatrix(nodeBindingManifest)).toEqual([
      {
        crossCompile: false,
        os: "windows-latest",
        target: "x86_64-pc-windows-msvc",
        useNapiCross: false,
      },
      {
        crossCompile: false,
        os: "macos-15-intel",
        target: "x86_64-apple-darwin",
        useNapiCross: false,
      },
      {
        crossCompile: false,
        os: "blacksmith-32vcpu-ubuntu-2404",
        target: "x86_64-unknown-linux-gnu",
        useNapiCross: true,
      },
      {
        crossCompile: false,
        os: "macos-15",
        target: "aarch64-apple-darwin",
        useNapiCross: false,
      },
      {
        crossCompile: false,
        os: "windows-latest",
        target: "aarch64-pc-windows-msvc",
        useNapiCross: false,
      },
      {
        crossCompile: true,
        os: "blacksmith-32vcpu-ubuntu-2404",
        target: "x86_64-unknown-linux-musl",
        useNapiCross: false,
      },
      {
        crossCompile: false,
        os: "blacksmith-32vcpu-ubuntu-2404",
        target: "aarch64-unknown-linux-gnu",
        useNapiCross: true,
      },
      {
        crossCompile: true,
        os: "blacksmith-32vcpu-ubuntu-2404",
        target: "aarch64-unknown-linux-musl",
        useNapiCross: false,
      },
    ]);
  });

  it("creates binary package manifests with libc metadata when needed", () => {
    const target = parseTargetTriple("x86_64-unknown-linux-gnu");
    expect(
      createBinaryPackageManifest(
        nodeBindingManifest,
        nodeBindingManifest.version,
        target,
        "corsa_node.linux-x64-gnu.node",
      ),
    ).toMatchObject({
      cpu: ["x64"],
      files: ["corsa_node.linux-x64-gnu.node"],
      libc: ["glibc"],
      main: "corsa_node.linux-x64-gnu.node",
      name: `${nodeBindingManifest.name}-linux-x64-gnu`,
      os: ["linux"],
      version: nodeBindingManifest.version,
    });
  });

  it("keeps the root package JS-only and wires optional dependencies", () => {
    const manifest = createRootBindingPublishManifest(
      nodeBindingManifest,
      nodeBindingManifest.version,
      [parseTargetTriple("x86_64-unknown-linux-gnu"), parseTargetTriple("aarch64-apple-darwin")],
    );

    expect(manifest.files).not.toContain("*.node");
    expect(manifest.optionalDependencies).toEqual({
      [`${nodeBindingManifest.name}-darwin-arm64`]: nodeBindingManifest.version,
      [`${nodeBindingManifest.name}-linux-x64-gnu`]: nodeBindingManifest.version,
    });
  });
});
