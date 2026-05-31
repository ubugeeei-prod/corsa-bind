// Throughput comparison: the native corsa stylistic engine (Rust) vs the real
// upstream `@stylistic` ESLint plugin (JS), on the SAME corpus and the SAME
// rule set.
//
//   node bench/stylistic/compare.mjs [--corpus <dir>] [--iterations 50]
//
// The corsa side is timed by the `bench_stylistic_compare` Rust binary; the
// `@stylistic` side is timed here through ESLint's Linter. Both run only the
// rules that corsa implements AND `@stylistic` ships, so the workloads match.
//
// `@stylistic` + `eslint` + `@typescript-eslint/parser` are bootstrapped into
// `.cache/bench_stylistic/` on first run (mirrors the differential oracle), so
// no committed node_modules and no workspace install are required.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1];
};
const corpusDir = join(root, arg("--corpus", "src/bindings/nodejs/corsa_oxlint/ts"));
const iterations = Number(arg("--iterations", "50"));

/** Installs the comparison toolchain into an isolated, git-ignored prefix. */
function ensureUpstream() {
  const dir = join(root, ".cache", "bench_stylistic");
  const stylistic = join(dir, "node_modules", "@stylistic", "eslint-plugin");
  if (!existsSync(stylistic)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), '{"name":"bench-stylistic","private":true}\n');
    console.error("installing @stylistic toolchain into .cache/bench_stylistic …");
    execFileSync(
      "npm",
      [
        "install",
        "--no-audit",
        "--no-fund",
        "@stylistic/eslint-plugin",
        "eslint",
        "@typescript-eslint/parser",
      ],
      { cwd: dir, stdio: "inherit" },
    );
  }
  return createRequire(join(dir, "noop.js"));
}

function readCorpus(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        files.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(dir);
  return files;
}

function quantile(sorted, q) {
  return sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)];
}

const require = ensureUpstream();
const { Linter } = require("eslint");
const stylistic =
  require("@stylistic/eslint-plugin").default ?? require("@stylistic/eslint-plugin");
const tsParser =
  require("@typescript-eslint/parser").default ?? require("@typescript-eslint/parser");

// Rule set = corsa's implemented rules ∩ @stylistic's shipped rules.
const corsaRules = JSON.parse(
  execFileSync(
    "cargo",
    [
      "run",
      "--release",
      "-q",
      "-p",
      "corsa",
      "--bin",
      "bench_stylistic_compare",
      "--",
      "--list-rules",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim(),
);
const sharedRules = corsaRules.filter((name) => stylistic.rules[name]);

const sources = readCorpus(corpusDir);
const bytes = sources.reduce((sum, source) => sum + Buffer.byteLength(source), 0);

// ---- upstream @stylistic side ------------------------------------------------
const linter = new Linter();
const config = [
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    plugins: { "@stylistic": stylistic },
    rules: Object.fromEntries(sharedRules.map((name) => [`@stylistic/${name}`, "error"])),
  },
];
const lintAll = () => {
  let total = 0;
  for (const source of sources)
    total += linter.verify(source, config, { filename: "file.tsx" }).length;
  return total;
};
const upstreamDiagnostics = lintAll(); // warm-up + diagnostic count
const upstreamSamples = [];
for (let i = 0; i < iterations; i++) {
  const start = performance.now();
  lintAll();
  upstreamSamples.push(performance.now() - start);
}
upstreamSamples.sort((a, b) => a - b);
const upstreamMedian = quantile(upstreamSamples, 0.5);
const mb = bytes / (1024 * 1024);
const upstream = {
  engine: "@stylistic",
  files: sources.length,
  bytes,
  rules: sharedRules.length,
  iterations,
  diagnostics: upstreamDiagnostics,
  medianMs: Number(upstreamMedian.toFixed(3)),
  p95Ms: Number(quantile(upstreamSamples, 0.95).toFixed(3)),
  mbPerSec: Number((mb / (upstreamMedian / 1000)).toFixed(3)),
};

// ---- native corsa side -------------------------------------------------------
const corsa = JSON.parse(
  execFileSync(
    "cargo",
    [
      "run",
      "--release",
      "-q",
      "-p",
      "corsa",
      "--bin",
      "bench_stylistic_compare",
      "--",
      "--corpus",
      corpusDir,
      "--iterations",
      String(iterations),
      "--rules",
      sharedRules.join(","),
    ],
    { cwd: root, encoding: "utf8" },
  ).trim(),
);

// ---- report ------------------------------------------------------------------
const speedup = upstream.medianMs / corsa.medianMs;
const report = {
  corpus: corpusDir,
  rules: sharedRules.length,
  corsa,
  upstream,
  speedup: Number(speedup.toFixed(1)),
};
mkdirSync(join(root, ".cache"), { recursive: true });
writeFileSync(join(root, ".cache", "bench_stylistic.json"), JSON.stringify(report, null, 2) + "\n");

const pad = (value, width) => String(value).padStart(width);
console.log(
  `\nstylistic throughput — ${corsa.files} files, ${(bytes / 1024).toFixed(0)} KB, ${sharedRules.length} rules, ${iterations} iters`,
);
console.log("  engine        median ms    p95 ms    MB/s    diagnostics");
for (const row of [corsa, upstream]) {
  console.log(
    `  ${row.engine.padEnd(12)} ${pad(row.medianMs, 9)} ${pad(row.p95Ms, 9)} ${pad(row.mbPerSec, 7)} ${pad(row.diagnostics, 14)}`,
  );
}
console.log(`\n  corsa is ${speedup.toFixed(1)}× faster than @stylistic on this workload.`);
console.log("  wrote .cache/bench_stylistic.json");
