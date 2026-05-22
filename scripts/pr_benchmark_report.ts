import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

type BranchRole = "base" | "head";

type RawBenchRow = {
  readonly workload: string;
  readonly dataset: string;
  readonly tool: string;
  readonly sampleCount: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
};

type RawBenchReport = {
  readonly iterations: number;
  readonly warmupIterations: number;
  readonly timeoutMs: number;
  readonly rows?: readonly RawBenchRow[];
};

export type CapturedBenchReport = {
  readonly schemaVersion: 1;
  readonly branchRole: BranchRole;
  readonly refName: string;
  readonly sha: string;
  readonly typescript: {
    readonly major: string;
    readonly requested: string;
    readonly installed: string;
  };
  readonly github: {
    readonly runId: string;
    readonly runAttempt: string;
  };
  readonly report: RawBenchReport;
};

type ComparisonRow = {
  readonly workload: string;
  readonly dataset: string;
  readonly tool: string;
  readonly sampleCount: number;
  readonly baseMeanMs: number;
  readonly headMeanMs: number;
  readonly deltaMs: number;
  readonly deltaPercent: number;
  readonly result: "faster" | "slower" | "stable";
};

type TypeScriptComparison = {
  readonly major: string;
  readonly requested: string;
  readonly base: CapturedBenchReport;
  readonly head: CapturedBenchReport;
  readonly rows: readonly ComparisonRow[];
  readonly geometricMeanDeltaPercent: number;
  readonly fasterCount: number;
  readonly slowerCount: number;
  readonly stableCount: number;
};

const marker = "<!-- corsa-pr-performance-benchmark -->";
const significantDeltaPercent = 3;

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "capture") {
    captureReport(parseOptions(args));
    return;
  }
  if (command === "comment") {
    await writeComment(parseOptions(args));
    return;
  }
  throw new Error("usage: pr_benchmark_report.ts capture|comment [options]");
}

function captureReport(options: ReadonlyMap<string, string>): void {
  const input = requiredOption(options, "input");
  const output = requiredOption(options, "output");
  const report = JSON.parse(readFileSync(input, "utf8")) as RawBenchReport;
  const captured: CapturedBenchReport = {
    schemaVersion: 1,
    branchRole: parseBranchRole(requiredOption(options, "branch-role")),
    refName: requiredOption(options, "ref-name"),
    sha: requiredOption(options, "sha"),
    typescript: {
      major: requiredOption(options, "typescript-major"),
      requested: requiredOption(options, "typescript-requested"),
      installed: requiredOption(options, "typescript-version"),
    },
    github: {
      runId: process.env.GITHUB_RUN_ID ?? "",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "",
    },
    report,
  };
  writeFileSync(output, `${JSON.stringify(captured, null, 2)}\n`);
}

async function writeComment(options: ReadonlyMap<string, string>): Promise<void> {
  const reportsDir = requiredOption(options, "reports-dir");
  const output = options.get("output");
  const reports = readCapturedReports(reportsDir);
  const body = createCommentBody(reports);
  if (output) {
    writeFileSync(output, body);
  }
  if (options.has("post-comment")) {
    await postStickyComment(body);
  }
}

export function createCommentBody(reports: readonly CapturedBenchReport[]): string {
  const comparisons = compareReports(reports);
  const lines = [
    marker,
    "## PR Performance Benchmark",
    "",
    "Lower is better. Each row compares the 5-sample mean from the PR branch against the base branch.",
    `Changes within +/-${significantDeltaPercent}% are marked as stable to avoid over-reading benchmark noise.`,
    "",
  ];
  if (comparisons.length === 0) {
    lines.push("No complete base/head benchmark pairs were found.");
    return `${lines.join("\n")}\n`;
  }
  lines.push("### Summary", "");
  lines.push("| TypeScript | Base | PR | Geomean change | Faster | Slower | Stable |");
  lines.push("| --- | --- | --- | ---: | ---: | ---: | ---: |");
  for (const comparison of comparisons) {
    lines.push(
      [
        `TS v${comparison.major} (${comparison.base.typescript.installed})`,
        shortRef(comparison.base),
        shortRef(comparison.head),
        formatSignedPercent(comparison.geometricMeanDeltaPercent),
        String(comparison.fasterCount),
        String(comparison.slowerCount),
        String(comparison.stableCount),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  for (const comparison of comparisons) {
    lines.push(
      "",
      `<details>`,
      `<summary>TS v${comparison.major} full benchmark rows</summary>`,
      "",
    );
    lines.push("| Workload | Dataset | Tool | Base mean | PR mean | Change | Result | Samples |");
    lines.push("| --- | --- | --- | ---: | ---: | ---: | --- | ---: |");
    for (const row of comparison.rows) {
      lines.push(
        [
          row.workload,
          row.dataset,
          row.tool,
          formatMs(row.baseMeanMs),
          formatMs(row.headMeanMs),
          formatSignedPercent(row.deltaPercent),
          row.result,
          String(row.sampleCount),
        ]
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
    lines.push("", "</details>");
  }
  lines.push("", "_Generated by `.github/workflows/pr-performance.yml`._");
  return `${lines.join("\n")}\n`;
}

export function compareReports(
  reports: readonly CapturedBenchReport[],
): readonly TypeScriptComparison[] {
  const byMajor = new Map<string, CapturedBenchReport[]>();
  for (const report of reports) {
    const items = byMajor.get(report.typescript.major) ?? [];
    items.push(report);
    byMajor.set(report.typescript.major, items);
  }
  return [...byMajor.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .flatMap(([major, items]) => {
      const base = items.find((item) => item.branchRole === "base");
      const head = items.find((item) => item.branchRole === "head");
      if (!base || !head) {
        return [];
      }
      const rows = compareRows(base.report.rows ?? [], head.report.rows ?? []);
      const fasterCount = rows.filter((row) => row.result === "faster").length;
      const slowerCount = rows.filter((row) => row.result === "slower").length;
      return [
        {
          major,
          requested: head.typescript.requested,
          base,
          head,
          rows,
          geometricMeanDeltaPercent: geometricMeanDelta(rows),
          fasterCount,
          slowerCount,
          stableCount: rows.length - fasterCount - slowerCount,
        },
      ];
    });
}

function compareRows(
  baseRows: readonly RawBenchRow[],
  headRows: readonly RawBenchRow[],
): readonly ComparisonRow[] {
  const baseByKey = new Map(baseRows.map((row) => [rowKey(row), row]));
  return headRows
    .flatMap((head) => {
      const base = baseByKey.get(rowKey(head));
      if (!base || base.meanMs <= 0 || head.meanMs <= 0) {
        return [];
      }
      const deltaMs = head.meanMs - base.meanMs;
      const deltaPercent = (deltaMs / base.meanMs) * 100;
      return [
        {
          workload: head.workload,
          dataset: head.dataset,
          tool: head.tool,
          sampleCount: Math.min(base.sampleCount, head.sampleCount),
          baseMeanMs: base.meanMs,
          headMeanMs: head.meanMs,
          deltaMs,
          deltaPercent,
          result: classify(deltaPercent),
        },
      ];
    })
    .sort((left, right) => {
      return (
        left.workload.localeCompare(right.workload) ||
        left.dataset.localeCompare(right.dataset) ||
        left.tool.localeCompare(right.tool)
      );
    });
}

function classify(deltaPercent: number): ComparisonRow["result"] {
  if (Math.abs(deltaPercent) < significantDeltaPercent) {
    return "stable";
  }
  return deltaPercent < 0 ? "faster" : "slower";
}

function geometricMeanDelta(rows: readonly ComparisonRow[]): number {
  const ratios = rows
    .filter((row) => row.baseMeanMs > 0 && row.headMeanMs > 0)
    .map((row) => row.headMeanMs / row.baseMeanMs);
  if (ratios.length === 0) {
    return 0;
  }
  const meanLog = ratios.reduce((total, ratio) => total + Math.log(ratio), 0) / ratios.length;
  return (Math.exp(meanLog) - 1) * 100;
}

function readCapturedReports(dir: string): readonly CapturedBenchReport[] {
  const reports: CapturedBenchReport[] = [];
  for (const file of readJsonFiles(dir)) {
    const value = JSON.parse(readFileSync(file, "utf8")) as CapturedBenchReport;
    if (value.schemaVersion === 1 && value.report?.rows) {
      reports.push(value);
    }
  }
  return reports;
}

function readJsonFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return readJsonFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
  });
}

async function postStickyComment(body: string): Promise<void> {
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const token = requiredEnv("GITHUB_TOKEN");
  const prNumber = requiredEnv("PR_NUMBER");
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`invalid GITHUB_REPOSITORY: ${repository}`);
  }
  const existing = await githubRequest<readonly { id: number; body?: string }[]>(
    token,
    "GET",
    `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
  );
  const previous = existing.find((comment) => comment.body?.includes(marker));
  if (previous) {
    await githubRequest(token, "PATCH", `/repos/${owner}/${repo}/issues/comments/${previous.id}`, {
      body,
    });
    return;
  }
  await githubRequest(token, "POST", `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    body,
  });
}

async function githubRequest<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${text}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function rowKey(row: Pick<RawBenchRow, "workload" | "dataset" | "tool">): string {
  return `${row.workload}\u0000${row.dataset}\u0000${row.tool}`;
}

function shortRef(report: CapturedBenchReport): string {
  return `${report.refName} (${report.sha.slice(0, 7)})`;
}

function formatMs(value: number): string {
  return `${value.toFixed(3)} ms`;
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function parseBranchRole(value: string): BranchRole {
  if (value === "base" || value === "head") {
    return value;
  }
  throw new Error(`invalid branch role: ${value}`);
}

function parseOptions(args: readonly string[]): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (!name?.startsWith("--")) {
      throw new Error(`expected option, got ${name ?? "<end>"}`);
    }
    const key = name.slice(2);
    if (key === "post-comment") {
      options.set(key, "1");
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${name}`);
    }
    options.set(key, value);
    index += 1;
  }
  return options;
}

function requiredOption(options: ReadonlyMap<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) {
    throw new Error(`missing --${key}`);
  }
  return value;
}

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`missing ${key}`);
  }
  return value;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${basename(process.argv[1] ?? "pr_benchmark_report.ts")}: ${message}`);
    process.exitCode = 1;
  });
}
