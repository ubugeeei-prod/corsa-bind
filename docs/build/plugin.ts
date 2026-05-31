import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import type { Plugin } from "vite";

import { buildApiPages } from "./api.ts";
import { readGuidePages } from "./content.ts";
import { renderHtml } from "./html.ts";
import { loadMarkdownCompiler } from "./ox_content.ts";
import type { MarkdownPage } from "./types.ts";

const VIRTUAL_ENTRY = "\0corsa-docs-entry";

/** Static brand assets copied verbatim into the docs output (served at root). */
const STATIC_ASSETS: ReadonlyArray<readonly [string, string]> = [
  ["og.png", "assets/og.png"],
  ["logo.svg", "assets/logo.svg"],
  ["logo-mark.svg", "assets/logo-mark.svg"],
];

/** Vite plugin that renders the static Ox Content documentation site. */
export function corsaDocsPlugin(): Plugin {
  let rootDir = process.cwd();
  return {
    name: "corsa-docs",
    apply: "build",
    config() {
      return {
        build: {
          emptyOutDir: true,
          outDir: "dist/docs",
          rollupOptions: { input: VIRTUAL_ENTRY },
        },
      };
    },
    configResolved(config) {
      rootDir = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ENTRY ? VIRTUAL_ENTRY : null;
    },
    load(id) {
      return id === VIRTUAL_ENTRY ? "export default {};" : null;
    },
    async generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        delete bundle[fileName];
      }
      for (const page of await renderPages(rootDir)) {
        this.emitFile({
          type: "asset",
          fileName: page.route,
          source: page.html,
        });
      }
      this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
      for (const [fileName, assetPath] of STATIC_ASSETS) {
        this.emitFile({
          type: "asset",
          fileName,
          source: readFileSync(resolve(rootDir, assetPath)),
        });
      }
      // Per-page Open Graph cards (assets/og/<slug>.png → /og/<slug>.png).
      const ogDir = resolve(rootDir, "assets/og");
      if (existsSync(ogDir)) {
        for (const file of readdirSync(ogDir)) {
          if (!file.endsWith(".png")) continue;
          this.emitFile({
            type: "asset",
            fileName: `og/${file}`,
            source: readFileSync(resolve(ogDir, file)),
          });
        }
      }
    },
    closeBundle() {
      rmSync(resolve(rootDir, "dist/docs/.vite"), { force: true, recursive: true });
    },
  };
}

async function renderPages(rootDir: string): Promise<Array<MarkdownPage & { html: string }>> {
  const compile = await loadMarkdownCompiler();
  const pages = [...readGuidePages(rootDir), ...buildApiPages(rootDir)].sort((left, right) =>
    left.route.localeCompare(right.route),
  );
  return Promise.all(
    pages.map(async (page) => ({
      ...page,
      html: renderHtml(page, await compile(page.markdown), pages, ogImageFor(rootDir, page.route)),
    })),
  );
}

/** Resolves the Open Graph image path for a route, preferring a per-page card. */
function ogImageFor(rootDir: string, route: string): string {
  if (route === "index.html") {
    return "/og.png";
  }
  const slug = route.replace(/\/index\.html$/, "").replace(/\//g, "-");
  const cardPath = resolve(rootDir, "assets/og", `${slug}.png`);
  return existsSync(cardPath) ? `/og/${slug}.png` : "/og.png";
}
