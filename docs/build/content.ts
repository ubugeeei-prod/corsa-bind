import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { MarkdownPage } from "./types.ts";

/** Reads handwritten Markdown pages from `docs/`. */
export function readGuidePages(rootDir: string): MarkdownPage[] {
  const docsDir = join(rootDir, "docs");
  return readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const sourcePath = join(docsDir, entry.name);
      const route = routeForMarkdown(relative(docsDir, sourcePath));
      return {
        route,
        sourcePath,
        markdown: readFileSync(sourcePath, "utf8"),
      };
    });
}

/** Converts a Markdown source path into a static output route. */
export function routeForMarkdown(path: string): string {
  const withoutExtension = path.replace(/\.md$/, "");
  if (withoutExtension === "index") {
    return "index.html";
  }
  if (withoutExtension.endsWith("/index")) {
    return `${withoutExtension.slice(0, -"index".length)}index.html`;
  }
  return `${withoutExtension}/index.html`;
}
