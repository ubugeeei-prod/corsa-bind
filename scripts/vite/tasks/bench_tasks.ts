import { noopCommand } from "../paths.ts";
import type { RunTasks } from "../task_types.ts";

/** Native, TypeScript, and cross-tooling benchmark tasks. */
export const benchTasks = {
  bench: {
    command: noopCommand,
    dependsOn: ["bench_verify", "bench_tooling_compare", "bench_bindings"],
  },
  bench_native: {
    command:
      "cargo run --release -p corsa --bin bench_real_corsa -- --cold-iterations 5 --warm-iterations 20 --json-output .cache/bench_native.json",
    dependsOn: ["build_corsa"],
  },
  bench_native_deep: {
    command:
      "cargo run --release -p corsa --bin bench_real_corsa -- --cold-iterations 10 --warm-iterations 80 --json-output .cache/bench_native_deep.json",
    dependsOn: ["build_corsa"],
  },
  bench_native_profile: {
    command:
      "cargo run --release -p corsa --bin bench_real_corsa -- --profile --transport msgpack --cold-iterations 5 --warm-iterations 40 --json-output .cache/bench_native_profile.json",
    dependsOn: ["build_corsa"],
  },
  bench_tooling_setup: {
    command: noopCommand,
    dependsOn: ["bench_tooling_setup_ref", "bench_tooling_setup_cli_compare"],
  },
  bench_tooling_setup_ref: {
    cache: false,
    command: "npm ci --no-fund --no-audit",
    cwd: "ref/corsa-upstream",
  },
  bench_tooling_setup_cli_compare: {
    cache: false,
    command: "npm ci --no-fund --no-audit",
    cwd: "bench/cli_compare",
  },
  bench_tooling_compare: {
    command:
      "cargo run --release -p corsa --bin bench_tooling_compare -- --iterations 10 --warmup-iterations 2 --json-output .cache/bench_tooling_compare.json",
    dependsOn: ["build_corsa", "build_corsa_oxlint", "bench_tooling_setup"],
  },
  bench_bindings: {
    command: "node --strip-types ./scripts/bench_bindings.ts",
    dependsOn: ["build_corsa"],
  },
  bench_ts: {
    command: "vp test bench --config ./vite.config.ts --outputJson .cache/bench_ts.json",
    dependsOn: ["build_corsa", "build_node_release"],
  },
  bench_verify: {
    command:
      "CORSA_REQUIRE_BENCH_REPORTS=1 vp test run --config ./vite.config.ts bench/src/report_guard.test.ts",
    dependsOn: ["bench_native", "bench_ts"],
  },
} satisfies RunTasks;
