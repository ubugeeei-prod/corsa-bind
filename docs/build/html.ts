import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompiledMarkdown, MarkdownPage } from "./types.ts";

/** Renders a complete static HTML document for one compiled Markdown page. */
export function renderHtml(
  page: MarkdownPage,
  compiled: CompiledMarkdown,
  nav: readonly MarkdownPage[],
): string {
  const title = compiled.title || titleFromRoute(page.route);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - corsa</title>
  <style>${themeCss()}</style>
  <style>${siteCss()}</style>
</head>
<body>
  <aside>
    <a class="brand" href="/index.html">corsa</a>
    <nav>${renderNav(nav, page.route)}</nav>
  </aside>
  <main class="void-md">${rewriteMarkdownLinks(compiled.html)}</main>
</body>
</html>`;
}

function renderNav(pages: readonly MarkdownPage[], activeRoute: string): string {
  return pages
    .map((page) => {
      const label = titleFromRoute(page.route);
      const active = page.route === activeRoute ? ' aria-current="page"' : "";
      return `<a href="/${page.route}"${active}>${escapeHtml(label)}</a>`;
    })
    .join("");
}

function rewriteMarkdownLinks(html: string): string {
  return html.replace(/href="\.\/([^"#]+)\.md(#[^"]*)?"/g, (_match, path: string, hash = "") => {
    const route = path.endsWith("/index") ? path.replace(/\/index$/, "") : `${path}/`;
    return `href="/${route}${hash}"`;
  });
}

function titleFromRoute(route: string): string {
  const trimmed = route.replace(/\/index\.html$/, "").replace(/^api-?/, "api ");
  const name = trimmed || "overview";
  return name
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function themeCss(): string {
  const themePath = fileURLToPath(import.meta.resolve("@void/md/theme-content.css"));
  return inlineCssImports(themePath, new Set());
}

function siteCss(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "site.css"), "utf8");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function inlineCssImports(path: string, seen: Set<string>): string {
  if (seen.has(path)) {
    return "";
  }
  seen.add(path);
  const css = readFileSync(path, "utf8");
  return css.replace(/@import\s+['"]\.\/([^'"]+)['"];/g, (_match, fileName: string) =>
    inlineCssImports(join(dirname(path), fileName), seen),
  );
}
