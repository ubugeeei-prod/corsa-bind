import { describe, expect, it } from "vitest";

import {
  findNativeBenchEntry,
  findTsBenchEntry,
  readNativeBenchEntries,
  readTsBenchEntries,
} from "./report";

const benchCase = process.env.TSGO_REQUIRE_BENCH_REPORTS === "1" ? it : it.skip;

const tsScenarios = [
  "spawn+initialize",
  "parseConfigFile",
  "updateSnapshot warm",
  "getSourceFile",
  "getStringType",
  "typeToString",
  "restrict-plus-operands visitor",
  "require-array-sort-compare visitor",
  "prefer-promise-reject-errors visitor",
  "no-unsafe-assignment visitor",
  "no-unsafe-return visitor",
  "no-base-to-string visitor",
  "prefer-string-starts-ends-with visitor",
] as const;

const nativeScenarios = [
  "spawn_initialize",
  "parse_config",
  "update_snapshot_cold",
  "update_snapshot_warm",
  "default_project",
  "get_source_file",
  "get_string_type",
  "type_to_string",
] as const;

const datasets = ["native-preview", "_extension"] as const;

describe("benchmark guards", () => {
  benchCase("ts benchmarks emit complete metrics", () => {
    const entries = readTsBenchEntries();

    for (const mode of ["msgpack", "jsonrpc"] as const) {
      for (const scenario of tsScenarios) {
        const entry = findTsBenchEntry(entries, mode, scenario);
        expect(entry.sampleCount).toBeGreaterThan(0);
        expect(entry.mean).toBeGreaterThan(0);
        expect(entry.median).toBeGreaterThan(0);
      }
    }
  });

  benchCase("native benchmarks emit complete metrics", () => {
    const entries = readNativeBenchEntries();

    for (const mode of ["msgpack", "jsonrpc"] as const) {
      for (const dataset of datasets) {
        for (const scenario of nativeScenarios) {
          const entry = findNativeBenchEntry(entries, mode, dataset, scenario);
          expect(entry.meanMs).toBeGreaterThan(0);
          expect(entry.medianMs).toBeGreaterThan(0);
          expect(entry.p95Ms).toBeGreaterThan(0);
        }
      }
    }
  });

  benchCase("msgpack stays ahead of jsonrpc within budget", () => {
    const tsEntries = readTsBenchEntries();
    const nativeEntries = readNativeBenchEntries();

    assertBudget(
      findTsBenchEntry(tsEntries, "msgpack", "spawn+initialize").median,
      findTsBenchEntry(tsEntries, "jsonrpc", "spawn+initialize").median,
      1.5,
    );
    assertBudget(
      findTsBenchEntry(tsEntries, "msgpack", "updateSnapshot warm").median,
      findTsBenchEntry(tsEntries, "jsonrpc", "updateSnapshot warm").median,
      1.5,
    );
    assertBudget(
      findTsBenchEntry(tsEntries, "msgpack", "getSourceFile").median,
      findTsBenchEntry(tsEntries, "jsonrpc", "getSourceFile").median,
      1.5,
    );
    assertBudget(
      findTsBenchEntry(tsEntries, "msgpack", "getStringType").median,
      findTsBenchEntry(tsEntries, "jsonrpc", "getStringType").median,
      1.5,
    );
    assertBudget(
      findTsBenchEntry(tsEntries, "msgpack", "typeToString").median,
      findTsBenchEntry(tsEntries, "jsonrpc", "typeToString").median,
      1.5,
    );

    for (const dataset of datasets) {
      for (const scenario of [
        "spawn_initialize",
        "update_snapshot_warm",
        "get_source_file",
        "get_string_type",
        "type_to_string",
      ] as const) {
        assertBudget(
          findNativeBenchEntry(nativeEntries, "msgpack", dataset, scenario).medianMs,
          findNativeBenchEntry(nativeEntries, "jsonrpc", dataset, scenario).medianMs,
          1.5,
        );
      }
    }
  });
});

function assertBudget(fastMedian: number, slowMedian: number, factor: number): void {
  expect(fastMedian).toBeLessThanOrEqual(slowMedian * factor);
}
