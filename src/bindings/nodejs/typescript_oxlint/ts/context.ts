import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  ContextWithParserOptions,
  ProjectServiceOptions,
  ResolvedProjectConfig,
  ResolvedRuntimeOptions,
  TypeAwareParserOptions,
  TypescriptOxlintSettings,
} from "./types";

const DEFAULT_CACHE_LIFETIME_MS = 250;
const DEFAULT_PROJECT_PATTERNS = ["*.ts", "*.tsx", "*.js", "*.jsx"];
const DEFAULT_TS_CONFIG = {
  compilerOptions: {
    module: "esnext",
    target: "es2022",
    strict: true,
  },
};

export function defaultCorsaExecutable(rootDir: string, platform = process.platform): string {
  return resolve(rootDir, platform === "win32" ? ".cache/tsgo.exe" : ".cache/tsgo");
}

export const defaultTsgoExecutable = defaultCorsaExecutable;

export function resolveProjectConfig(context: ContextWithParserOptions): ResolvedProjectConfig {
  const filename = resolve(context.filename);
  const parserOptions = resolveTypeAwareParserOptions(context);
  const rootDir = resolve(parserOptions.tsconfigRootDir ?? context.cwd);
  const runtime = resolveRuntimeOptions(rootDir, parserOptions);
  const configPath =
    resolveExplicitProject(rootDir, parserOptions) ??
    discoverTsconfig(filename, rootDir) ??
    resolveDefaultProject(rootDir, filename, parserOptions.projectService);
  if (!configPath) {
    throw new Error(`corsa oxlint could not resolve a tsconfig for ${filename}`);
  }
  return { filename, rootDir, configPath, runtime };
}

/**
 * Resolves the type-aware parser options visible to a rule.
 *
 * Oxlint exposes a fixed `context.languageOptions.parserOptions` object at
 * runtime, so `corsa oxlint` stores its richer configuration under
 * `settings.typescriptOxlint` and rehydrates the rule-facing parser options
 * shape from there.
 *
 * @example
 * ```ts
 * const parserOptions = resolveTypeAwareParserOptions(context);
 * parserOptions.corsa?.mode;
 * ```
 */
export function resolveTypeAwareParserOptions(
  context: ContextWithParserOptions,
): TypeAwareParserOptions {
  return mergeTypeAwareParserOptions(
    resolveSettingsParserOptions(context.settings?.typescriptOxlint),
    mergeTypeAwareParserOptions(context.parserOptions, context.languageOptions?.parserOptions),
  );
}

function resolveRuntimeOptions(
  rootDir: string,
  parserOptions: TypeAwareParserOptions,
): ResolvedRuntimeOptions {
  const runtime = parserOptions.corsa ?? parserOptions.tsgo;
  return {
    executable: resolve(
      runtime?.executable ??
        process.env.CORSA_EXECUTABLE ??
        process.env.TSGO_EXECUTABLE ??
        defaultCorsaExecutable(rootDir),
    ),
    cwd: resolve(runtime?.cwd ?? rootDir),
    mode: runtime?.mode ?? "msgpack",
    cacheLifetimeMs: runtime?.cacheLifetimeMs ?? DEFAULT_CACHE_LIFETIME_MS,
  };
}

function resolveExplicitProject(
  rootDir: string,
  parserOptions: TypeAwareParserOptions,
): string | undefined {
  const projects = asArray(parserOptions.project).map((project) => {
    return resolve(rootDir, project);
  });
  return projects.find(existsSync);
}

function discoverTsconfig(filename: string, rootDir: string): string | undefined {
  let current = dirname(filename);
  const boundary = resolve(rootDir);
  while (current.startsWith(boundary)) {
    const candidate = resolve(current, "tsconfig.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

function resolveDefaultProject(
  rootDir: string,
  filename: string,
  projectService: boolean | ProjectServiceOptions | undefined,
): string | undefined {
  if (!projectService) {
    return undefined;
  }
  if (projectService !== true && projectService.defaultProject) {
    return resolve(rootDir, projectService.defaultProject);
  }
  if (!matchesDefaultProject(filename, projectService as true | ProjectServiceOptions)) {
    return undefined;
  }
  const id = Buffer.from(filename).toString("hex").slice(0, 24);
  const cacheDir = resolve(rootDir, ".cache/typescript_oxlint/default");
  const configPath = resolve(cacheDir, `${id}.tsconfig.json`);
  if (!existsSync(configPath)) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          ...DEFAULT_TS_CONFIG,
          files: [filename],
        },
        null,
        2,
      ),
    );
  }
  return configPath;
}

function matchesDefaultProject(
  filename: string,
  projectService: true | ProjectServiceOptions,
): boolean {
  const patterns =
    (projectService === true ? undefined : projectService.allowDefaultProject) ??
    DEFAULT_PROJECT_PATTERNS;
  return patterns.some((pattern: string) => globMatch(filename, pattern));
}

function globMatch(value: string, pattern: string): boolean {
  const escaped = pattern.replaceAll(".", "\\.").replaceAll("*", ".*");
  return new RegExp(`${escaped}$`).test(value);
}

function asArray(value: string | string[] | undefined): string[] {
  return value ? (Array.isArray(value) ? value : [value]) : [];
}

function resolveSettingsParserOptions(
  settings: TypescriptOxlintSettings | undefined,
): TypeAwareParserOptions {
  if (!settings) {
    return {};
  }
  const { parserOptions, ...inline } = settings;
  return mergeTypeAwareParserOptions(inline, parserOptions);
}

export function mergeTypeAwareParserOptions(
  base: TypeAwareParserOptions | undefined,
  override: TypeAwareParserOptions | undefined,
): TypeAwareParserOptions {
  if (!base) {
    return normalizeTypeAwareParserOptions(override ?? {});
  }
  if (!override) {
    return normalizeTypeAwareParserOptions(base);
  }
  const runtime = {
    ...(base.corsa ?? base.tsgo),
    ...(override.corsa ?? override.tsgo),
  };
  return {
    ...base,
    ...override,
    project: override.project ?? base.project,
    projectService: mergeProjectService(base.projectService, override.projectService),
    tsconfigRootDir: override.tsconfigRootDir ?? base.tsconfigRootDir,
    ...(Object.keys(runtime).length > 0 ? { corsa: runtime, tsgo: runtime } : {}),
  };
}

function normalizeTypeAwareParserOptions(options: TypeAwareParserOptions): TypeAwareParserOptions {
  const runtime = options.corsa ?? options.tsgo;
  if (!runtime) {
    return options;
  }
  return {
    ...options,
    corsa: runtime,
    tsgo: runtime,
  };
}

function mergeProjectService(
  base: boolean | ProjectServiceOptions | undefined,
  override: boolean | ProjectServiceOptions | undefined,
): boolean | ProjectServiceOptions | undefined {
  if (override === undefined) {
    return base;
  }
  if (typeof override === "boolean") {
    return override;
  }
  if (base === undefined || typeof base === "boolean") {
    return override;
  }
  return {
    ...base,
    ...override,
    allowDefaultProject: override.allowDefaultProject ?? base.allowDefaultProject,
    defaultProject: override.defaultProject ?? base.defaultProject,
  };
}
