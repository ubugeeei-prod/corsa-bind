import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

type Target = "all" | "rust" | "npm" | "native";

type SpdxPackage = {
  SPDXID: string;
  name: string;
  versionInfo?: string;
  downloadLocation: string;
  filesAnalyzed: boolean;
  licenseConcluded: string;
  licenseDeclared: string;
  copyrightText: string;
};

const args = parseArgs(process.argv.slice(2));
const target = (args.target ?? "all") as Target;
const out = resolve(args.out ?? `.cache/sbom/corsa-${target}.spdx.json`);
const packages = [
  ...(target === "all" || target === "rust" ? rustPackages() : []),
  ...(target === "all" || target === "npm" ? npmPackages() : []),
  ...(target === "all" || target === "native" ? nativePackages(args["native-target"]) : []),
];

const now = new Date().toISOString();
const document = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: `corsa-bind-${target}-sbom`,
  documentNamespace: `https://github.com/ubugeeei/corsa-bind/sbom/${target}/${now}`,
  creationInfo: {
    created: now,
    creators: ["Tool: scripts/generate_sbom.ts"],
  },
  packages: dedupePackages(packages),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Generated ${out}`);

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      continue;
    }
    parsed[value.slice(2)] = values[index + 1] ?? "true";
    index += 1;
  }
  return parsed;
}

function rustPackages(): SpdxPackage[] {
  const lockfile = readFileSync("Cargo.lock", "utf8");
  return [...lockfile.matchAll(/\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"/g)].map(
    ([, name, version]) =>
      spdxPackage({
        name: `crate:${name}`,
        version,
        id: `Rust-${name}-${version}`,
      }),
  );
}

function npmPackages(): SpdxPackage[] {
  return [
    "package.json",
    "src/bindings/nodejs/corsa_node/package.json",
    "src/bindings/nodejs/typescript_oxlint/package.json",
  ]
    .filter(existsSync)
    .map((path) => {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as {
        name: string;
        version?: string;
      };
      return spdxPackage({
        name: `npm:${manifest.name}`,
        version: manifest.version ?? "workspace",
        id: `Npm-${manifest.name}-${manifest.version ?? "workspace"}`,
      });
    });
}

function nativePackages(nativeTarget: string | undefined): SpdxPackage[] {
  const artifacts = [
    ...new Set([
      ...collectNativeArtifacts("artifacts"),
      ...collectNativeArtifacts("src/bindings/nodejs/corsa_node"),
    ]),
  ];
  return [
    spdxPackage({
      name: `native:${nativeTarget ?? "unknown-target"}`,
      version: process.env.GITHUB_REF_NAME ?? "unreleased",
      id: `Native-${nativeTarget ?? "unknown-target"}`,
    }),
    ...artifacts.map((path) =>
      spdxPackage({
        name: `native-artifact:${basename(path)}`,
        version: process.env.GITHUB_REF_NAME ?? "unreleased",
        id: `NativeArtifact-${basename(path)}`,
      }),
    ),
  ];
}

function collectNativeArtifacts(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...collectNativeArtifacts(path));
    } else if (entry.endsWith(".node")) {
      out.push(path);
    }
  }
  return out;
}

function spdxPackage(input: { name: string; version: string; id: string }): SpdxPackage {
  return {
    SPDXID: `SPDXRef-${sanitizeSpdxId(input.id)}`,
    name: input.name,
    versionInfo: input.version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: "NOASSERTION",
    copyrightText: "NOASSERTION",
  };
}

function sanitizeSpdxId(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, "-");
}

function dedupePackages(packages: SpdxPackage[]): SpdxPackage[] {
  const seen = new Set<string>();
  return packages.filter((pkg) => {
    if (seen.has(pkg.SPDXID)) {
      return false;
    }
    seen.add(pkg.SPDXID);
    return true;
  });
}
