import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultTsgoExecutable } from "./context";
import { RuleTester } from "./rule_tester";
import {
  implementedNativeRuleNames,
  pendingNativeRuleNames,
  typescriptOxlintPlugin,
  typescriptOxlintRules,
} from "./rules";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const upstreamRulesDir = resolve(workspaceRoot, ".cache/tsgolint_upstream/internal/rules");
const realTsgoBinary = defaultTsgoExecutable(workspaceRoot);
const upstreamCase = existsSync(upstreamRulesDir) ? it : it.skip;
const integrationCase = existsSync(realTsgoBinary) ? it : it.skip;

describe("corsa-oxlint native rules", () => {
  it("exports the native plugin surface", () => {
    expect(Object.keys(typescriptOxlintPlugin.rules ?? {}).sort()).toEqual(
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
    createTester().run("await-thenable", typescriptOxlintRules["await-thenable"] as never, {
      valid: [{ code: "async function ok() { await Promise.resolve('value'); }" }],
      invalid: [{ code: "async function nope() { await 1; }", errors: 1 }],
    });
  });

  integrationCase("runs no-array-delete through RuleTester", () => {
    createTester().run("no-array-delete", typescriptOxlintRules["no-array-delete"] as never, {
      valid: [{ code: "const record = { value: 1 }; delete record.value;" }],
      invalid: [{ code: "const values = [1, 2, 3]; delete values[0];", errors: 1 }],
    });
  });

  integrationCase("runs no-base-to-string through RuleTester", () => {
    createTester().run("no-base-to-string", typescriptOxlintRules["no-base-to-string"] as never, {
      valid: [{ code: "const label = `${1}`;" }],
      invalid: [{ code: "const label = `${{ value: 1 }}`;", errors: 1 }],
    });
  });

  integrationCase("runs no-floating-promises through RuleTester", () => {
    createTester().run(
      "no-floating-promises",
      typescriptOxlintRules["no-floating-promises"] as never,
      {
        valid: [{ code: "async function ok() { void Promise.resolve(1); }" }],
        invalid: [{ code: "async function nope() { Promise.resolve(1); }", errors: 1 }],
      },
    );
  });

  integrationCase("runs no-for-in-array through RuleTester", () => {
    createTester().run("no-for-in-array", typescriptOxlintRules["no-for-in-array"] as never, {
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
    createTester().run("no-implied-eval", typescriptOxlintRules["no-implied-eval"] as never, {
      valid: [{ code: "setTimeout(() => 1, 0);" }],
      invalid: [{ code: "setTimeout('alert(1)', 0);", errors: 1 }],
    });
  });

  integrationCase("runs no-mixed-enums through RuleTester", () => {
    createTester().run("no-mixed-enums", typescriptOxlintRules["no-mixed-enums"] as never, {
      valid: [{ code: "enum Numeric { A, B = 2, C = 3 }" }],
      invalid: [{ code: "enum Mixed { A = 1, B = 'two' }", errors: 1 }],
    });
  });

  integrationCase("runs no-unsafe-assignment through RuleTester", () => {
    createTester().run(
      "no-unsafe-assignment",
      typescriptOxlintRules["no-unsafe-assignment"] as never,
      {
        valid: [{ code: "declare const value: any; const safe: unknown = value;" }],
        invalid: [{ code: "declare const value: any; const unsafe: string = value;", errors: 1 }],
      },
    );
  });

  integrationCase("runs no-unsafe-call through RuleTester", () => {
    createTester().run("no-unsafe-call", typescriptOxlintRules["no-unsafe-call"] as never, {
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

  integrationCase("runs no-unsafe-return through RuleTester", () => {
    createTester().run("no-unsafe-return", typescriptOxlintRules["no-unsafe-return"] as never, {
      valid: [{ code: "declare const value: any; function ok(): unknown { return value; }" }],
      invalid: [
        { code: "declare const value: any; function nope(): string { return value; }", errors: 1 },
      ],
    });
  });

  integrationCase("runs no-unsafe-unary-minus through RuleTester", () => {
    createTester().run(
      "no-unsafe-unary-minus",
      typescriptOxlintRules["no-unsafe-unary-minus"] as never,
      {
        valid: [{ code: "const value = -1n;" }],
        invalid: [{ code: "const value = -'1';", errors: 1 }],
      },
    );
  });

  integrationCase("runs only-throw-error through RuleTester", () => {
    createTester().run("only-throw-error", typescriptOxlintRules["only-throw-error"] as never, {
      valid: [{ code: "throw new Error('boom');" }],
      invalid: [{ code: "throw 'boom';", errors: 1 }],
    });
  });

  integrationCase("runs prefer-find through RuleTester", () => {
    createTester().run("prefer-find", typescriptOxlintRules["prefer-find"] as never, {
      valid: [{ code: "items.find((item) => item.id === id);" }],
      invalid: [{ code: "items.filter((item) => item.id === id)[0];", errors: 1 }],
    });
  });

  integrationCase("runs prefer-includes through RuleTester", () => {
    createTester().run("prefer-includes", typescriptOxlintRules["prefer-includes"] as never, {
      valid: [{ code: "items.includes(value);" }],
      invalid: [{ code: "items.indexOf(value) !== -1;", errors: 1 }],
    });
  });

  integrationCase("runs prefer-promise-reject-errors through RuleTester", () => {
    createTester().run(
      "prefer-promise-reject-errors",
      typescriptOxlintRules["prefer-promise-reject-errors"] as never,
      {
        valid: [{ code: "Promise.reject(new Error('boom'));" }],
        invalid: [{ code: "Promise.reject('boom');", errors: 1 }],
      },
    );
  });

  integrationCase("runs prefer-regexp-exec through RuleTester", () => {
    createTester().run("prefer-regexp-exec", typescriptOxlintRules["prefer-regexp-exec"] as never, {
      valid: [{ code: "/a/g.exec(text);" }],
      invalid: [{ code: "text.match(/a/);", errors: 1 }],
    });
  });

  integrationCase("runs prefer-string-starts-ends-with through RuleTester", () => {
    createTester().run(
      "prefer-string-starts-ends-with",
      typescriptOxlintRules["prefer-string-starts-ends-with"] as never,
      {
        valid: [{ code: "const ok = text.startsWith(prefix) || text.endsWith(suffix);" }],
        invalid: [{ code: "const broken = text.indexOf(prefix) === 0;", errors: 1 }],
      },
    );
  });

  integrationCase("runs require-array-sort-compare through RuleTester", () => {
    createTester().run(
      "require-array-sort-compare",
      typescriptOxlintRules["require-array-sort-compare"] as never,
      {
        valid: [{ code: "values.sort((left, right) => left - right);" }],
        invalid: [{ code: "const values = [3, 2, 1]; values.sort();", errors: 1 }],
      },
    );
  });

  integrationCase("runs restrict-plus-operands through RuleTester", () => {
    createTester().run(
      "restrict-plus-operands",
      typescriptOxlintRules["restrict-plus-operands"] as never,
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
      typescriptOxlintRules["restrict-template-expressions"] as never,
      {
        valid: [{ code: "const label = `${1}-${true}`;" }],
        invalid: [{ code: "const label = `${{ value: 1 }}`;", errors: 1 }],
      },
    );
  });

  integrationCase("runs use-unknown-in-catch-callback-variable through RuleTester", () => {
    createTester().run(
      "use-unknown-in-catch-callback-variable",
      typescriptOxlintRules["use-unknown-in-catch-callback-variable"] as never,
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
      typescriptOxlint: {
        parserOptions: {
          tsgo: {
            executable: realTsgoBinary,
          },
        },
      },
    },
  } as never);
}
