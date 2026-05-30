// Generates per-page Open Graph card images for the documentation site.
//
// For every guide page under docs/ (and the landing page) it renders a branded
// 1200x630 OG card as SVG and rasterizes it to PNG with the Chromium headless
// shell that Playwright already installs. The PNGs are committed under
// assets/og/ and copied verbatim into the built site by the docs Vite plugin.
//
// Usage: node scripts/build_og.mjs
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(root, 'docs');
const outDir = join(root, 'assets', 'og');
const tmpDir = join(root, '.cache', 'og-tmp');

const SITE = 'corsa-bind';
const URL = 'github.com/ubugeeei/corsa-bind';

/** Finds the Chromium headless shell that Playwright installs. */
function findChromeShell() {
  if (process.env.CHROME_HEADLESS_SHELL) return process.env.CHROME_HEADLESS_SHELL;
  const base = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(base)) {
    throw new Error(`Playwright cache not found at ${base}; set CHROME_HEADLESS_SHELL.`);
  }
  const versions = readdirSync(base)
    .filter((name) => name.startsWith('chromium_headless_shell-'))
    .sort()
    .reverse();
  for (const version of versions) {
    const dir = join(base, version);
    for (const arch of readdirSync(dir)) {
      const candidate = join(dir, arch, 'chrome-headless-shell');
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('chrome-headless-shell not found; run `npx playwright install chromium`.');
}

/** Minimal YAML front-matter reader for `title` / `description`. */
function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return fields;
}

function escapeXml(value) {
  return value.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch],
  );
}

/** Greedy word-wrap to at most `maxLines` lines of about `maxChars` each. */
function wrap(text, maxChars, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    const used = lines.join(' ').split(/\s+/).length;
    if (used < words.length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,]$/, '')}…`;
  }
  return lines;
}

const MARK = `<g stroke="#18181b" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none">
  <path d="M20 15 H13 V49 H20" /><path d="M44 15 H51 V49 H44" />
  <path d="M24 24 L32 32 L24 40" /><path d="M33 24 L41 32 L33 40" /></g>`;

/** The branded landing / default card (centered wordmark). */
function landingSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fafafa"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="#ffffff" stroke="#e4e4e7" stroke-width="2"/>
  <svg x="540" y="120" width="120" height="120" viewBox="0 0 64 64">${MARK}</svg>
  <text x="600" y="360" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="84" font-weight="700" letter-spacing="-2"><tspan fill="#18181b">corsa</tspan><tspan fill="#71717a" font-weight="500">-bind</tspan></text>
  <text x="600" y="430" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="30" font-weight="500" fill="#3f3f46">Native Rust &amp; JS bindings for the Corsa TypeScript checker</text>
  <line x1="380" y1="490" x2="820" y2="490" stroke="#e4e4e7" stroke-width="2"/>
  <text x="600" y="535" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24" fill="#71717a">type-aware Oxlint · stdio API + LSP · zero-cost hot paths</text>
</svg>`;
}

/** A documentation subpage card (left-aligned title + description). */
function pageSvg(title, description) {
  const titleLines = wrap(title, 26, 2);
  const descLines = wrap(description, 64, 3);
  const titleY = 250;
  const title_tspans = titleLines
    .map((line, i) => `<tspan x="90" dy="${i === 0 ? 0 : 84}">${escapeXml(line)}</tspan>`)
    .join('');
  const descY = titleY + titleLines.length * 84 + 30;
  const desc_tspans = descLines
    .map((line, i) => `<tspan x="90" dy="${i === 0 ? 0 : 42}">${escapeXml(line)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#fafafa"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="#ffffff" stroke="#e4e4e7" stroke-width="2"/>
  <svg x="90" y="90" width="56" height="56" viewBox="0 0 64 64">${MARK}</svg>
  <text x="162" y="118" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="32" font-weight="700" letter-spacing="-1"><tspan fill="#18181b">corsa</tspan><tspan fill="#71717a" font-weight="500">-bind</tspan></text>
  <text x="162" y="146" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="18" letter-spacing="3" fill="#a1a1aa">DOCS</text>
  <text y="${titleY}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="72" font-weight="700" letter-spacing="-2" fill="#18181b">${title_tspans}</text>
  <text y="${descY}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="30" font-weight="400" fill="#52525b">${desc_tspans}</text>
  <line x1="90" y1="520" x2="1110" y2="520" stroke="#e4e4e7" stroke-width="2"/>
  <text x="90" y="562" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="24" fill="#71717a">${URL}</text>
</svg>`;
}

function routeSlug(fileName) {
  const base = fileName.replace(/\.md$/, '');
  return base === 'index' ? 'index' : base.replace(/\//g, '-');
}

function rasterize(chrome, svg, outPath, label) {
  const svgPath = join(tmpDir, `${label}.svg`);
  writeFileSync(svgPath, svg);
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      `--screenshot=${outPath}`,
      '--window-size=1200,630',
      `file://${svgPath}`,
    ],
    { stdio: 'ignore' },
  );
}

const chrome = findChromeShell();
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const DEFAULT_DESCRIPTION =
  'Native Rust and JavaScript bindings for the Corsa TypeScript checker — type-aware Oxlint, stdio API + LSP, and zero-cost hot paths.';

let count = 0;
for (const entry of readdirSync(docsDir)) {
  if (!entry.endsWith('.md')) continue;
  const slug = routeSlug(entry);
  const fields = frontmatter(readFileSync(join(docsDir, entry), 'utf8'));
  if (slug === 'index') {
    rasterize(chrome, landingSvg(), join(root, 'assets', 'og.png'), 'index');
    count++;
    continue;
  }
  const title = fields.title || slug;
  const description = fields.description || DEFAULT_DESCRIPTION;
  rasterize(chrome, pageSvg(title, description), join(outDir, `${slug}.png`), slug);
  count++;
}

rmSync(tmpDir, { recursive: true, force: true });
console.log(`generated ${count} OG cards into assets/og/ (+ assets/og.png)`);
