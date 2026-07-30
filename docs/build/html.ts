import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompiledMarkdown, MarkdownPage } from "./types.ts";

const SITE_NAME = "corsa-bind";

// Public base URL of the deployed documentation site, used for absolute
// Open Graph / Twitter card URLs. Update this to match the actual deploy
// domain if the site moves off GitHub Pages.
const SITE_URL = "https://ubugeeei-prod.github.io/corsa-bind";

const DEFAULT_DESCRIPTION =
  "Native Rust and JavaScript bindings for the Corsa TypeScript checker — type-aware Oxlint, stdio API + LSP, and zero-cost hot paths.";

const NAV_GROUPS = [
  {
    title: "Start",
    routes: ["index.html", "getting_started/index.html", "project_guide/index.html"],
  },
  {
    title: "Use",
    routes: [
      "nodejs_binding/index.html",
      "language_bindings/index.html",
      "oxlint_guide/index.html",
      "native_rules/index.html",
    ],
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
  ["getting_started/index.html", "Getting started"],
  ["project_guide/index.html", "Architecture"],
  ["nodejs_binding/index.html", "Node.js binding"],
  ["language_bindings/index.html", "Language bindings"],
  ["oxlint_guide/index.html", "Type-aware Oxlint"],
  ["native_rules/index.html", "Native rules"],
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
  ogImagePath = "/og.png",
): string {
  const title = compiled.title || titleFromRoute(page.route);
  const fullTitle = title === SITE_NAME ? SITE_NAME : `${title} - ${SITE_NAME}`;
  const frontmatterDescription = compiled.frontmatter?.description;
  const description =
    typeof frontmatterDescription === "string" ? frontmatterDescription : DEFAULT_DESCRIPTION;
  const pageUrl = `${SITE_URL}/${page.route === "index.html" ? "" : page.route}`;
  const ogImage = `${SITE_URL}${ogImagePath}`;
  const isHome = page.route === "index.html";
  const body = rewriteMarkdownLinks(compiled.html);
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(fullTitle)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="icon" href="/logo-mark.svg" type="image/svg+xml">
  <link rel="canonical" href="${escapeHtml(pageUrl)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${escapeHtml(fullTitle)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(pageUrl)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${escapeHtml(fullTitle)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(fullTitle)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <style>${themeCss()}</style>
  <style>${siteCss()}</style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <a class="brand" href="/index.html">
        <span class="brand-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15 H13 V49 H20"/><path d="M44 15 H51 V49 H44"/><path d="M24 24 L32 32 L24 40"/><path d="M33 24 L41 32 L33 40"/></svg></span>
        <span>
          <strong>${SITE_NAME}</strong>
          <small>Docs</small>
        </span>
      </a>
      <nav aria-label="Documentation">${renderNav(nav, page.route)}</nav>
    </aside>
    <div class="content-shell${isHome ? " is-home-shell" : ""}">
      ${isHome ? renderHero(description) : ""}
      <main class="void-md${isHome ? " is-home" : ""}">${body}</main>
      ${renderPager(nav, page.route)}
    </div>
  </div>
  ${mermaidScript()}
</body>
</html>`;
}

/**
 * Client-side Mermaid renderer. The static pipeline emits ```mermaid fences as
 * ordinary `language-mermaid` code blocks; this turns them into rendered SVG in
 * the browser. Mermaid is only fetched on pages that actually contain a
 * diagram, and the source is read from the inner `<code>` so the language label
 * and copy button never leak into the graph definition.
 */
function mermaidScript(): string {
  return `<script type="module">
  const wrappers = [...document.querySelectorAll('[class*="language-mermaid"]')]
    .filter((el) => !(el.parentElement && el.parentElement.closest('[class*="language-mermaid"]')));
  if (wrappers.length) {
    const mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')).default;
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
    for (const wrapper of wrappers) {
      const code = wrapper.querySelector('code') ?? wrapper;
      const pre = document.createElement('pre');
      pre.className = 'mermaid';
      pre.textContent = code.textContent.replace(/\\n+$/, '');
      wrapper.replaceWith(pre);
    }
    await mermaid.run({ querySelector: 'pre.mermaid' });
  }
</script>`;
}

/** The landing-page hero: a two-column intro with a live code sample. */
function renderHero(_description: string): string {
  const mark = `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15 H13 V49 H20"/><path d="M44 15 H51 V49 H44"/><path d="M24 24 L32 32 L24 40"/><path d="M33 24 L41 32 L33 40"/></svg>`;
  const k = (text: string) => `<span class="tk-k">${text}</span>`;
  const s = (text: string) => `<span class="tk-s">${escapeHtml(text)}</span>`;
  const p = (text: string) => `<span class="tk-p">${escapeHtml(text)}</span>`;
  const code = [
    `${k("import")} { OxlintUtils } ${k("from")} ${s('"corsa-oxlint"')}${p(";")}`,
    ``,
    `${k("export")} ${k("const")} rule = createRule({`,
    `  create(context) {`,
    `    ${k("const")} services = OxlintUtils.getParserServices(context)${p(";")}`,
    `    ${k("const")} checker = services.program.getTypeChecker()${p(";")}`,
    `    ${k("return")} {`,
    `      AwaitExpression(node) {`,
    `        ${k("const")} type = checker.getTypeAtLocation(node.argument)${p(";")}`,
    `        ${k("if")} (!isThenable(type)) context.report({ node })${p(";")}`,
    `      },`,
    `    };`,
    `  },`,
    `});`,
  ].join("\n");
  return `<header class="hero">
    <div class="hero-copy">
      <span class="hero-eyebrow"><span class="hero-mark" aria-hidden="true">${mark}</span>Rust · Node · C ABI</span>
      <h1 class="hero-title"><span>corsa</span><span class="hero-title-dim">-bind</span></h1>
      <p class="hero-tagline">Author <strong>type-aware lint rules</strong> with real <strong>Corsa</strong> types — plus a stdio API&nbsp;+ LSP and zero-cost hot paths. No forks, no patches.</p>
      <div class="hero-actions">
        <a class="hero-button primary" href="/getting_started/">Get started</a>
        <a class="hero-button" href="https://github.com/ubugeeei/corsa-bind">GitHub<span class="hero-arrow" aria-hidden="true">↗</span></a>
      </div>
      <ul class="hero-badges" aria-label="Highlights">
        <li>type-aware custom rules</li>
        <li>59 tsgolint-parity rules</li>
        <li>real types from Corsa</li>
      </ul>
    </div>
    <figure class="hero-code" aria-label="Authoring a type-aware custom rule with corsa-oxlint">
      <figcaption class="hero-code-bar"><span></span><span></span><span></span><em>no-floating-await.ts</em></figcaption>
      <pre><code>${code}</code></pre>
    </figure>
  </header>`;
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
