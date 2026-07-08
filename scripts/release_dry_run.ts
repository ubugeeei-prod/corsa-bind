import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  getPackageVersion,
  isNpmPackageVersionPublished,
  publishPackedTarball,
  corsaOxlintPackage,
  withStagedNodeBindingPackages,
} from "./npm_release_utils.ts";
import { isPrereleaseVersion, publicRustCrates } from "./release_manifest.ts";
import { fail, rootDir, runCommand } from "./shared.ts";

interface CrateSpec {
  name: string;
  path: string;
  patches: string[];
}

const crates: CrateSpec[] = publicRustCrates.map((crate) => ({
  name: crate.name,
  path: resolve(rootDir, crate.packagePath),
  patches: [...crate.patches],
}));

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function patchConfigFor(crateName: string): { configDir: string; configPath: string } {
  const crate = crates.find((candidate) => candidate.name === crateName);
  if (!crate) {
    throw new Error(`Unknown crate: ${crateName}`);
  }

  const patchLines = crate.patches.map((patchName) => {
    const dependency = crates.find((candidate) => candidate.name === patchName);
    if (!dependency) {
      throw new Error(`Unknown patch target: ${patchName}`);
    }
    return `${dependency.name} = { path = "${normalizePath(dependency.path)}" }`;
  });

  const configDir = mkdtempSync(resolve(tmpdir(), "corsa-release-dry-run-"));
  const configPath = resolve(configDir, "cargo-config.toml");
  const configBody = patchLines.length === 0 ? "" : `[patch.crates-io]\n${patchLines.join("\n")}\n`;
  writeFileSync(configPath, configBody, "utf8");
  return { configDir, configPath };
}

async function main(): Promise<void> {
  runCommand("cargo", ["publish", "--locked", "--allow-dirty", "--dry-run", "-p", crates[0].name], {
    cwd: rootDir,
  });

  for (const crate of crates) {
    const { configDir, configPath } = patchConfigFor(crate.name);
    try {
      runCommand(
        "cargo",
        ["package", "--locked", "--allow-dirty", "--config", configPath, "-p", crate.name],
        { cwd: rootDir },
      );
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  }

  await withStagedNodeBindingPackages(
    { requireAllTargets: false },
    async ({ binaryPackages, rootPackage }) => {
      for (const npmPackage of [...binaryPackages, rootPackage, corsaOxlintPackage]) {
        const version = getPackageVersion(npmPackage);
        if (await isNpmPackageVersionPublished(npmPackage, version)) {
          console.log(
            `npm package ${npmPackage.name}@${version} already exists; skipping dry-run publish`,
          );
          continue;
        }
        publishPackedTarball(npmPackage, {
          dryRun: true,
          tag: isPrereleaseVersion(version) ? "beta" : undefined,
        });
      }
    },
  );
}

await main().catch(fail);
