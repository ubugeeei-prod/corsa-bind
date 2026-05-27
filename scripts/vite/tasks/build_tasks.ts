import { noopCommand } from "../paths.ts";
import type { RunTasks } from "../task_types.ts";

/** Build and upstream-sync tasks for Rust, napi, and bundled JS packages. */
export const buildTasks = {
  sync_ref: {
    cache: false,
    command: "cargo run -p corsa_ref --target-dir .cache/corsa-ref-target -- sync",
  },
  verify_ref: {
    command: "cargo run -p corsa_ref --target-dir .cache/corsa-ref-target -- verify",
    dependsOn: ["sync_ref"],
  },
  build: {
    command: noopCommand,
    dependsOn: ["build_mock", "build_wrapper", "build_corsa_oxlint"],
  },
  build_ci: {
    command: noopCommand,
    dependsOn: ["build_mock", "build_wrapper_ci", "build_corsa_oxlint_ci"],
  },
  build_rust: {
    command: "cargo build --workspace",
  },
  build_mock: {
    cache: false,
    command: "cargo build -p corsa --bin mock_corsa",
  },
  build_corsa: {
    cache: false,
    command: "node --strip-types ./scripts/build_corsa.ts",
    dependsOn: ["verify_ref"],
  },
  build_node_debug: {
    cache: false,
    command: "napi build --platform",
    cwd: "src/bindings/nodejs/corsa_node",
    dependsOn: ["build_rust"],
  },
  build_node_release: {
    cache: false,
    command: "napi build --platform --release",
    cwd: "src/bindings/nodejs/corsa_node",
    dependsOn: ["build_rust"],
  },
  build_corsa_oxlint: {
    cache: false,
    command: "vp pack",
    dependsOn: ["build_wrapper"],
  },
  build_corsa_oxlint_ci: {
    cache: false,
    command: "vp pack",
    dependsOn: ["build_wrapper_ci"],
  },
  build_wrapper: {
    cache: false,
    command:
      "vp pack index.ts types.ts --dts --format esm --out-dir ../dist --sourcemap --tsconfig ../tsconfig.json --root . --deps.neverBundle ../index.js",
    cwd: "src/bindings/nodejs/corsa_node/ts",
    dependsOn: ["build_node_release"],
  },
  build_wrapper_ci: {
    cache: false,
    command:
      "vp pack index.ts types.ts --dts --format esm --out-dir ../dist --sourcemap --tsconfig ../tsconfig.json --root . --deps.neverBundle ../index.js",
    cwd: "src/bindings/nodejs/corsa_node/ts",
    dependsOn: ["build_node_debug"],
  },
} satisfies RunTasks;
