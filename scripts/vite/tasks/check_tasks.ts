import { noopCommand } from "../paths.ts";
import type { RunTasks } from "../task_types.ts";

/** Formatting, linting, and JavaScript-runtime compatibility checks. */
export const checkTasks = {
  check_js_runtime_compat: {
    command: noopCommand,
    dependsOn: ["check_js_runtime_compat_bun", "check_js_runtime_compat_deno"],
  },
  check_js_runtime_compat_bun: {
    command: "bun run ./runtime_compat.ts",
    cwd: "examples",
    dependsOn: ["build_wrapper_ci"],
  },
  check_js_runtime_compat_deno: {
    command:
      "deno run --node-modules-dir=manual --allow-ffi --allow-read --allow-env --allow-run ./runtime_compat.ts",
    cwd: "examples",
    dependsOn: ["build_wrapper_ci"],
  },
  lint_rust: {
    command: "cargo clippy --workspace --all-targets -- -D warnings",
  },
  fmt_rust: {
    cache: false,
    command: "cargo fmt --all",
  },
  fmt_check_rust: {
    command: "cargo fmt --all --check",
  },
} satisfies RunTasks;
