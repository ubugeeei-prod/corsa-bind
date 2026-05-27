import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

type BenchRow = {
  readonly language: string;
  readonly scenario: string;
  readonly loopCount: number;
  readonly sampleCount: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
};

type BuiltTarget = {
  readonly language: string;
  readonly executable: string;
};

const workspaceRoot = resolve(import.meta.dirname, "..");
const cacheRoot = resolve(workspaceRoot, ".cache/bench_bindings");
const binRoot = resolve(cacheRoot, "bin");
const ffiLibDir = resolve(workspaceRoot, "target/debug");
const corsaPath = resolve(
  workspaceRoot,
  process.platform === "win32" ? ".cache/corsa.exe" : ".cache/corsa",
);
const optionsJson = JSON.stringify({
  executable: corsaPath,
  cwd: workspaceRoot,
  mode: "msgpack",
});
const warmupRuns = 1;
const timedRuns = 5;

const scenarios = [
  { name: "classify_type_text", loopCount: 50_000 },
  { name: "spawn_initialize", loopCount: 10, extraArg: optionsJson },
] as const;

main();

function main(): void {
  ensureExists(corsaPath, "missing built corsa binary; run `vp run -w build_corsa` first");
  mkdirSync(binRoot, { recursive: true });

  run("cargo", ["build", "-p", "corsa_ffi"], { cwd: workspaceRoot });

  const targets = [buildCTarget(), buildCppTarget(), buildGoTarget(), buildSwiftTarget()];

  const rows: BenchRow[] = [];
  for (const target of targets) {
    for (const scenario of scenarios) {
      const args = [scenario.name, String(scenario.loopCount)];
      if ("extraArg" in scenario) {
        args.push(scenario.extraArg);
      }
      const samples = measure(target.executable, args, {
        env: dynamicLibraryEnv(),
        warmups: warmupRuns,
        iterations: timedRuns,
      });
      rows.push({
        language: target.language,
        scenario: scenario.name,
        loopCount: scenario.loopCount,
        sampleCount: samples.length,
        medianMs: percentile(samples, 0.5),
        p95Ms: percentile(samples, 0.95),
        meanMs: mean(samples),
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
      });
    }
  }

  printRows(rows);
  const outputPath = resolve(workspaceRoot, ".cache/bench_bindings.json");
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        corsaPath,
        ffiLibDir,
        warmupRuns,
        timedRuns,
        rows,
      },
      null,
      2,
    ),
  );
}

function buildCTarget(): BuiltTarget {
  const output = join(binRoot, process.platform === "win32" ? "c-bench.exe" : "c-bench");
  run(
    "clang",
    [
      "-O3",
      resolve(workspaceRoot, "bench/bindings/c/bench.c"),
      "-I",
      resolve(workspaceRoot, "src/bindings/c/corsa_ffi/include"),
      "-L",
      ffiLibDir,
      "-lcorsa_ffi",
      "-o",
      output,
    ],
    { cwd: workspaceRoot },
  );
  return { language: "c", executable: output };
}

function buildCppTarget(): BuiltTarget {
  const output = join(binRoot, process.platform === "win32" ? "cpp-bench.exe" : "cpp-bench");
  run(
    "clang++",
    [
      "-std=c++20",
      "-O3",
      resolve(workspaceRoot, "bench/bindings/cpp/bench.cpp"),
      "-I",
      resolve(workspaceRoot, "src/bindings/c/corsa_ffi/include"),
      "-L",
      ffiLibDir,
      "-lcorsa_ffi",
      "-o",
      output,
    ],
    { cwd: workspaceRoot },
  );
  return { language: "cpp", executable: output };
}

function buildGoTarget(): BuiltTarget {
  const output = join(binRoot, process.platform === "win32" ? "go-bench.exe" : "go-bench");
  run("go", ["build", "-o", output, "./cmd/bench"], {
    cwd: resolve(workspaceRoot, "src/bindings/go/corsa_utils"),
    env: dynamicLibraryEnv(),
  });
  return { language: "go", executable: output };
}

function buildSwiftTarget(): BuiltTarget {
  const cwd = resolve(workspaceRoot, "src/bindings/swift/CorsaUtils");
  run("swift", ["build", "-c", "release", "--product", "CorsaUtilsBench"], {
    cwd,
    env: dynamicLibraryEnv(),
  });
  const binPath = capture("swift", ["build", "--show-bin-path", "-c", "release"], {
    cwd,
    env: dynamicLibraryEnv(),
  }).trim();
  return {
    language: "swift",
    executable: join(
      binPath,
      process.platform === "win32" ? "CorsaUtilsBench.exe" : "CorsaUtilsBench",
    ),
  };
}

function measure(
  executable: string,
  args: string[],
  options: {
    readonly env: NodeJS.ProcessEnv;
    readonly warmups: number;
    readonly iterations: number;
  },
): number[] {
  for (let index = 0; index < options.warmups; index += 1) {
    run(executable, args, { cwd: workspaceRoot, env: options.env });
  }
  const samples: number[] = [];
  for (let index = 0; index < options.iterations; index += 1) {
    const started = performance.now();
    run(executable, args, { cwd: workspaceRoot, env: options.env });
    samples.push(performance.now() - started);
  }
  return samples;
}

function dynamicLibraryEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform === "darwin") {
    env.DYLD_LIBRARY_PATH = prependPath(env.DYLD_LIBRARY_PATH, ffiLibDir);
  } else if (process.platform !== "win32") {
    env.LD_LIBRARY_PATH = prependPath(env.LD_LIBRARY_PATH, ffiLibDir);
  }
  return env;
}

function prependPath(current: string | undefined, next: string): string {
  return current && current.length > 0 ? `${next}:${current}` : next;
}

function run(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stderr}${result.stdout}`,
    );
  }
}

function capture(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
  },
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout;
}

function ensureExists(path: string, message: string): void {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function printRows(rows: readonly BenchRow[]): void {
  console.log("language\tscenario\tloops\tsamples\tmedian_ms\tp95_ms\tmean_ms\tmin_ms\tmax_ms");
  for (const row of rows) {
    console.log(
      [
        row.language,
        row.scenario,
        row.loopCount,
        row.sampleCount,
        row.medianMs.toFixed(3),
        row.p95Ms.toFixed(3),
        row.meanMs.toFixed(3),
        row.minMs.toFixed(3),
        row.maxMs.toFixed(3),
      ].join("\t"),
    );
  }
}
