import { describe, expect, it } from "vitest";

import {
  type CapturedBenchReport,
  compareReports,
  createCommentBody,
} from "../../scripts/pr_benchmark_report.ts";

describe("PR benchmark report", () => {
  it("compares head means against base means by TypeScript major", () => {
    const comparisons = compareReports([
      captured("base", "6", [
        row("project_check", "api", "tsgo", 100),
        row("editor_workflow", "api", "corsa-msgpack-warm", 10),
      ]),
      captured("head", "6", [
        row("project_check", "api", "tsgo", 80),
        row("editor_workflow", "api", "corsa-msgpack-warm", 10.1),
      ]),
    ]);

    expect(comparisons).toHaveLength(1);
    expect(comparisons[0]?.fasterCount).toBe(1);
    expect(comparisons[0]?.stableCount).toBe(1);
    expect(comparisons[0]?.rows[0]).toMatchObject({
      tool: "corsa-msgpack-warm",
      result: "stable",
    });
    expect(comparisons[0]?.rows[1]).toMatchObject({
      tool: "tsgo",
      result: "faster",
      deltaPercent: -20,
    });
  });

  it("renders a sticky PR comment with full rows", () => {
    const body = createCommentBody([
      captured("base", "7", [row("project_check", "native-preview", "tsc", 200)]),
      captured("head", "7", [row("project_check", "native-preview", "tsc", 230)]),
    ]);

    expect(body).toContain("<!-- corsa-pr-performance-benchmark -->");
    expect(body).toContain("5-sample mean");
    expect(body).toContain("TS v7");
    expect(body).toContain("slower");
    expect(body).toContain("+15.00%");
  });
});

function captured(
  branchRole: "base" | "head",
  major: string,
  rows: CapturedBenchReport["report"]["rows"],
): CapturedBenchReport {
  return {
    schemaVersion: 1,
    branchRole,
    refName: branchRole === "base" ? "main" : "feature",
    sha: branchRole === "base" ? "1111111111111111111111111111111111111111" : "2222222",
    typescript: {
      major,
      requested: `typescript@^${major}`,
      installed: `${major}.0.0`,
    },
    github: {
      runId: "1",
      runAttempt: "1",
    },
    report: {
      iterations: 5,
      warmupIterations: 1,
      timeoutMs: 120_000,
      rows,
    },
  };
}

function row(
  workload: string,
  dataset: string,
  tool: string,
  meanMs: number,
): NonNullable<CapturedBenchReport["report"]["rows"]>[number] {
  return {
    workload,
    dataset,
    tool,
    sampleCount: 5,
    meanMs,
    medianMs: meanMs,
    p95Ms: meanMs,
    minMs: meanMs,
    maxMs: meanMs,
  };
}
