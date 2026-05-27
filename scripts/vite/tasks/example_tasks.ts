import { noopCommand } from "../paths.ts";
import type { RunTasks } from "../task_types.ts";

/** Executable example tasks for Node, Rust, real-upstream, and experimental flows. */
export const exampleTasks = {
  examples_node_smoke: {
    command: "pnpm run smoke",
    cwd: "examples",
    dependsOn: ["build"],
  },
  examples_node_smoke_ci: {
    command: "pnpm run smoke",
    cwd: "examples",
    dependsOn: ["build_ci"],
  },
  examples_node_real: {
    command: "pnpm run real",
    cwd: "examples",
    dependsOn: ["build", "sync_ref", "verify_ref", "build_corsa"],
  },
  examples_rust_smoke: {
    command: "node --strip-types ./scripts/run_rust_examples.ts smoke",
    dependsOn: ["build_mock"],
  },
  examples_rust_real: {
    command: "node --strip-types ./scripts/run_rust_examples.ts real",
    dependsOn: ["sync_ref", "verify_ref", "build_corsa"],
  },
  examples_rust_experimental: {
    command: "node --strip-types ./scripts/run_rust_examples.ts experimental",
    dependsOn: ["build_mock"],
  },
  examples_smoke: {
    command: noopCommand,
    dependsOn: ["examples_node_smoke", "examples_rust_smoke"],
  },
  examples_smoke_ci: {
    command: noopCommand,
    dependsOn: ["examples_node_smoke_ci", "examples_rust_smoke"],
  },
  examples_real: {
    command: noopCommand,
    dependsOn: ["examples_node_real", "examples_rust_real"],
  },
} satisfies RunTasks;
