import { noopCommand } from "../paths.ts";
import type { RunTasks } from "../task_types.ts";

/** Aggregate and language-specific test tasks used by CI. */
export const testTasks = {
  test: {
    command: noopCommand,
    dependsOn: ["test_rust", "test_ts", "examples_smoke_ci"],
  },
  test_rust: {
    command: "cargo test --workspace",
    dependsOn: ["verify_ref", "build_rust", "build_mock"],
  },
  test_ts: {
    command: "vp test run --config ./vite.config.ts",
    dependsOn: ["build_mock", "build_node_debug"],
  },
  // Runs the wire-dialect contract against the stable TypeScript release
  // installed from npm rather than the pinned beta, which speaks the newer
  // dialect.
  test_released_runtime: {
    cache: false,
    command: "node --strip-types ./scripts/test_released_runtime.ts",
  },
} satisfies RunTasks;
