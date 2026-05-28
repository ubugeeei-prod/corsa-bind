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
  // These two cargo invocations use non-default feature flags, so cargo would
  // rebuild the `corsa` crate (and its `mock_corsa` bin) in the shared `target/`
  // directory. On Windows that races with concurrent consumers of
  // `target/debug/mock_corsa.exe` (vitest in `test_ts`, integration tests in
  // `test_rust`, `examples_rust_smoke`, ...) and fails with
  // `failed to remove file ... Access is denied. (os error 5)`.
  // Isolate each feature combo in its own target dir so the shared
  // `target/debug/mock_corsa.exe` is never re-linked while another process is
  // holding it open.
  test_rust_experimental: {
    command:
      "cargo test -p corsa --no-default-features --test orchestrator --target-dir .cache/test-target-no-default",
    dependsOn: ["test_rust_experimental_feature"],
  },
  test_rust_experimental_feature: {
    command:
      "cargo test -p corsa --features experimental-distributed --test orchestrator --target-dir .cache/test-target-experimental",
  },
  test_ts: {
    command: "vp test run --config ./vite.config.ts",
    dependsOn: ["build_mock", "build_node_debug"],
  },
} satisfies RunTasks;
