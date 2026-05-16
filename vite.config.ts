import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite-plus";

const rootDir = dirname(fileURLToPath(import.meta.url));
const nodePackageDir = resolve(rootDir, "src/bindings/nodejs/corsa_node");
const typescriptOxlintDir = resolve(rootDir, "src/bindings/nodejs/typescript_oxlint");
const typescriptOxlintSourceDir = resolve(typescriptOxlintDir, "ts");
const generatedNodeArtifacts = [
  "src/bindings/nodejs/corsa_node/index.d.ts",
  "src/bindings/nodejs/corsa_node/index.js",
  "src/bindings/nodejs/corsa_node/ts/**/*.d.ts",
  "src/bindings/nodejs/corsa_node/ts/**/*.js",
  "src/bindings/nodejs/corsa_node/ts/**/*.js.map",
];
const upstreamRefPatterns = ["origin/**", "ref/**"];
const lintIgnorePatterns = [
  ...generatedNodeArtifacts,
  ...upstreamRefPatterns,
  "bench/fixtures/**",
  "src/bindings/nodejs/corsa_node/ts/**/*.test.ts",
];
const noopCommand = 'node -e "process.exit(0)"';

export default defineConfig({
  fmt: {
    ignorePatterns: [...generatedNodeArtifacts, ...upstreamRefPatterns],
  },
  pack: {
    clean: true,
    deps: {
      neverBundle: ["@corsa-bind/napi"],
      skipNodeModulesBundle: true,
    },
    dts: true,
    entry: [
      "src/bindings/nodejs/typescript_oxlint/ts/**/*.ts",
      "!src/bindings/nodejs/typescript_oxlint/ts/**/*.test.ts",
    ],
    fixedExtension: false,
    format: "esm",
    outDir: resolve(typescriptOxlintDir, "dist"),
    root: typescriptOxlintSourceDir,
    sourcemap: true,
    tsconfig: resolve(typescriptOxlintDir, "tsconfig.json"),
    unbundle: true,
  },
  resolve: {
    alias: {
      "@corsa-bind/napi": resolve(nodePackageDir, "ts/index.ts"),
      "corsa-oxlint/ast-utils": resolve(typescriptOxlintDir, "ts/ast_utils.ts"),
      "corsa-oxlint/compat": resolve(typescriptOxlintDir, "ts/oxlint_compat.ts"),
      "corsa-oxlint/json-schema": resolve(typescriptOxlintDir, "ts/json_schema.ts"),
      "corsa-oxlint/oxlint-utils": resolve(typescriptOxlintDir, "ts/oxlint_utils.ts"),
      "corsa-oxlint/utils": resolve(typescriptOxlintDir, "ts/utils.ts"),
      "corsa-oxlint/rule-tester": resolve(typescriptOxlintDir, "ts/rule_tester.ts"),
      "corsa-oxlint/rules": resolve(typescriptOxlintDir, "ts/rules/index.ts"),
      "corsa-oxlint/ts-estree": resolve(typescriptOxlintDir, "ts/ts_estree.ts"),
      "corsa-oxlint": resolve(typescriptOxlintDir, "ts/index.ts"),
    },
  },
  lint: {
    ignorePatterns: lintIgnorePatterns,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  run: {
    tasks: {
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
        dependsOn: ["build_mock", "build_wrapper", "build_typescript_oxlint"],
      },
      build_ci: {
        command: noopCommand,
        dependsOn: ["build_mock", "build_wrapper_ci", "build_typescript_oxlint_ci"],
      },
      build_rust: {
        command: "cargo build --workspace",
      },
      build_mock: {
        cache: false,
        command: "cargo build -p corsa --bin mock_tsgo",
      },
      build_tsgo: {
        cache: false,
        command: "node --strip-types ./scripts/build_tsgo.ts",
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
      build_typescript_oxlint: {
        cache: false,
        command: "vp pack",
        dependsOn: ["build_wrapper"],
      },
      build_typescript_oxlint_ci: {
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
      test: {
        command: noopCommand,
        dependsOn: ["test_rust", "test_rust_experimental", "test_ts", "examples_smoke"],
      },
      test_rust: {
        command: "cargo test --workspace",
        dependsOn: ["verify_ref"],
      },
      test_rust_experimental: {
        command: "cargo test -p corsa --no-default-features --test orchestrator",
        dependsOn: ["test_rust_experimental_feature"],
      },
      test_rust_experimental_feature: {
        command: "cargo test -p corsa --features experimental-distributed --test orchestrator",
      },
      test_ts: {
        command: "vp test run --config ./vite.config.ts",
        dependsOn: ["build_mock", "build_node_debug"],
      },
      bench: {
        command: noopCommand,
        dependsOn: ["bench_verify", "bench_tooling_compare", "bench_bindings"],
      },
      bench_native: {
        command:
          "cargo run --release -p corsa --bin bench_real_tsgo -- --cold-iterations 5 --warm-iterations 20 --json-output .cache/bench_native.json",
        dependsOn: ["build_tsgo"],
      },
      bench_native_deep: {
        command:
          "cargo run --release -p corsa --bin bench_real_tsgo -- --cold-iterations 10 --warm-iterations 80 --json-output .cache/bench_native_deep.json",
        dependsOn: ["build_tsgo"],
      },
      bench_native_profile: {
        command:
          "cargo run --release -p corsa --bin bench_real_tsgo -- --profile --transport msgpack --cold-iterations 5 --warm-iterations 40 --json-output .cache/bench_native_profile.json",
        dependsOn: ["build_tsgo"],
      },
      bench_tooling_setup: {
        command: noopCommand,
        dependsOn: ["bench_tooling_setup_ref", "bench_tooling_setup_cli_compare"],
      },
      bench_tooling_setup_ref: {
        cache: false,
        command: "npm ci --no-fund --no-audit",
        cwd: "ref/typescript-go",
      },
      bench_tooling_setup_cli_compare: {
        cache: false,
        command: "npm ci --no-fund --no-audit",
        cwd: "bench/cli_compare",
      },
      bench_tooling_compare: {
        command:
          "cargo run --release -p corsa --bin bench_tooling_compare -- --iterations 10 --warmup-iterations 2 --json-output .cache/bench_tooling_compare.json",
        dependsOn: ["build_tsgo", "bench_tooling_setup"],
      },
      bench_bindings: {
        command: "node --strip-types ./scripts/bench_bindings.ts",
        dependsOn: ["build_tsgo"],
      },
      bench_ts: {
        command: "vp test bench --config ./vite.config.ts --outputJson .cache/bench_ts.json",
        dependsOn: ["build_tsgo", "build_node_release"],
      },
      bench_verify: {
        command:
          "TSGO_REQUIRE_BENCH_REPORTS=1 vp test run --config ./vite.config.ts bench/src/report_guard.test.ts",
        dependsOn: ["bench_native", "bench_ts"],
      },
      release_dry_run: {
        command: "node --strip-types ./scripts/release_dry_run.ts",
        dependsOn: ["build"],
      },
      release: {
        cache: false,
        command: "node --strip-types ./scripts/release.ts",
      },
      examples_node_smoke: {
        command: "pnpm run smoke",
        cwd: "examples",
        dependsOn: ["build"],
      },
      examples_node_real: {
        command: "pnpm run real",
        cwd: "examples",
        dependsOn: ["build", "sync_ref", "verify_ref", "build_tsgo"],
      },
      examples_rust_smoke: {
        command: "node --strip-types ./scripts/run_rust_examples.ts smoke",
        dependsOn: ["build_mock"],
      },
      examples_rust_real: {
        command: "node --strip-types ./scripts/run_rust_examples.ts real",
        dependsOn: ["sync_ref", "verify_ref", "build_tsgo"],
      },
      examples_rust_experimental: {
        command: "node --strip-types ./scripts/run_rust_examples.ts experimental",
        dependsOn: ["build_mock"],
      },
      examples_smoke: {
        command: noopCommand,
        dependsOn: ["examples_node_smoke", "examples_rust_smoke"],
      },
      examples_real: {
        command: noopCommand,
        dependsOn: ["examples_node_real", "examples_rust_real"],
      },
    },
  },
  test: {
    environment: "node",
    include: ["bench/src/**/*.test.ts", "src/bindings/nodejs/**/ts/**/*.test.ts"],
    benchmark: {
      include: ["bench/src/**/*.bench.ts"],
      exclude: upstreamRefPatterns,
      includeSamples: true,
    },
  },
});
