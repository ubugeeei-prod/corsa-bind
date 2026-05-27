import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { CompiledMarkdown } from "./types.ts";

type Compile = (source: string, options?: unknown) => Promise<CompiledMarkdown>;

let compileMarkdown: Promise<Compile> | undefined;

/** Loads the Ox Content Markdown compiler shipped by `@void/md`. */
export function loadMarkdownCompiler(): Promise<Compile> {
  compileMarkdown ??= loadCompiler();
  return compileMarkdown;
}

async function loadCompiler(): Promise<Compile> {
  const pluginPath = fileURLToPath(import.meta.resolve("@void/md/plugin"));
  const compilerPath = compilerModulePath(dirname(pluginPath));
  const mod = (await import(pathToFileURL(compilerPath).href)) as { compile: Compile };
  return mod.compile;
}

function compilerModulePath(distDir: string): string {
  const fileName = readdirSync(distDir).find((entry) => /^compile-.*\.mjs$/.test(entry));
  if (!fileName) {
    throw new Error(`Could not find the Ox Content compiler module in ${distDir}`);
  }
  return join(distDir, fileName);
}
