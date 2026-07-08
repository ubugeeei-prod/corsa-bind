import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { nodeBindingPackage, npmPackages, corsaOxlintPackage } from "./npm_release_utils.ts";
import { rootDir, runCommand } from "./shared.ts";

export type ReleaseBump = "major" | "minor" | "patch";

const semverPattern =
  /^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export interface RustReleaseCrate {
  manifestPath: string;
  name: string;
  packagePath: string;
  patches: readonly string[];
  publish: "internal" | "public";
}

export const rustReleaseCrates: readonly RustReleaseCrate[] = [
  {
    name: "corsa_core",
    manifestPath: "src/core/corsa_core/Cargo.toml",
    packagePath: "src/core/corsa_core",
    patches: [],
    publish: "public",
  },
  {
    name: "corsa_runtime",
    manifestPath: "src/core/corsa_runtime/Cargo.toml",
    packagePath: "src/core/corsa_runtime",
    patches: [],
    publish: "public",
  },
  {
    name: "corsa_jsonrpc",
    manifestPath: "src/core/corsa_jsonrpc/Cargo.toml",
    packagePath: "src/core/corsa_jsonrpc",
    patches: ["corsa_core", "corsa_runtime"],
    publish: "public",
  },
  {
    name: "corsa_client",
    manifestPath: "src/core/corsa_client/Cargo.toml",
    packagePath: "src/core/corsa_client",
    patches: ["corsa_core", "corsa_jsonrpc", "corsa_runtime"],
    publish: "public",
  },
  {
    name: "corsa_lsp",
    manifestPath: "src/core/corsa_lsp/Cargo.toml",
    packagePath: "src/core/corsa_lsp",
    patches: ["corsa_core", "corsa_jsonrpc", "corsa_runtime"],
    publish: "public",
  },
  {
    name: "corsa_orchestrator",
    manifestPath: "src/core/corsa_orchestrator/Cargo.toml",
    packagePath: "src/core/corsa_orchestrator",
    patches: ["corsa_client", "corsa_core", "corsa_lsp", "corsa_runtime"],
    publish: "public",
  },
  {
    name: "corsa_ref",
    manifestPath: "src/core/corsa_ref/Cargo.toml",
    packagePath: "src/core/corsa_ref",
    patches: [],
    publish: "internal",
  },
  {
    name: "corsa_ffi",
    manifestPath: "src/bindings/c/corsa_ffi/Cargo.toml",
    packagePath: "src/bindings/c/corsa_ffi",
    patches: ["corsa_client", "corsa_core", "corsa_lsp", "corsa_runtime"],
    publish: "internal",
  },
  {
    name: "corsa",
    manifestPath: "src/bindings/rust/corsa/Cargo.toml",
    packagePath: "src/bindings/rust/corsa",
    patches: [
      "corsa_client",
      "corsa_core",
      "corsa_jsonrpc",
      "corsa_lsp",
      "corsa_orchestrator",
      "corsa_runtime",
    ],
    publish: "public",
  },
  {
    name: "corsa_node",
    manifestPath: "src/bindings/nodejs/corsa_node/Cargo.toml",
    packagePath: "src/bindings/nodejs/corsa_node",
    patches: [],
    publish: "internal",
  },
  {
    name: "corsa_elixir",
    manifestPath: "src/bindings/elixir/corsa_utils/native/corsa_elixir/Cargo.toml",
    packagePath: "src/bindings/elixir/corsa_utils/native/corsa_elixir",
    patches: ["corsa_client", "corsa_core", "corsa_lsp", "corsa_runtime"],
    publish: "internal",
  },
] as const;

export const publicRustCrates = rustReleaseCrates.filter(
  (crate): crate is RustReleaseCrate & { publish: "public" } => crate.publish === "public",
);

export const publicRustCrateNames = publicRustCrates.map((crate) => crate.name);

const cargoManifestPaths = rustReleaseCrates.map((crate) => crate.manifestPath);
const elixirPackageManifestPath = "src/bindings/elixir/corsa_utils/mix.exs";
const workspaceCrateNames = rustReleaseCrates.map((crate) => crate.name);
const workspaceNpmPackageNames = npmPackages.map((pkg) => pkg.name);

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function writeText(path: string, contents: string): void {
  writeFileSync(path, contents, "utf8");
}

function escapeRegex(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseReleaseVersion(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
} {
  const match = version.trim().match(semverPattern);
  if (!match?.groups) {
    throw new Error(`Expected a semver version like 0.2.0 or 1.0.0-beta.1, received ${version}`);
  }
  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
    prerelease: match.groups.prerelease ?? null,
  };
}

function getCargoPackageVersion(manifestPath: string): string {
  const contents = readText(manifestPath);
  let inPackageSection = false;

  for (const line of contents.split(/\r?\n/)) {
    if (/^\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      continue;
    }
    if (/^\[.+\]\s*$/.test(line)) {
      inPackageSection = false;
    }
    if (!inPackageSection) {
      continue;
    }

    const match = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
    if (match) {
      return match[1];
    }
  }

  throw new Error(`Unable to find [package] version in ${manifestPath}`);
}

function getElixirPackageVersion(manifestPath: string): string {
  const match = readText(manifestPath).match(/^\s*@version\s+"([^"]+)"\s*$/m);
  if (!match) {
    throw new Error(`Unable to find @version in ${manifestPath}`);
  }
  return match[1];
}

function updateCargoManifest(manifestPath: string, nextVersion: string): boolean {
  const dependencyPattern = new RegExp(
    `^(\\s*(?:${workspaceCrateNames.map(escapeRegex).join("|")})\\s*=\\s*\\{.*\\bversion\\s*=\\s*")([^"]+)(".*\\}\\s*)$`,
  );

  const contents = readText(manifestPath).replace(/\r\n/g, "\n");
  const lines = contents.endsWith("\n") ? contents.slice(0, -1).split("\n") : contents.split("\n");
  let changed = false;
  let inPackageSection = false;

  const nextLines = lines.map((line) => {
    if (/^\[package\]\s*$/.test(line)) {
      inPackageSection = true;
      return line;
    }
    if (/^\[.+\]\s*$/.test(line)) {
      inPackageSection = false;
      return line;
    }

    const packageVersionMatch = inPackageSection
      ? line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/)
      : null;
    if (packageVersionMatch) {
      if (packageVersionMatch[1] === nextVersion) {
        return line;
      }
      changed = true;
      return line.replace(/(^\s*version\s*=\s*")([^"]+)("\s*$)/, `$1${nextVersion}$3`);
    }

    const dependencyMatch = line.match(dependencyPattern);
    if (dependencyMatch) {
      if (dependencyMatch[2] === nextVersion) {
        return line;
      }
      changed = true;
      return line.replace(dependencyPattern, `$1${nextVersion}$3`);
    }

    return line;
  });

  if (changed) {
    writeText(manifestPath, `${nextLines.join("\n")}\n`);
  }

  return changed;
}

function updatePackageManifest(manifestPath: string, nextVersion: string): boolean {
  const manifest = JSON.parse(readText(manifestPath)) as Record<string, unknown>;
  let changed = false;

  if (manifest.version !== nextVersion) {
    manifest.version = nextVersion;
    changed = true;
  }

  for (const key of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const) {
    const section = manifest[key];
    if (!section || typeof section !== "object") {
      continue;
    }

    for (const packageName of workspaceNpmPackageNames) {
      const current = (section as Record<string, unknown>)[packageName];
      if (typeof current !== "string" || current.startsWith("workspace:")) {
        continue;
      }
      if (current !== nextVersion) {
        (section as Record<string, unknown>)[packageName] = nextVersion;
        changed = true;
      }
    }
  }

  if (changed) {
    writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return changed;
}

function updateElixirPackageManifest(manifestPath: string, nextVersion: string): boolean {
  const contents = readText(manifestPath).replace(/\r\n/g, "\n");
  let changed = false;

  const nextContents = contents.replace(/^(\s*@version\s+")([^"]+)(".*)$/m, (...args) => {
    const [, prefix, currentVersion, suffix] = args as [string, string, string, string];
    if (currentVersion === nextVersion) {
      return `${prefix}${currentVersion}${suffix}`;
    }
    changed = true;
    return `${prefix}${nextVersion}${suffix}`;
  });

  if (!changed && !/^\s*@version\s+"([^"]+)"\s*$/m.test(contents)) {
    throw new Error(`Unable to find @version in ${manifestPath}`);
  }

  if (changed) {
    writeText(manifestPath, nextContents);
  }

  return changed;
}

export function readWorkspaceVersion(): string {
  const versions = new Set<string>();

  for (const relativePath of cargoManifestPaths) {
    versions.add(getCargoPackageVersion(resolve(rootDir, relativePath)));
  }

  for (const pkg of [nodeBindingPackage, corsaOxlintPackage]) {
    versions.add(JSON.parse(readText(resolve(pkg.path, "package.json"))).version);
  }

  versions.add(getElixirPackageVersion(resolve(rootDir, elixirPackageManifestPath)));

  if (versions.size !== 1) {
    throw new Error(
      `Expected a single workspace release version, found: ${[...versions].join(", ")}`,
    );
  }

  return [...versions][0];
}

export function bumpVersion(currentVersion: string, bump: ReleaseBump): string {
  const { major, minor, patch } = parseReleaseVersion(currentVersion);
  if (bump === "major") {
    return `${major + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

export function versionToTag(version: string): string {
  parseReleaseVersion(version);
  return `v${version}`;
}

export function normalizeReleaseTag(input: string): string {
  const tag = input.trim().replace(/^refs\/tags\//, "");
  if (!semverPattern.test(tag.slice(1)) || !tag.startsWith("v")) {
    throw new Error(`Expected a release tag like v0.2.0 or v1.0.0-beta.1, received ${input}`);
  }
  return tag;
}

export function isPrereleaseVersion(version: string): boolean {
  return parseReleaseVersion(version).prerelease !== null;
}

export function isPrereleaseTag(input: string): boolean {
  return isPrereleaseVersion(normalizeReleaseTag(input).slice(1));
}

export function assertReleaseTagMatchesWorkspace(input: string): string {
  const version = readWorkspaceVersion();
  const expectedTag = versionToTag(version);
  const actualTag = normalizeReleaseTag(input);

  if (actualTag !== expectedTag) {
    throw new Error(
      `Release tag mismatch: expected ${expectedTag} for workspace version ${version}, received ${actualTag}`,
    );
  }

  return version;
}

export function updateWorkspaceVersion(nextVersion: string): string[] {
  parseReleaseVersion(nextVersion);

  const changedPaths: string[] = [];

  for (const relativePath of cargoManifestPaths) {
    const manifestPath = resolve(rootDir, relativePath);
    if (updateCargoManifest(manifestPath, nextVersion)) {
      changedPaths.push(manifestPath);
    }
  }

  for (const pkg of [nodeBindingPackage, corsaOxlintPackage]) {
    const manifestPath = resolve(pkg.path, "package.json");
    if (updatePackageManifest(manifestPath, nextVersion)) {
      changedPaths.push(manifestPath);
    }
  }

  const elixirManifestPath = resolve(rootDir, elixirPackageManifestPath);
  if (updateElixirPackageManifest(elixirManifestPath, nextVersion)) {
    changedPaths.push(elixirManifestPath);
  }

  return changedPaths;
}

export function syncCargoLockfile(): void {
  runCommand("cargo", ["update", "--workspace"], { cwd: rootDir });
}
