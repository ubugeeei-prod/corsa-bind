import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester as OxlintRuleTester } from "oxlint/plugins-dev";

import { defaultCorsaExecutable, mergeTypeAwareParserOptions } from "./context";
import { decorateRule } from "./plugin";
import type { CorsaOxlintSettings, TypeAwareParserOptions } from "./types";

type TesterConfig = import("oxlint/plugins-dev").RuleTester.Config;
type TestCase = import("oxlint/plugins-dev").RuleTester.ValidTestCase &
  Partial<import("oxlint/plugins-dev").RuleTester.InvalidTestCase>;
type TestCases = import("oxlint/plugins-dev").RuleTester.TestCases;
export type RuleTesterConfig = TesterConfig & {
  readonly settings?: {
    readonly corsaOxlint?: CorsaOxlintSettings;
    readonly [key: string]: unknown;
  };
};
type TestLifecycleGlobal = typeof globalThis & {
  after?: (callback: () => void) => unknown;
  afterAll?: (callback: () => void) => unknown;
};

const cleanupDirs = new Set<string>();
let cleanupInstalled = false;
const ruleTesterModulePath = fileURLToPath(import.meta.url);

export class RuleTester {
  /**
   * A thin Oxlint `RuleTester` wrapper that injects
   * `settings.corsaOxlint`
   * settings, temporary fixtures, and a default project service.
   *
   * @example
   * ```ts
   * const tester = new RuleTester();
   * tester.run("demo", rule, {
   *   valid: [{ code: "const answer = 42;" }],
   *   invalid: [],
   * });
   * ```
   */
  static get describe() {
    return OxlintRuleTester.describe;
  }

  static set describe(value) {
    OxlintRuleTester.describe = value;
  }

  static get it() {
    return OxlintRuleTester.it;
  }

  static set it(value) {
    OxlintRuleTester.it = value;
  }

  static only(item: string | TestCase): TestCase {
    return OxlintRuleTester.only(item);
  }

  readonly #inner: OxlintRuleTester;
  readonly #config?: RuleTesterConfig;

  constructor(config?: RuleTesterConfig) {
    this.#config = normalizeRuleTesterConfig(config);
    this.#inner = new OxlintRuleTester(this.#config);
  }

  run(ruleName: string, rule: Record<string, unknown>, tests: TestCases): void {
    const workspace = createWorkspace();
    const transformed = {
      valid: tests.valid.map((test, index) =>
        prepareTestCase(workspace, test, this.#config, "valid", index),
      ),
      invalid: tests.invalid.map((test, index) =>
        prepareTestCase(workspace, test, this.#config, "invalid", index),
      ),
    };
    this.#inner.run(ruleName, decorateRule(rule as never) as never, transformed as TestCases);
  }
}

function createWorkspace(): string {
  const root = process.env.CORSA_OXLINT_RULE_TESTER_TMPDIR ?? tmpdir();
  const workspace = mkdtempSync(join(root, "corsa-oxlint-"));
  registerCleanup(workspace);
  return workspace;
}

function prepareTestCase(
  workspace: string,
  test: string | TestCase,
  config: RuleTesterConfig | undefined,
  group: "valid" | "invalid",
  index: number,
): TestCase {
  const caseWorkspace = resolve(workspace, `${group}-${index}`);
  const normalized = typeof test === "string" ? ({ code: test } as TestCase) : test;
  const filename = resolveCaseFilename(caseWorkspace, normalized.filename, "case.ts");
  const projectRoot = isAbsolute(normalized.filename ?? "") ? dirname(filename) : caseWorkspace;
  writeFixture(filename, normalized.code, projectRoot);
  const testerConfig = config;
  const baseSettings = testerConfig?.settings?.corsaOxlint;
  const caseSettings = (
    normalized.settings as {
      corsaOxlint?: CorsaOxlintSettings;
    }
  )?.corsaOxlint;
  const parserOptions = mergeTypeAwareParserOptions(
    mergeTypeAwareParserOptions(
      mergeTypeAwareParserOptions(
        mergeTypeAwareParserOptions(baseSettings, baseSettings?.parserOptions),
        mergeTypeAwareParserOptions(caseSettings, caseSettings?.parserOptions),
      ),
      {
        tsconfigRootDir: projectRoot,
        projectService: {
          allowDefaultProject: ["*.ts", "*.tsx", "*.js", "*.jsx"],
        },
      },
    ),
    mergeTypeAwareParserOptions(
      config?.languageOptions?.parserOptions as TypeAwareParserOptions | undefined,
      normalized.languageOptions?.parserOptions as TypeAwareParserOptions | undefined,
    ),
  );
  const parserOptionsWithRuntime = applyRuleTesterRuntimeDefaults(
    parserOptions,
    normalized,
    config,
  );
  return {
    ...normalized,
    filename,
    settings: {
      ...testerConfig?.settings,
      ...normalized.settings,
      corsaOxlint: {
        ...testerConfig?.settings?.corsaOxlint,
        ...(normalized.settings as { corsaOxlint?: CorsaOxlintSettings })?.corsaOxlint,
        parserOptions: parserOptionsWithRuntime,
      },
    } as never,
    languageOptions: {
      ...config?.languageOptions,
      ...normalized.languageOptions,
      parserOptions: {
        ...parserOptionsWithRuntime,
      } as never,
    },
  };
}

function resolveCaseFilename(
  caseWorkspace: string,
  filename: string | undefined,
  fallback: string,
): string {
  if (!filename) {
    return resolve(caseWorkspace, fallback);
  }
  return isAbsolute(filename) ? filename : resolve(caseWorkspace, filename);
}

function applyRuleTesterRuntimeDefaults(
  parserOptions: TypeAwareParserOptions,
  test: TestCase,
  config: RuleTesterConfig | undefined,
): TypeAwareParserOptions {
  if (parserOptions.corsa?.executable !== undefined) {
    return parserOptions;
  }
  const rootDir = resolveRuleTesterRuntimeRoot(test, config);
  if (!rootDir) {
    return parserOptions;
  }
  const executable = process.env.CORSA_EXECUTABLE ?? optionalDefaultCorsaExecutable(rootDir);
  if (!executable) {
    return parserOptions;
  }
  return mergeTypeAwareParserOptions(parserOptions, {
    corsa: {
      executable,
    },
  });
}

function normalizeRuleTesterConfig(
  config: RuleTesterConfig | undefined,
): RuleTesterConfig | undefined {
  const cwd = config?.cwd === undefined ? resolveCallingTestDirectory() : resolve(config.cwd);
  if (!cwd) {
    return config;
  }
  return config ? { ...config, cwd } : ({ cwd } as RuleTesterConfig);
}

function resolveRuleTesterRuntimeRoot(
  test: TestCase,
  config: RuleTesterConfig | undefined,
): string | undefined {
  if (test.cwd !== undefined) {
    return resolve(test.cwd);
  }
  if (config?.cwd !== undefined) {
    return resolve(config.cwd);
  }
  if (test.filename && isAbsolute(test.filename)) {
    return dirname(test.filename);
  }
  return undefined;
}

function resolveCallingTestDirectory(): string | undefined {
  const stack = new Error().stack;
  if (!stack) {
    return undefined;
  }
  for (const line of stack.split("\n")) {
    const filename = stackLineFilePath(line);
    if (!filename || resolve(filename) === ruleTesterModulePath) {
      continue;
    }
    return dirname(filename);
  }
  return undefined;
}

function stackLineFilePath(line: string): string | undefined {
  const trimmed = line.trim();
  const parenthesized = /\((?<location>.+)\)$/.exec(trimmed)?.groups?.location;
  const location = parenthesized ?? trimmed.replace(/^at\s+/, "");
  const positioned = /^(?<specifier>.+):\d+:\d+$/.exec(location)?.groups?.specifier;
  if (!positioned || positioned.startsWith("node:")) {
    return undefined;
  }
  if (positioned.startsWith("file://")) {
    return fileURLToPath(positioned);
  }
  return isAbsolute(positioned) ? positioned : undefined;
}

function optionalDefaultCorsaExecutable(rootDir: string): string | undefined {
  try {
    return defaultCorsaExecutable(rootDir);
  } catch {
    return undefined;
  }
}

function writeFixture(filename: string, code: string, projectRoot: string): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, code);
  writeProjectConfig(resolve(projectRoot, "tsconfig.json"));
}

function writeProjectConfig(configPath: string): void {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          module: "esnext",
          target: "es2022",
          strict: true,
        },
        include: ["**/*"],
      },
      null,
      2,
    ),
  );
}

function registerCleanup(workspace: string): void {
  cleanupDirs.add(workspace);
  const afterAll = lifecycleCleanup();
  if (afterAll) {
    afterAll(() => cleanupWorkspace(workspace));
  }
  if (cleanupInstalled) {
    return;
  }
  cleanupInstalled = true;
  process.once("beforeExit", cleanupAllWorkspaces);
  process.once("exit", cleanupAllWorkspaces);
}

function lifecycleCleanup(): ((callback: () => void) => unknown) | undefined {
  const testGlobal = globalThis as TestLifecycleGlobal;
  return typeof testGlobal.afterAll === "function"
    ? testGlobal.afterAll
    : typeof testGlobal.after === "function"
      ? testGlobal.after
      : undefined;
}

function cleanupWorkspace(workspace: string): void {
  if (!cleanupDirs.delete(workspace)) {
    return;
  }
  rmSync(workspace, { force: true, recursive: true });
}

function cleanupAllWorkspaces(): void {
  for (const dir of cleanupDirs) {
    cleanupWorkspace(dir);
  }
}
