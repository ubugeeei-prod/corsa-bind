import {
  getNodeBindingTargets,
  nodeBindingPackage,
  corsaOxlintPackage,
} from "./npm_release_utils.ts";
import { fail, runCommand } from "./shared.ts";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const minimumNpmVersion = "11.10.0";
const defaultRegistry = "https://registry.npmjs.org";
const defaultRepository = "ubugeeei/corsa-bind";
const defaultWorkflowFile = "publish-npm.yml";
const defaultEnvironment = "release";

function normalizeRegistryBase(registry: string): string {
  return registry.endsWith("/") ? registry.slice(0, -1) : registry;
}

function getRegistryBase(): string {
  return normalizeRegistryBase(
    process.env.NPM_CONFIG_REGISTRY?.trim() ||
      process.env.npm_config_registry?.trim() ||
      defaultRegistry,
  );
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function resolveTrustCommand(): { args: string[]; command: string } {
  const npmVersion = process.env.npm_version?.trim();
  if (npmVersion && compareVersions(npmVersion, minimumNpmVersion) >= 0) {
    return { command: npmCommand, args: ["trust"] };
  }

  return {
    command: npxCommand,
    args: ["--yes", `npm@^${minimumNpmVersion}`, "trust"],
  };
}

function getTrustedPublishPackages(): string[] {
  return [
    ...getNodeBindingTargets().map(
      (target) => `${nodeBindingPackage.name}-${target.platformArchABI}`,
    ),
    nodeBindingPackage.name,
    corsaOxlintPackage.name,
  ];
}

async function packageExists(packageName: string): Promise<boolean> {
  const response = await fetch(`${getRegistryBase()}/${encodeURIComponent(packageName)}`);
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to query npm registry for ${packageName}: ${response.status} ${response.statusText}`,
    );
  }
  return true;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const repository = process.env.NPM_TRUST_REPOSITORY?.trim() || defaultRepository;
  const workflowFile = process.env.NPM_TRUST_WORKFLOW_FILE?.trim() || defaultWorkflowFile;
  const environmentName = process.env.NPM_TRUST_ENVIRONMENT?.trim() || defaultEnvironment;
  const packages = getTrustedPublishPackages();
  const missingPackages: string[] = [];

  for (const packageName of packages) {
    if (!(await packageExists(packageName))) {
      missingPackages.push(packageName);
    }
  }

  if (missingPackages.length > 0) {
    console.error("npm trusted publishing requires these packages to exist first:");
    for (const packageName of missingPackages) {
      console.error(`- ${packageName}`);
    }
    console.error(
      "Run the first manual npm publish, then rerun this setup command to attach the trusted publisher.",
    );
    if (!dryRun) {
      process.exit(1);
    }
  }

  const trustCommand = resolveTrustCommand();

  for (const packageName of packages) {
    const command = [trustCommand.command, ...trustCommand.args, "github", packageName];
    const args = [
      ...trustCommand.args,
      "github",
      packageName,
      "--repo",
      repository,
      "--file",
      workflowFile,
      "--env",
      environmentName,
      "--yes",
    ];

    if (dryRun) {
      console.log(
        command
          .concat(["--repo", repository, "--file", workflowFile, "--env", environmentName, "--yes"])
          .join(" "),
      );
      continue;
    }

    runCommand(trustCommand.command, args);
  }
}

await main().catch(fail);
