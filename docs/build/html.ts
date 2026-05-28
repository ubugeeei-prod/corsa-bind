import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompiledMarkdown, MarkdownPage } from "./types.ts";

const SITE_NAME = "corsa-bind";

const NAV_GROUPS = [
  {
    title: "Start",
    routes: ["index.html", "project_guide/index.html"],
  },
  {
    title: "Run",
    routes: ["ci_guide/index.html", "performance/index.html", "benchmarking_guide/index.html"],
  },
  {
    title: "Ship",
    routes: [
      "production_readiness/index.html",
      "production_readiness_audit/index.html",
      "release_guide/index.html",
      "support_policy/index.html",
      "supply_chain_policy/index.html",
      "corsa_upstream_dependency/index.html",
    ],
  },
  {
    title: "Reference",
    routes: [
      "api/index.html",
      "api/corsa-bind-napi/index.html",
      "api/corsa-oxlint/index.html",
      "api/corsa-oxlint-rules/index.html",
      "api_reference/index.html",
    ],
  },
] as const;

const ROUTE_TITLES = new Map<string, string>([
  ["index.html", "Overview"],
  ["project_guide/index.html", "Architecture"],
  ["ci_guide/index.html", "CI and local checks"],
  ["performance/index.html", "Performance commands"],
  ["benchmarking_guide/index.html", "Benchmarking model"],
  ["production_readiness/index.html", "Production readiness"],
  ["production_readiness_audit/index.html", "Readiness audit"],
  ["release_guide/index.html", "Release process"],
  ["support_policy/index.html", "Support policy"],
  ["supply_chain_policy/index.html", "Supply chain"],
  ["corsa_upstream_dependency/index.html", "Upstream pin"],
  ["api/index.html", "API index"],
  ["api/corsa-bind-napi/index.html", "@corsa-bind/napi"],
  ["api/corsa-oxlint/index.html", "corsa-oxlint"],
  ["api/corsa-oxlint-rules/index.html", "Oxlint rules"],
  ["api_reference/index.html", "API docs generation"],
]);

/** Renders a complete static HTML document for one compiled Markdown page. */
export function renderHtml(
  page: MarkdownPage,
  compiled: CompiledMarkdown,
  nav: readonly MarkdownPage[],
): string {
  const title = compiled.title || titleFromRoute(page.route);
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - ${SITE_NAME}</title>
  <style>${themeCss()}</style>
  <style>${siteCss()}</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <a class="brand" href="/index.html">
        <span class="brand-mark">cb</span>
        <span>
          <strong>${SITE_NAME}</strong>
          <small>Docs</small>
        </span>
      </a>
      <nav aria-label="Documentation">${renderNav(nav, page.route)}</nav>
    </aside>
    <div class="content-shell">
      <main class="void-md">${rewriteMarkdownLinks(compiled.html)}</main>
      ${renderPager(nav, page.route)}
    </div>
  </div>
</body>
</html>`;
}

function renderNav(pages: readonly MarkdownPage[], activeRoute: string): string {
  const byRoute = new Map(pages.map((page) => [page.route, page]));
  const seen = new Set<string>();
  const grouped = NAV_GROUPS.map((group) => {
    const links = group.routes
      .filter((route) => byRoute.has(route))
      .map((route) => {
        seen.add(route);
        return renderNavLink(route, activeRoute);
      })
      .join("");
    return links ? `<section><h2>${group.title}</h2>${links}</section>` : "";
  });
  const other = pages
    .filter((page) => !seen.has(page.route))
    .map((page) => renderNavLink(page.route, activeRoute));
  return [
    ...grouped,
    other.length ? `<section><h2>Other</h2>${other.join("")}</section>` : "",
  ].join("");
}

function renderNavLink(route: string, activeRoute: string): string {
  const active = route === activeRoute ? ' aria-current="page"' : "";
  return `<a href="/${route}"${active}>${escapeHtml(titleFromRoute(route))}</a>`;
}

function renderPager(pages: readonly MarkdownPage[], activeRoute: string): string {
  const ordered = orderedPages(pages);
  const current = ordered.findIndex((page) => page.route === activeRoute);
  if (current === -1) return "";
  const previous = ordered[current - 1];
  const next = ordered[current + 1];
  if (!previous && !next) return "";
  return `<footer class="pager" aria-label="Page navigation">${renderPagerLink(previous, "Previous")}${renderPagerLink(next, "Next")}</footer>`;
}

function renderPagerLink(page: MarkdownPage | undefined, label: string): string {
  if (!page) return "<span></span>";
  return `<a href="/${page.route}"><span>${label}</span><strong>${escapeHtml(titleFromRoute(page.route))}</strong></a>`;
}

function orderedPages(pages: readonly MarkdownPage[]): MarkdownPage[] {
  const byRoute = new Map(pages.map((page) => [page.route, page]));
  const orderedRoutes = NAV_GROUPS.flatMap((group) => [...group.routes]);
  const orderedRouteSet = new Set<string>(orderedRoutes);
  const ordered = orderedRoutes.flatMap((route) => byRoute.get(route) ?? []);
  const leftovers = pages.filter((page) => !orderedRouteSet.has(page.route));
  return [...ordered, ...leftovers];
}

function rewriteMarkdownLinks(html: string): string {
  return html.replace(/href="\.\/([^"#]+)\.md(#[^"]*)?"/g, (_match, path: string, hash = "") => {
    const route = path.endsWith("/index") ? path.replace(/\/index$/, "") : `${path}/`;
    return `href="/${route}${hash}"`;
  });
}

function titleFromRoute(route: string): string {
  const explicit = ROUTE_TITLES.get(route);
  if (explicit) return explicit;
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
