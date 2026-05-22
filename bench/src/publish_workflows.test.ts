import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readWorkflow(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf8");
}

describe("publish workflows", () => {
  it("requires tag refs for manual package publishing", () => {
    for (const path of [
      ".github/workflows/publish-npm.yml",
      ".github/workflows/publish-rust.yml",
    ]) {
      const workflow = readWorkflow(path);
      expect(workflow).toContain("github.ref_type == 'tag'");
      expect(workflow).toContain("Validate release tag");
      expect(workflow).not.toContain("if: ${{ github.event_name == 'push' }}");
    }
  });

  it("protects GitHub Release creation with the release environment", () => {
    const workflow = readWorkflow(".github/workflows/github-release.yml");
    expect(workflow).toContain("environment: release");
  });

  it("sets up Node 24 before running the Rust publish script", () => {
    const workflow = readWorkflow(".github/workflows/publish-rust.yml");
    expect(workflow).toContain("Setup Node.js for release scripts");
    expect(workflow).toMatch(/uses: actions\/setup-node@[a-f0-9]{40} # v6/);
    expect(workflow).toContain('node-version: "24"');
    expect(workflow).toContain("node --strip-types ./scripts/publish_rust.ts");
  });

  it("derives the napi native build matrix from the package config", () => {
    const workflow = readWorkflow(".github/workflows/publish-npm.yml");
    expect(workflow).toContain("resolve-native-targets:");
    expect(workflow).toContain("node --strip-types ./scripts/print_napi_build_matrix.ts");
    expect(workflow).toContain(
      "matrix: ${{ fromJSON(needs.resolve-native-targets.outputs.matrix) }}",
    );
    expect(workflow).toContain("Setup Zig for musl cross-builds");
    expect(workflow).toMatch(/uses: goto-bus-stop\/setup-zig@[a-f0-9]{40} # v2/);
    expect(workflow).toContain('cross_arg="--use-napi-cross"');
    expect(workflow).toContain('cross_arg="--cross-compile"');
  });

  it("benchmarks PR base and head against TypeScript 6 and 7", () => {
    const workflow = readWorkflow(".github/workflows/pr-performance.yml");
    expect(workflow).toContain('BENCH_ITERATIONS: "5"');
    expect(workflow).toContain("ref-role:");
    expect(workflow).toContain("typescript-major:");
    expect(workflow).toContain("typescript@^${{ matrix.typescript-major }}");
    expect(workflow).toContain("node --strip-types ./scripts/pr_benchmark_report.ts comment");
  });
});
