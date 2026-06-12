import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultCorsaExecutable } from "./context";
import { RuleTester } from "./rule_tester";
import {
  implementedNativeRuleNames,
  pendingNativeRuleNames,
  corsaOxlintPlugin,
  corsaOxlintRules,
} from "./rules";
import defaultCorsaOxlintPlugin from "./rules";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const upstreamRulesDir = resolve(workspaceRoot, ".cache/tsgolint_upstream/internal/rules");
const realCorsaBinary = optionalDefaultCorsaExecutable(workspaceRoot) ?? "";
const upstreamCase = existsSync(upstreamRulesDir) ? it : it.skip;
const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;

function optionalDefaultCorsaExecutable(rootDir: string): string | undefined {
  try {
    return defaultCorsaExecutable(rootDir);
  } catch {
    return undefined;
  }
}

describe("corsa oxlint native rules", () => {
  it("exports the native plugin surface", () => {
    expect(defaultCorsaOxlintPlugin).toBe(corsaOxlintPlugin);
    expect(Object.keys(corsaOxlintPlugin.rules ?? {}).sort()).toEqual(
      [...implementedNativeRuleNames].sort(),
    );
  });

  upstreamCase("tracks implemented and pending upstream rule names", () => {
    const upstreamRules = readdirSync(upstreamRulesDir)
      .filter((entry) => entry !== "fixtures")
      .filter((entry) => statSync(join(upstreamRulesDir, entry)).isDirectory())
      .filter((entry) => existsSync(join(upstreamRulesDir, entry, `${entry}.go`)))
      .map((entry) => entry.replaceAll("_", "-"))
      .sort();

    expect([...implementedNativeRuleNames, ...pendingNativeRuleNames].sort()).toEqual(
      upstreamRules,
    );
  });

  integrationCase("runs await-thenable through RuleTester", () => {
    createTester().run("await-thenable", corsaOxlintRules["await-thenable"] as never, {
      valid: [{ code: "async function ok() { await Promise.resolve('value'); }" }],
      invalid: [{ code: "async function nope() { await 1; }", errors: 1 }],
    });
  });

  integrationCase("runs no-array-delete through RuleTester", () => {
    createTester().run("no-array-delete", corsaOxlintRules["no-array-delete"] as never, {
      valid: [{ code: "const record = { value: 1 }; delete record.value;" }],
      invalid: [{ code: "const values = [1, 2, 3]; delete values[0];", errors: 1 }],
    });
  });

  integrationCase("runs no-base-to-string through RuleTester", () => {
    createTester().run("no-base-to-string", corsaOxlintRules["no-base-to-string"] as never, {
      valid: [{ code: "const label = `${1}`;" }],
      invalid: [{ code: "const label = `${{ value: 1 }}`;", errors: 1 }],
    });
  });

  integrationCase("runs no-floating-promises through RuleTester", () => {
    createTester().run("no-floating-promises", corsaOxlintRules["no-floating-promises"] as never, {
      valid: [{ code: "async function ok() { void Promise.resolve(1); }" }],
      invalid: [{ code: "async function nope() { Promise.resolve(1); }", errors: 1 }],
    });
  });

  integrationCase("runs no-for-in-array through RuleTester", () => {
    createTester().run("no-for-in-array", corsaOxlintRules["no-for-in-array"] as never, {
      valid: [{ code: "for (const key in { value: 1 }) { console.log(key); }" }],
      invalid: [
        {
          code: "for (const key in [1, 2, 3]) { console.log(key); }",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-implied-eval through RuleTester", () => {
    createTester().run("no-implied-eval", corsaOxlintRules["no-implied-eval"] as never, {
      valid: [{ code: "setTimeout(() => 1, 0);" }],
      invalid: [{ code: "setTimeout('alert(1)', 0);", errors: 1 }],
    });
  });

  integrationCase("runs no-meaningless-void-operator through RuleTester", () => {
    createTester().run(
      "no-meaningless-void-operator",
      corsaOxlintRules["no-meaningless-void-operator"] as never,
      {
        valid: [],
        invalid: [
          {
            code: "void (undefined as void);",
            errors: [{ messageId: "meaninglessVoidOperator" }],
          },
        ],
      },
    );
  });

  integrationCase("runs no-mixed-enums through RuleTester", () => {
    createTester().run("no-mixed-enums", corsaOxlintRules["no-mixed-enums"] as never, {
      valid: [{ code: "enum Numeric { A, B = 2, C = 3 }" }],
      invalid: [{ code: "enum Mixed { A = 1, B = 'two' }", errors: 1 }],
    });
  });

  integrationCase("runs no-unsafe-assignment through RuleTester", () => {
    createTester().run("no-unsafe-assignment", corsaOxlintRules["no-unsafe-assignment"] as never, {
      valid: [{ code: "declare const value: any; const safe: unknown = value;" }],
      invalid: [{ code: "declare const value: any; const unsafe: string = value;", errors: 1 }],
    });
  });

  integrationCase("runs no-unsafe-call through RuleTester", () => {
    createTester().run("no-unsafe-call", corsaOxlintRules["no-unsafe-call"] as never, {
      valid: [{ code: "declare const fn: () => void; fn();" }],
      invalid: [
        {
          code: "declare const fn: unknown; (fn as any)();",
          errors: [{ messageId: "unsafeCall" }],
        },
        {
          code: "declare const Ctor: unknown; new (Ctor as any)();",
          errors: [{ messageId: "unsafeNew" }],
        },
        {
          code: "declare const tag: unknown; (tag as any)`value`;",
          errors: [{ messageId: "unsafeTemplateTag" }],
        },
      ],
    });
  });

  integrationCase("runs no-unsafe-member-access through RuleTester", () => {
    createTester().run(
      "no-unsafe-member-access",
      corsaOxlintRules["no-unsafe-member-access"] as never,
      {
        valid: [{ code: "declare const value: { prop: string }; value.prop;" }],
        invalid: [
          {
            code: "declare const value: unknown; (value as any).prop;",
            errors: [{ messageId: "unsafeMemberExpression" }],
          },
          {
            code: `
              declare const value: { prop: string };
              declare const key: unknown;
              value[key as any];
            `,
            errors: [{ messageId: "unsafeComputedMemberAccess" }],
          },
        ],
      },
    );
  });

  integrationCase("runs no-unsafe-return through RuleTester", () => {
    createTester().run("no-unsafe-return", corsaOxlintRules["no-unsafe-return"] as never, {
      valid: [{ code: "declare const value: any; function ok(): unknown { return value; }" }],
      invalid: [
        { code: "declare const value: any; function nope(): string { return value; }", errors: 1 },
      ],
    });
  });

  integrationCase("runs no-unsafe-type-assertion through RuleTester", () => {
    createTester().run(
      "no-unsafe-type-assertion",
      corsaOxlintRules["no-unsafe-type-assertion"] as never,
      {
        valid: [{ code: "declare const value: any; value as unknown;" }],
        invalid: [
          {
            code: "declare const value: any; value as string;",
            errors: 1,
          },
          {
            code: "declare const value: unknown; value as any;",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs no-unsafe-unary-minus through RuleTester", () => {
    createTester().run(
      "no-unsafe-unary-minus",
      corsaOxlintRules["no-unsafe-unary-minus"] as never,
      {
        valid: [{ code: "const value = -1n;" }],
        invalid: [{ code: "const value = -'1';", errors: 1 }],
      },
    );
  });

  integrationCase("runs only-throw-error through RuleTester", () => {
    createTester().run("only-throw-error", corsaOxlintRules["only-throw-error"] as never, {
      valid: [{ code: "throw new Error('boom');" }],
      invalid: [{ code: "throw 'boom';", errors: 1 }],
    });
  });

  integrationCase("runs prefer-find through RuleTester", () => {
    createTester().run("prefer-find", corsaOxlintRules["prefer-find"] as never, {
      valid: [{ code: "items.find((item) => item.id === id);" }],
      invalid: [{ code: "items.filter((item) => item.id === id)[0];", errors: 1 }],
    });
  });

  integrationCase("runs prefer-includes through RuleTester", () => {
    createTester().run("prefer-includes", corsaOxlintRules["prefer-includes"] as never, {
      valid: [{ code: "items.includes(value);" }],
      invalid: [{ code: "items.indexOf(value) !== -1;", errors: 1 }],
    });
  });

  integrationCase("runs prefer-promise-reject-errors through RuleTester", () => {
    createTester().run(
      "prefer-promise-reject-errors",
      corsaOxlintRules["prefer-promise-reject-errors"] as never,
      {
        valid: [{ code: "Promise.reject(new Error('boom'));" }],
        invalid: [{ code: "Promise.reject('boom');", errors: 1 }],
      },
    );
  });

  integrationCase("runs prefer-reduce-type-parameter through RuleTester", () => {
    createTester().run(
      "prefer-reduce-type-parameter",
      corsaOxlintRules["prefer-reduce-type-parameter"] as never,
      {
        valid: [{ code: "const result = [1, 2, 3].reduce<number[]>((acc, value) => acc, []);" }],
        invalid: [
          {
            code: "const result = [1, 2, 3].reduce((acc, value) => acc, [] as number[]);",
            errors: [{ messageId: "preferTypeParameter" }],
          },
        ],
      },
    );
  });

  integrationCase("runs prefer-regexp-exec through RuleTester", () => {
    createTester().run("prefer-regexp-exec", corsaOxlintRules["prefer-regexp-exec"] as never, {
      valid: [{ code: "/a/g.exec(text);" }],
      invalid: [{ code: "text.match(/a/);", errors: 1 }],
    });
  });

  integrationCase("runs prefer-string-starts-ends-with through RuleTester", () => {
    createTester().run(
      "prefer-string-starts-ends-with",
      corsaOxlintRules["prefer-string-starts-ends-with"] as never,
      {
        valid: [{ code: "const ok = text.startsWith(prefix) || text.endsWith(suffix);" }],
        invalid: [{ code: "const broken = text.indexOf(prefix) === 0;", errors: 1 }],
      },
    );
  });

  integrationCase("runs require-array-sort-compare through RuleTester", () => {
    createTester().run(
      "require-array-sort-compare",
      corsaOxlintRules["require-array-sort-compare"] as never,
      {
        valid: [{ code: "values.sort((left, right) => left - right);" }],
        invalid: [{ code: "const values = [3, 2, 1]; values.sort();", errors: 1 }],
      },
    );
  });

  const pendingParityRuleCases = [
    {
      ruleName: "dot-notation",
      tests: {
        valid: [{ code: "const record = { value: 1 }; record.value;" }],
        invalid: [{ code: "const record = { value: 1 }; record['value'];", errors: 1 }],
      },
    },
    {
      ruleName: "no-duplicate-type-constituents",
      tests: {
        valid: [{ code: "type Value = string | number;" }],
        invalid: [{ code: "type Value = string | string;", errors: 1 }],
      },
    },
    {
      ruleName: "no-unsafe-argument",
      tests: {
        valid: [
          { code: "function take(value: unknown) {} declare const value: any; take(value);" },
        ],
        invalid: [
          {
            code: "function take(value: string) {} declare const value: any; take(value);",
            errors: 1,
          },
        ],
      },
    },
    {
      ruleName: "require-await",
      tests: {
        valid: [
          { code: "async function ok() { await Promise.resolve(1); }" },
          { code: "async function ok() { return Promise.resolve(1); }" },
        ],
        invalid: [
          { code: "async function nope() { return 1; }", errors: 1 },
          {
            code: "async function outer() { async function inner() { await Promise.resolve(1); } return 1; }",
            errors: 1,
          },
        ],
      },
    },
    {
      ruleName: "return-await",
      tests: {
        valid: [
          {
            code: "async function ok() { try { return await Promise.resolve(1); } catch { return 0; } }",
          },
        ],
        invalid: [
          { code: "async function nope() { return await Promise.resolve(1); }", errors: 1 },
          {
            code: "async function nope() { try { return Promise.resolve(1); } catch { return 0; } }",
            errors: 1,
          },
        ],
      },
    },
    {
      ruleName: "no-unnecessary-type-arguments",
      tests: {
        valid: [{ code: "function value<T>(input: T): T { return input; } value<string>('x');" }],
        invalid: [
          {
            code: "function value<T = string>(input: T): T { return input; } value<string>('x');",
            errors: 1,
          },
        ],
      },
    },
    {
      ruleName: "no-unnecessary-type-conversion",
      tests: {
        valid: [{ code: "const value = String(1);" }],
        invalid: [{ code: "const value = String('value');", errors: 1 }],
      },
    },
  ] as const;

  for (const { ruleName, tests } of pendingParityRuleCases) {
    integrationCase(`runs ${ruleName} pending parity rule through RuleTester`, () => {
      createTester().run(ruleName, corsaOxlintRules[ruleName] as never, tests as never);
    });
  }

  integrationCase("runs restrict-plus-operands through RuleTester", () => {
    createTester().run(
      "restrict-plus-operands",
      corsaOxlintRules["restrict-plus-operands"] as never,
      {
        valid: [{ code: "const result = '1' + 1;" }],
        invalid: [
          {
            code: "const result = '1' + 1;",
            options: [{ allowNumberAndString: false }],
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs restrict-template-expressions through RuleTester", () => {
    createTester().run(
      "restrict-template-expressions",
      corsaOxlintRules["restrict-template-expressions"] as never,
      {
        valid: [{ code: "const label = `${1}-${true}`;" }],
        invalid: [{ code: "const label = `${{ value: 1 }}`;", errors: 1 }],
      },
    );
  });

  integrationCase("runs use-unknown-in-catch-callback-variable through RuleTester", () => {
    createTester().run(
      "use-unknown-in-catch-callback-variable",
      corsaOxlintRules["use-unknown-in-catch-callback-variable"] as never,
      {
        valid: [
          {
            code: "Promise.resolve(1).catch((error: unknown) => console.error(error));",
          },
        ],
        invalid: [
          {
            code: "Promise.resolve(1).catch((error: Error) => console.error(error));",
            errors: 1,
          },
        ],
      },
    );
  });
});

function createTester(): RuleTester {
  return new RuleTester({
    settings: {
      corsaOxlint: {
        parserOptions: {
          corsa: {
            executable: realCorsaBinary,
          },
        },
      },
    },
  } as never);
}
