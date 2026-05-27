import {
  assertPublishablePackageManifest,
  doesNpmPackageExist,
  getPackageVersion,
  getNodeBindingBinaryPackageNames,
  isNpmPackageVersionPublished,
  nodeBindingPackage,
  publishPackedTarball,
  sleep,
  corsaOxlintPackage,
  withStagedNodeBindingPackages,
} from "./npm_release_utils.ts";
import { fail } from "./shared.ts";

const delayMs = Number(process.env.NPM_PUBLISH_DELAY_MS ?? "10000");
const distTag = process.env.NPM_DIST_TAG?.trim() || undefined;
const artifactsDir = process.env.NAPI_ARTIFACTS_DIR?.trim() || undefined;
const requireAllTargets = process.env.NAPI_REQUIRE_ALL_TARGETS?.trim() === "0" ? false : true;
const startAt = process.env.NPM_PUBLISH_START_AT?.trim() || undefined;
const requireTrustedPublishBootstrap = process.env.NPM_TRUSTED_PUBLISH?.trim() === "1";

async function assertTrustedPublishBootstrapComplete(): Promise<void> {
  const missingPackages = (
    await Promise.all(
      [...getNodeBindingBinaryPackageNames(), nodeBindingPackage.name, corsaOxlintPackage.name].map(
        async (packageName) => ((await doesNpmPackageExist(packageName)) ? null : packageName),
      ),
    )
  ).filter((packageName): packageName is string => packageName !== null);

  if (missingPackages.length === 0) {
    return;
  }

  throw new Error(
    [
      "npm trusted publishing requires every release package to already exist on the registry.",
      `Missing packages: ${missingPackages.join(", ")}`,
      "Run the first manual npm publish, then configure trusted publishing with:",
      "vp exec node --strip-types ./scripts/setup_npm_trusted_publish.ts",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  if (requireTrustedPublishBootstrap) {
    await assertTrustedPublishBootstrapComplete();
  }

  await withStagedNodeBindingPackages(
    { artifactsDir, requireAllTargets },
    async ({ binaryPackages, rootPackage }) => {
      const releasePackages = [...binaryPackages, rootPackage, corsaOxlintPackage];
      if (startAt && !releasePackages.some((pkg) => pkg.name === startAt)) {
        throw new Error(`Unknown NPM_PUBLISH_START_AT package: ${startAt}`);
      }

      let started = !startAt;

      for (const [index, pkg] of releasePackages.entries()) {
        if (!started) {
          started = pkg.name === startAt;
          if (!started) {
            continue;
          }
        }

        assertPublishablePackageManifest(pkg);
        const version = getPackageVersion(pkg);

        if (await isNpmPackageVersionPublished(pkg, version)) {
          console.log(`npm package ${pkg.name}@${version} already exists; skipping`);
        } else {
          try {
            publishPackedTarball(pkg, { tag: distTag });
          } catch (error) {
            if (await isNpmPackageVersionPublished(pkg, version)) {
              console.log(
                `npm package ${pkg.name}@${version} was published concurrently; skipping`,
              );
            } else {
              throw error;
            }
          }
        }

        if (index + 1 < releasePackages.length && delayMs > 0) {
          await sleep(delayMs);
        }
      }
    },
  );
}

await main().catch(fail);
