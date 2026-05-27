import { noopCommand } from "../paths.ts";
import type { RunTasks } from "../task_types.ts";

/** Aggregate and language-specific test tasks used by CI. */
export const testTasks = {
  test: {
    command: noopCommand,
    dependsOn: ["test_rust", "test_rust_experimental", "test_ts", "examples_smoke_ci"],
  },
  test_rust: {
    command: "cargo test --workspace",
    dependsOn: ["verify_ref", "build_rust", "build_mock"],
  },
  test_rust_experimental: {
    command: "cargo test -p corsa --no-default-features --test orchestrator",
    dependsOn: ["test_rust_experimental_feature"],
  },
  test_rust_experimental_feature: {
    command: "cargo test -p corsa --features experimental-distributed --test orchestrator",
    dependsOn: ["build_mock"],
  },
  test_ts: {
    command: "vp test run --config ./vite.config.ts",
    dependsOn: ["build_mock", "build_node_debug"],
  },
} satisfies RunTasks;
