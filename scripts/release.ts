import {
  getNodeBindingBinaryPackageNames,
  doesNpmPackageExist,
  nodeBindingPackage,
  corsaOxlintPackage,
} from "./npm_release_utils.ts";
import {
  assertReleaseTagMatchesWorkspace,
  bumpVersion,
  parseReleaseVersion,
  publicRustCrateNames,
  readWorkspaceVersion,
  type ReleaseBump,
  syncCargoLockfile,
  updateWorkspaceVersion,
  versionToTag,
} from "./release_manifest.ts";
import { fail, rootDir, runCommand, runCommandCapture } from "./shared.ts";

const gitCommand = "git";
const vpCommand = process.platform === "win32" ? "vp.cmd" : "vp";
const defaultRemote = "origin";
const defaultBranch = "main";
const cratesIoUserAgent = "corsa-release-script";
const gitNoPromptEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
};

type ReleaseTarget =
  | {
      kind: "bump";
      bump: ReleaseBump;
    }
  | {
      kind: "version";
      version: string;
    };

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

interface ReleaseOptions {
  allowBootstrapGap: boolean;
  allowAnyBranch: boolean;
  push: boolean;
  remote: string;
  requiredBranch: string;
  runFullGates: boolean;
  skipGates: boolean;
  target: ReleaseTarget;
}

function printUsage(): void {
  console.log(
    "Usage: vp run -w release <patch|minor|major|version> [--no-push] [--full-gates] [--skip-gates] [--allow-bootstrap-gap]",
  );
}

function parseArgs(argv: string[]): ReleaseOptions {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const bump = args.find(
    (arg): arg is ReleaseBump => arg === "patch" || arg === "minor" || arg === "major",
  );
  const version = args.find((arg) => {
    try {
      parseReleaseVersion(arg);
      return true;
    } catch {
      return false;
    }
  });

  if (bump && version) {
    throw new Error("Expected either a version or one of: patch, minor, major, not both");
  }
  if (!bump && !version) {
    throw new Error("Expected a version or one of: patch, minor, major");
  }

  return {
    allowBootstrapGap: args.includes("--allow-bootstrap-gap"),
    allowAnyBranch: process.env.RELEASE_ALLOW_ANY_BRANCH?.trim() === "1",
    push: !args.includes("--no-push"),
    remote: process.env.RELEASE_REMOTE?.trim() || defaultRemote,
    requiredBranch: process.env.RELEASE_BRANCH?.trim() || defaultBranch,
    runFullGates: args.includes("--full-gates"),
    skipGates: args.includes("--skip-gates"),
    target: bump ? { kind: "bump", bump } : { kind: "version", version: version as string },
  };
}

function gitCapture(args: readonly string[]): string {
  return runCommandCapture(gitCommand, args, { cwd: rootDir }).stdout.trim();
}

function getCurrentBranch(): string {
  const branch = gitCapture(["branch", "--show-current"]);
  if (!branch) {
    throw new Error("Release automation requires a checked-out branch, not a detached HEAD");
  }
  return branch;
}

function assertCleanWorktree(): void {
  const output = gitCapture(["status", "--short"]);
  if (output) {
    throw new Error("Release automation requires a clean worktree");
  }
}

function assertBranchReady(remote: string, requiredBranch: string, currentBranch: string): void {
  runCommand(gitCommand, ["fetch", remote, requiredBranch, "--tags"], {
    cwd: rootDir,
    env: gitNoPromptEnv,
  });

  const counts = gitCapture([
    "rev-list",
    "--left-right",
    "--count",
    `${remote}/${requiredBranch}...HEAD`,
  ]);
  const [behindCount, aheadCount] = counts.split(/\s+/).map((value) => Number(value));

  if (!Number.isFinite(behindCount) || !Number.isFinite(aheadCount)) {
    throw new Error(`Unable to compare HEAD against ${remote}/${requiredBranch}`);
  }

  if (currentBranch !== requiredBranch) {
    throw new Error(
      `Release automation expects branch ${requiredBranch}, but current branch is ${currentBranch}`,
    );
  }

  if (behindCount > 0) {
    throw new Error(`Local ${requiredBranch} is behind ${remote}/${requiredBranch}; pull first`);
  }
}

function assertTagAbsent(remote: string, tag: string): void {
  const localTag = runCommandCapture(
    gitCommand,
    ["rev-parse", "-q", "--verify", `refs/tags/${tag}`],
    {
      cwd: rootDir,
    },
  );
  if (localTag.status === 0) {
    throw new Error(`Local tag ${tag} already exists`);
  }

  const remoteTag = runCommandCapture(
    gitCommand,
    ["ls-remote", "--tags", remote, `refs/tags/${tag}`],
    {
      cwd: rootDir,
      env: gitNoPromptEnv,
    },
  );
  if (remoteTag.stdout.trim()) {
    throw new Error(`Remote tag ${tag} already exists on ${remote}`);
  }
}

async function doesCrateExist(crateName: string): Promise<boolean> {
  const response = await fetch(`https://crates.io/api/v1/crates/${crateName}`, {
    headers: {
      "user-agent": cratesIoUserAgent,
    },
  });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to query crates.io for ${crateName}: ${response.status} ${response.statusText}`,
    );
  }
  return true;
}

async function assertBootstrapComplete(): Promise<void> {
  const missingCrates = (
    await Promise.all(
      [...publicRustCrateNames].map(async (crateName) =>
        (await doesCrateExist(crateName)) ? null : crateName,
      ),
    )
  ).filter(isPresent);

  const missingNpmPackages = (
    await Promise.all(
      [...getNodeBindingBinaryPackageNames(), nodeBindingPackage.name, corsaOxlintPackage.name].map(
        async (packageName) => ((await doesNpmPackageExist(packageName)) ? null : packageName),
      ),
    )
  ).filter(isPresent);

  if (missingCrates.length === 0 && missingNpmPackages.length === 0) {
    return;
  }

  const lines = ["Trusted-publish bootstrap is not complete yet."];

  if (missingCrates.length > 0) {
    lines.push(`Missing crates.io packages: ${missingCrates.join(", ")}`);
  }
  if (missingNpmPackages.length > 0) {
    lines.push(`Missing npm packages: ${missingNpmPackages.join(", ")}`);
  }

  lines.push(
    "Run the first bootstrap release flow from docs/release_guide.md, then rerun this command.",
  );
  throw new Error(lines.join("\n"));
}

function runReleasePreflight(): void {
  console.log("running local release preflight; full release gates run in GitHub Actions");
  runCommand(vpCommand, ["check"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "fmt_check_rust"], { cwd: rootDir });
}

function formatReleaseManifestChanges(): void {
  runCommand(vpCommand, ["fmt"], { cwd: rootDir });
}

function runFullReleaseGates(): void {
  runCommand(vpCommand, ["check"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "fmt_check_rust"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "lint_rust"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "test"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "sync_ref"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "verify_ref"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "bench_verify"], { cwd: rootDir });
  runCommand(vpCommand, ["run", "-w", "release_dry_run"], { cwd: rootDir });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const currentBranch = getCurrentBranch();

  assertCleanWorktree();
  if (!options.allowAnyBranch) {
    assertBranchReady(options.remote, options.requiredBranch, currentBranch);
  }

  if (!options.allowBootstrapGap) {
    await assertBootstrapComplete();
  }

  const currentVersion = readWorkspaceVersion();
  const nextVersion =
    options.target.kind === "bump"
      ? bumpVersion(currentVersion, options.target.bump)
      : options.target.version;
  const tag = versionToTag(nextVersion);

  assertTagAbsent(options.remote, tag);
  updateWorkspaceVersion(nextVersion);
  syncCargoLockfile();
  formatReleaseManifestChanges();

  if (!options.skipGates) {
    if (options.runFullGates) {
      runFullReleaseGates();
    } else {
      runReleasePreflight();
    }
  }

  assertReleaseTagMatchesWorkspace(tag);

  runCommand(gitCommand, ["add", "-A"], { cwd: rootDir });
  runCommand(gitCommand, ["-c", "commit.gpgsign=false", "commit", "-m", `release: ${tag}`], {
    cwd: rootDir,
  });
  runCommand(gitCommand, ["-c", "tag.gpgSign=false", "tag", "-a", tag, "-m", tag], {
    cwd: rootDir,
  });

  if (options.push) {
    runCommand(gitCommand, ["push", options.remote, `HEAD:refs/heads/${currentBranch}`], {
      cwd: rootDir,
      env: gitNoPromptEnv,
    });
    runCommand(gitCommand, ["push", options.remote, `refs/tags/${tag}`], {
      cwd: rootDir,
      env: gitNoPromptEnv,
    });
  }

  console.log(`released ${tag}${options.push ? " and pushed branch + tag" : " locally"}`);
}

await main().catch(fail);
