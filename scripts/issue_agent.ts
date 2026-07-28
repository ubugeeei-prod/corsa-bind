import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { fail, rootDir } from "./shared.ts";

type Mode = "run" | "watch";

interface Options {
  readonly autoMerge: boolean;
  readonly baseBranch?: string;
  readonly draft: boolean;
  readonly issueNumber?: number;
  readonly limit: number;
  readonly mode: Mode;
  readonly model?: string;
  readonly noWaitCi: boolean;
  readonly once: boolean;
  readonly pollSeconds: number;
  readonly repo?: string;
  readonly stateFile: string;
}

interface Issue {
  readonly author: { readonly login: string };
  readonly body?: string | null;
  readonly labels: readonly ({ readonly name: string } | string)[];
  readonly number: number;
  readonly state: "OPEN" | "CLOSED";
  readonly title: string;
  readonly updatedAt?: string;
  readonly url: string;
}

interface RepoInfo {
  readonly defaultBranchRef: { readonly name: string };
  readonly nameWithOwner: string;
}

interface StateEntry {
  readonly branch?: string;
  readonly prUrl?: string;
  readonly status: "failed" | "no_changes" | "pr";
  readonly title: string;
  readonly updatedAt: string;
}

interface StateFile {
  readonly processed: Record<string, StateEntry>;
}

const conventionalTitlePattern =
  /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([A-Za-z0-9._/-]+\))?!?: .+/;

function usage(): never {
  console.error(`Usage:
  node --strip-types ./scripts/issue_agent.ts run --issue <number> [--repo owner/name]
  node --strip-types ./scripts/issue_agent.ts watch [--repo owner/name] [--poll-seconds 60] [--once]

Options:
  --draft                 Open a draft PR and skip auto-merge.
  --base <branch>          Base branch. Defaults to the repository default branch.
  --limit <n>              Max open issues to inspect per poll. Default: 50.
  --model <model>          Model passed to codex exec.
  --no-auto-merge         Do not enable squash auto-merge on ready PRs.
  --no-wait-ci            Do not wait for pull request checks after creating a PR.
  --state-file <path>     Processed issue state. Default: .cache/issue-agent/state.json.
`);
  process.exit(2);
}

function parseArgs(args: readonly string[]): Options {
  const [modeArg, ...rest] = args;
  if (modeArg !== "run" && modeArg !== "watch") {
    usage();
  }

  let issueNumber: number | undefined;
  let autoMerge = true;
  let baseBranch: string | undefined;
  let draft = false;
  let limit = 50;
  let model: string | undefined;
  let noWaitCi = false;
  let once = false;
  let pollSeconds = 60;
  let repo: string | undefined;
  let stateFile = ".cache/issue-agent/state.json";

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const readValue = (): string => {
      const value = rest[index + 1];
      if (!value) {
        usage();
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--draft":
        draft = true;
        break;
      case "--base":
        baseBranch = readValue();
        break;
      case "--issue":
        issueNumber = Number(readValue());
        if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
          usage();
        }
        break;
      case "--limit":
        limit = Number(readValue());
        if (!Number.isInteger(limit) || limit <= 0) {
          usage();
        }
        break;
      case "--model":
        model = readValue();
        break;
      case "--no-auto-merge":
        autoMerge = false;
        break;
      case "--no-draft":
        draft = false;
        break;
      case "--no-wait-ci":
        noWaitCi = true;
        break;
      case "--once":
        once = true;
        break;
      case "--poll-seconds":
        pollSeconds = Number(readValue());
        if (!Number.isInteger(pollSeconds) || pollSeconds <= 0) {
          usage();
        }
        break;
      case "--repo":
        repo = readValue();
        break;
      case "--state-file":
        stateFile = readValue();
        break;
      default:
        usage();
    }
  }

  if (modeArg === "run" && !issueNumber) {
    usage();
  }

  return {
    autoMerge,
    baseBranch,
    draft,
    issueNumber,
    limit,
    mode: modeArg,
    model,
    noWaitCi,
    once,
    pollSeconds,
    repo,
    stateFile,
  };
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { readonly input?: string; readonly stdio?: "inherit" | "pipe" } = {},
): { readonly status: number; readonly stdout: string; readonly stderr: string } {
  const stdio: SpawnSyncOptions["stdio"] =
    options.stdio === "inherit"
      ? options.input
        ? ["pipe", "inherit", "inherit"]
        : "inherit"
      : "pipe";
  const result = spawnSync(command, [...args], {
    cwd: rootDir,
    encoding: "utf8",
    input: options.input,
    stdio,
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  return { status: result.status ?? 1, stderr, stdout };
}

function checked(command: string, args: readonly string[], input?: string): string {
  const result = runCommand(command, args, { input });
  if (result.status !== 0) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(`Command failed: ${command} ${args.join(" ")}${output ? `\n${output}` : ""}`);
  }
  return result.stdout;
}

function requireCommand(command: string): void {
  checked("sh", ["-c", `command -v ${command} >/dev/null 2>&1`]);
}

function readJson<T>(command: string, args: readonly string[]): T {
  return JSON.parse(checked(command, args)) as T;
}

function loadState(path: string): StateFile {
  if (!existsSync(path)) {
    return { processed: {} };
  }
  return JSON.parse(readFileSync(path, "utf8")) as StateFile;
}

function writeState(path: string, state: StateFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function labelNames(issue: Issue): readonly string[] {
  return issue.labels.map((label) => (typeof label === "string" ? label : label.name));
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || "task"
  );
}

function inferTitle(issue: Issue, titleFile: string): string {
  const labels = new Set(labelNames(issue));
  let title = existsSync(titleFile)
    ? readFileSync(titleFile, "utf8").split(/\r?\n/, 1)[0]?.trim()
    : "";

  if (!title) {
    const normalizedIssueTitle = issue.title.replace(/\s+/g, " ").trim();
    if (conventionalTitlePattern.test(normalizedIssueTitle)) {
      title = normalizedIssueTitle;
    } else {
      const type = labels.has("bug")
        ? "fix"
        : labels.has("documentation") || labels.has("docs")
          ? "docs"
          : labels.has("enhancement") || labels.has("feature")
            ? "feat"
            : "chore";
      const summary =
        normalizedIssueTitle.replace(/^[a-z]+:\s*/i, "").trim() || `address issue #${issue.number}`;
      title = `${type}: ${summary}`;
    }
  }

  title = title.replace(/\[codex\]\s*/gi, "").trim();
  if (!conventionalTitlePattern.test(title)) {
    title = `chore: address issue #${issue.number}`;
  }
  return title.length > 120 ? `${title.slice(0, 117).trimEnd()}...` : title;
}

function bodyForIssue(issue: Issue, bodyFile: string, prTitle: string): string {
  const body = existsSync(bodyFile)
    ? readFileSync(bodyFile, "utf8")
    : `## Summary

- Implements #${issue.number} with the local issue agent.

## Validation

- [ ] Local issue agent did not provide validation details.
- [ ] CI status is checked after PR creation.

## Checklist

- [ ] Scope is limited to the described change
- [ ] Documentation or templates were updated when needed
- [ ] Follow-up work is tracked in an issue
`;

  const closingLine = `Closes #${issue.number}`;
  const withClose = new RegExp(`(Closes|Fixes|Resolves) #${issue.number}`).test(body)
    ? body
    : `${body.trimEnd()}\n\n${closingLine}\n`;
  return `${withClose.trimEnd()}\n\nIssue: ${issue.url}\nPR title: ${prTitle}\n`;
}

function gitIsClean(): boolean {
  return checked("git", ["status", "--porcelain=v1"]).trim() === "";
}

function gitHasChanges(): boolean {
  return checked("git", ["status", "--porcelain=v1", "--untracked-files=all"]).trim() !== "";
}

function repoInfo(options: Options): RepoInfo {
  return readJson<RepoInfo>("gh", [
    "repo",
    "view",
    ...(options.repo ? [options.repo] : []),
    "--json",
    "nameWithOwner,defaultBranchRef",
  ]);
}

function issueView(repo: string, issueNumber: number): Issue {
  return readJson<Issue>("gh", [
    "issue",
    "view",
    String(issueNumber),
    "--repo",
    repo,
    "--json",
    "number,title,body,url,author,labels,state",
  ]);
}

function openIssues(repo: string, limit: number): readonly Issue[] {
  return readJson<readonly Issue[]>("gh", [
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    String(limit),
    "--search",
    "sort:created-asc",
    "--json",
    "number,title,body,url,author,labels,state,updatedAt",
  ]);
}

function prepareBase(baseBranch: string): void {
  checked("git", ["fetch", "origin", baseBranch]);
  checked("git", ["switch", baseBranch]);
  checked("git", ["pull", "--ff-only", "origin", baseBranch]);
}

function promptForIssue(issue: Issue, titleFile: string, bodyFile: string): string {
  const labels = labelNames(issue).join(", ") || "(none)";
  return `You are running locally through Codex CLI for the corsa-bind repository.

Implement the issue below in this repository.

Rules:
- Keep the change narrowly scoped to the issue.
- Follow the existing style, architecture, and tests in this repository.
- Do not create commits, branches, tags, or pull requests.
- Do not include "[codex]" in any title or generated text.
- Write a proposed Conventional Commits PR title to ${titleFile}.
- Write a pull request body to ${bodyFile}.
- Include validation commands you ran in the PR body.
- Include "Closes #${issue.number}" in the PR body.
- If the issue lacks enough detail or the implementation is unsafe, leave the worktree unchanged and explain why.

Issue #${issue.number}: ${issue.title}
URL: ${issue.url}
Author: @${issue.author.login}
Labels: ${labels}

${issue.body ?? ""}`;
}

function runCodex(issue: Issue, issueDir: string, options: Options): void {
  mkdirSync(issueDir, { recursive: true });

  const titleFile = join(issueDir, "pr-title.txt");
  const bodyFile = join(issueDir, "pr-body.md");
  const outputFile = join(issueDir, "codex-final-message.md");
  const prompt = promptForIssue(issue, titleFile, bodyFile);
  writeFileSync(join(issueDir, "prompt.md"), prompt);

  const args = [
    "exec",
    "--full-auto",
    "--sandbox",
    "workspace-write",
    "--ephemeral",
    "--output-last-message",
    outputFile,
    "-",
  ];
  if (options.model) {
    args.splice(1, 0, "--model", options.model);
  }

  const result = runCommand("codex", args, { input: prompt, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`codex exec failed with status ${result.status}`);
  }
}

function processIssue(
  issue: Issue,
  repo: string,
  baseBranch: string,
  options: Options,
): StateEntry {
  if (issue.state !== "OPEN") {
    throw new Error(`Issue #${issue.number} is not open`);
  }

  if (!gitIsClean()) {
    throw new Error("Worktree must be clean before the issue agent starts");
  }

  prepareBase(baseBranch);
  if (!gitIsClean()) {
    throw new Error("Worktree must be clean after updating the base branch");
  }

  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const branch = `codex/issue-${issue.number}-${slugify(issue.title)}-${timestamp}`;
  const issueDir = join(rootDir, ".cache", "issue-agent", "issues", String(issue.number));
  rmSync(issueDir, { force: true, recursive: true });

  checked("git", ["switch", "-c", branch]);
  runCodex(issue, issueDir, options);

  if (!gitHasChanges()) {
    checked("git", ["switch", baseBranch]);
    checked("git", ["branch", "-D", branch]);
    return {
      branch,
      status: "no_changes",
      title: issue.title,
      updatedAt: new Date().toISOString(),
    };
  }

  const titleFile = join(issueDir, "pr-title.txt");
  const bodyFile = join(issueDir, "pr-body.md");
  const prTitle = inferTitle(issue, titleFile);
  const prBody = bodyForIssue(issue, bodyFile, prTitle);
  const prBodyFile = join(issueDir, "normalized-pr-body.md");
  writeFileSync(prBodyFile, prBody);

  checked("git", ["add", "-A"]);
  checked("git", ["commit", "-m", prTitle]);
  checked("git", ["push", "-u", "origin", branch]);

  const prArgs = [
    "pr",
    "create",
    "--repo",
    repo,
    "--base",
    baseBranch,
    "--head",
    branch,
    "--title",
    prTitle,
    "--body-file",
    prBodyFile,
  ];
  if (options.draft) {
    prArgs.push("--draft");
  }
  const prUrl = checked("gh", prArgs).trim();

  if (options.autoMerge && !options.draft) {
    checked("gh", ["pr", "merge", prUrl, "--repo", repo, "--auto", "--squash"]);
  }

  if (!options.noWaitCi) {
    const result = runCommand(
      "gh",
      ["pr", "checks", prUrl, "--repo", repo, "--watch", "--fail-fast", "--interval", "30"],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`Pull request checks failed for ${prUrl}`);
    }
  }

  checked("git", ["switch", baseBranch]);
  return {
    branch,
    prUrl,
    status: "pr",
    title: prTitle,
    updatedAt: new Date().toISOString(),
  };
}

async function sleepSeconds(seconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  requireCommand("gh");
  requireCommand("codex");

  const info = repoInfo(options);
  const repo = options.repo ?? info.nameWithOwner;
  const baseBranch = options.baseBranch ?? info.defaultBranchRef.name;
  const statePath = resolve(rootDir, options.stateFile);
  const state = loadState(statePath);

  if (options.mode === "run") {
    const issue = issueView(repo, options.issueNumber!);
    state.processed[String(issue.number)] = processIssue(issue, repo, baseBranch, options);
    writeState(statePath, state);
    return;
  }

  for (;;) {
    for (const issue of openIssues(repo, options.limit)) {
      const key = String(issue.number);
      if (state.processed[key]?.status === "pr" || state.processed[key]?.status === "no_changes") {
        continue;
      }

      try {
        state.processed[key] = processIssue(issue, repo, baseBranch, options);
      } catch (error) {
        state.processed[key] = {
          status: "failed",
          title: issue.title,
          updatedAt: new Date().toISOString(),
        };
        writeState(statePath, state);
        throw error;
      }
      writeState(statePath, state);
    }

    if (options.once) {
      return;
    }
    await sleepSeconds(options.pollSeconds);
  }
}

main().catch(fail);
