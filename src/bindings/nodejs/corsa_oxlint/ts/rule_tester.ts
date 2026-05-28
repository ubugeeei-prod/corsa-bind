import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { RuleTester as OxlintRuleTester } from "oxlint/plugins-dev";

import { mergeTypeAwareParserOptions } from "./context";
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

const cleanupDirs = new Set<string>();
let cleanupInstalled = false;

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
    this.#config = config;
    this.#inner = new OxlintRuleTester(config);
  }

  run(ruleName: string, rule: Record<string, unknown>, tests: TestCases): void {
    const transformed = {
      valid: tests.valid.map((test, index) =>
        prepareTestCase(createWorkspace(), test, this.#config, "valid", index),
      ),
      invalid: tests.invalid.map((test, index) =>
        prepareTestCase(createWorkspace(), test, this.#config, "invalid", index),
      ),
    };
    this.#inner.run(ruleName, decorateRule(rule as never) as never, transformed as TestCases);
  }
}

function createWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "corsa-oxlint-"));
  registerCleanup(workspace);
  return workspace;
}

function prepareTestCase(
  workspace: string,
  test: string | TestCase,
  config: RuleTesterConfig | undefined,
  group: "valid" | "invalid",
  index: number,
): string | TestCase {
  if (typeof test === "string") {
    const filename = resolve(workspace, `${group}-${index}.ts`);
    writeFixture(filename, test);
    return test;
  }
  const filename = resolve(workspace, test.filename ?? `${group}-${index}.ts`);
  writeFixture(filename, test.code);
  const testerConfig = config;
  const baseSettings = testerConfig?.settings?.corsaOxlint;
  const caseSettings = (
    test.settings as {
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
        tsconfigRootDir: workspace,
        projectService: {
          allowDefaultProject: ["*.ts", "*.tsx", "*.js", "*.jsx"],
        },
      },
    ),
    mergeTypeAwareParserOptions(
      config?.languageOptions?.parserOptions as TypeAwareParserOptions | undefined,
      test.languageOptions?.parserOptions as TypeAwareParserOptions | undefined,
    ),
  );
  return {
    ...test,
    filename,
    settings: {
      ...testerConfig?.settings,
      ...test.settings,
      corsaOxlint: {
        ...testerConfig?.settings?.corsaOxlint,
        ...(test.settings as { corsaOxlint?: CorsaOxlintSettings })?.corsaOxlint,
        parserOptions,
      },
    } as never,
    languageOptions: {
      ...config?.languageOptions,
      ...test.languageOptions,
      parserOptions: {
        ...parserOptions,
      } as never,
    },
  };
}

function writeFixture(filename: string, code: string): void {
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, code);
  const configPath = resolve(dirname(filename), "tsconfig.json");
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
  if (cleanupInstalled) {
    return;
  }
  cleanupInstalled = true;
  process.on("exit", () => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}
