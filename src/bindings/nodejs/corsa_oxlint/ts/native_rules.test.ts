import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nativeLintRuleMetas } from "@corsa-bind/napi";

import { RuleTester } from "./rule_tester";
import { integrationCase as resolveIntegrationCase, resolvedRealCorsaBinary } from "./test_support";
import {
  implementedNativeRuleNames,
  pendingNativeRuleNames,
  corsaOxlintPlugin,
  corsaOxlintRules,
} from "./rules";
import defaultCorsaOxlintPlugin from "./rules";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const upstreamRulesDir = resolve(workspaceRoot, ".cache/tsgolint_upstream/internal/rules");
const realCorsaBinary = resolvedRealCorsaBinary() ?? "";
const upstreamCase = existsSync(upstreamRulesDir) ? it : it.skip;
const integrationCase = resolveIntegrationCase();

describe("corsa oxlint native rules", () => {
  it("exports the native plugin surface", () => {
    const nativeRuleNames = nativeLintRuleMetas().map((meta) => meta.name);

    expect(nativeRuleNames.sort()).toEqual([...implementedNativeRuleNames].sort());
    expect(defaultCorsaOxlintPlugin).toBe(corsaOxlintPlugin);
    expect(Object.keys(corsaOxlintPlugin.rules ?? {}).sort()).toEqual(
      [...implementedNativeRuleNames].sort(),
    );
    for (const name of implementedNativeRuleNames) {
      expect(corsaOxlintRules[name].meta?.docs?.requiresTypeChecking).toBe(true);
    }
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
          {
            code: [
              "interface SymbolConstructor { readonly asyncDispose: unique symbol; }",
              "interface AsyncDisposable { [Symbol.asyncDispose](): PromiseLike<void>; }",
              "declare const resource: AsyncDisposable;",
              "async function ok() { await using value = resource; }",
            ].join("\n"),
          },
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

  integrationCase("runs no-misused-promises conditional checks through RuleTester", () => {
    createTester().run("no-misused-promises", corsaOxlintRules["no-misused-promises"] as never, {
      valid: [
        { code: "async function ok() { if (await Promise.resolve(true)) { console.log(1); } }" },
      ],
      invalid: [
        {
          code: "async function nope() { if (Promise.resolve(true)) { console.log(1); } }",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-misused-promises void-return argument checks through RuleTester", () => {
    createTester().run("no-misused-promises", corsaOxlintRules["no-misused-promises"] as never, {
      valid: [
        {
          code: "declare function takes(cb: () => Promise<void>): void; takes(async () => {});",
        },
      ],
      invalid: [
        {
          code: "declare function takes(cb: () => void): void; takes(async () => {});",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-unsafe-argument through RuleTester", () => {
    createTester().run("no-unsafe-argument", corsaOxlintRules["no-unsafe-argument"] as never, {
      valid: [
        { code: "declare function takes(value: number): void; takes(1);" },
      ],
      invalid: [
        {
          code: "declare function takes(value: number): void; declare const loose: any; takes(loose);",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-floating-promises ignoreVoid=false through RuleTester", () => {
    createTester().run("no-floating-promises", corsaOxlintRules["no-floating-promises"] as never, {
      valid: [
        { code: "async function ok() { void Promise.resolve(1); }" },
        {
          code: "async function ok() { await Promise.resolve(1); }",
          options: [{ ignoreVoid: false }],
        },
      ],
      invalid: [
        {
          code: "async function nope() { void Promise.resolve(1); }",
          options: [{ ignoreVoid: false }],
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-floating-promises ignoreIIFE through RuleTester", () => {
    createTester().run("no-floating-promises", corsaOxlintRules["no-floating-promises"] as never, {
      valid: [
        {
          code: "(async () => { console.log(1); })();",
          options: [{ ignoreIIFE: true }],
        },
      ],
      invalid: [{ code: "(async () => { console.log(1); })();", errors: 1 }],
    });
  });

  integrationCase("runs only-throw-error through RuleTester", () => {
    createTester().run("only-throw-error", corsaOxlintRules["only-throw-error"] as never, {
      valid: [
        { code: "function ok() { throw new Error('boom'); }" },
        { code: "function ok(value: any) { throw value; }" },
        { code: "try { console.log(1); } catch (error) { throw error; }" },
      ],
      invalid: [
        { code: "function nope() { throw 'boom'; }", errors: 1 },
        {
          code: "function nope(value: any) { throw value; }",
          options: [{ allowThrowingAny: false, allowThrowingUnknown: false }],
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-base-to-string options through RuleTester", () => {
    createTester().run("no-base-to-string", corsaOxlintRules["no-base-to-string"] as never, {
      valid: [
        { code: "declare const mystery: unknown; const label = `${mystery}`;" },
        { code: "const fn = () => 1; const label = `${fn}`;" },
        { code: "const names = ['a', 'b']; const label = `${names}`;" },
      ],
      invalid: [
        {
          code: "declare const mystery: unknown; const label = `${mystery}`;",
          options: [{ checkUnknown: true }],
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-unsafe-enum-comparison through RuleTester", () => {
    createTester().run(
      "no-unsafe-enum-comparison",
      corsaOxlintRules["no-unsafe-enum-comparison"] as never,
      {
        valid: [
          {
            code: "enum Fruit { Apple, Banana } declare const fruit: Fruit; if (fruit === Fruit.Apple) { console.log(1); }",
          },
        ],
        invalid: [
          {
            code: "enum Fruit { Apple, Banana } declare const fruit: Fruit; if (fruit === 99) { console.log(1); }",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs no-redundant-type-constituents through RuleTester", () => {
    createTester().run(
      "no-redundant-type-constituents",
      corsaOxlintRules["no-redundant-type-constituents"] as never,
      {
        valid: [{ code: "type Union = string | number; declare const value: Union;" }],
        invalid: [
          { code: "type Redundant = string | 'literal'; declare const value: Redundant;", errors: 1 },
          { code: "type WithAny = any | number; declare const value: WithAny;", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs require-await generator yields through RuleTester", () => {
    createTester().run("require-await", corsaOxlintRules["require-await"] as never, {
      valid: [
        {
          code: "async function* fine() { yield Promise.resolve(1); }",
        },
      ],
      invalid: [
        { code: "async function* nope() { yield 1; }", errors: 1 },
      ],
    });
  });

  integrationCase("runs unbound-method through RuleTester", () => {
    createTester().run("unbound-method", corsaOxlintRules["unbound-method"] as never, {
      valid: [
        {
          code: "class Greeter { greet() { return 'hi'; } } const greeter = new Greeter(); greeter.greet();",
        },
        {
          code: "class Counter { static count() { return 1; } } const counted = Counter.count;",
          options: [{ ignoreStatic: true }],
        },
      ],
      invalid: [
        {
          code: "class Greeter { greet() { return 'hi'; } } const greeter = new Greeter(); const method = greeter.greet;",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-misused-spread through RuleTester", () => {
    createTester().run("no-misused-spread", corsaOxlintRules["no-misused-spread"] as never, {
      valid: [
        { code: "const parts = ['a', 'b']; const merged = [...parts];" },
        { code: "const source = { value: 1 }; const clone = { ...source };" },
      ],
      invalid: [
        { code: "const text = 'hello'; const letters = [...text];", errors: 1 },
        {
          code: "const lookup = new Map<string, number>(); const clone = { ...lookup };",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs no-duplicate-type-constituents through RuleTester", () => {
    createTester().run(
      "no-duplicate-type-constituents",
      corsaOxlintRules["no-duplicate-type-constituents"] as never,
      {
        valid: [{ code: "type Fine = string | number; declare const value: Fine;" }],
        invalid: [
          { code: "type Duplicated = string | string; declare const value: Duplicated;", errors: 1 },
          {
            code: "type Aliased = string; type Duplicated = Aliased | string; declare const value: Duplicated;",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs strict-boolean-expressions through RuleTester", () => {
    createTester().run(
      "strict-boolean-expressions",
      corsaOxlintRules["strict-boolean-expressions"] as never,
      {
        valid: [
          { code: "declare const flag: boolean; if (flag) { console.log(1); }" },
        ],
        invalid: [
          {
            code: "declare const greeting: string | undefined; if (greeting) { console.log(1); }",
            options: [{ allowNullableString: false }],
            errors: 1,
          },
          {
            code: "declare const count: number; if (count) { console.log(1); }",
            options: [{ allowNumber: false }],
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs switch-exhaustiveness-check through RuleTester", () => {
    createTester().run(
      "switch-exhaustiveness-check",
      corsaOxlintRules["switch-exhaustiveness-check"] as never,
      {
        valid: [
          {
            code: "type Kind = 'a' | 'b'; declare const kind: Kind; switch (kind) { case 'a': break; case 'b': break; }",
          },
        ],
        invalid: [
          {
            code: "type Kind = 'a' | 'b' | 'c'; declare const kind: Kind; switch (kind) { case 'a': break; }",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs prefer-nullish-coalescing through RuleTester", () => {
    createTester().run(
      "prefer-nullish-coalescing",
      corsaOxlintRules["prefer-nullish-coalescing"] as never,
      {
        valid: [
          { code: "declare const nickname: string | undefined; const label = nickname ?? 'anonymous';" },
        ],
        invalid: [
          {
            code: "declare const nickname: string | undefined; const label = nickname || 'anonymous';",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs no-unnecessary-type-assertion through RuleTester", () => {
    createTester().run(
      "no-unnecessary-type-assertion",
      corsaOxlintRules["no-unnecessary-type-assertion"] as never,
      {
        valid: [
          { code: "declare const wide: string | undefined; const narrowed = wide as string;" },
        ],
        invalid: [
          { code: "declare const narrow: string; const same = narrow as string;", errors: 1 },
          { code: "declare const definite: string; const asserted = definite!;", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs related-getter-setter-pairs through RuleTester", () => {
    createTester().run(
      "related-getter-setter-pairs",
      corsaOxlintRules["related-getter-setter-pairs"] as never,
      {
        valid: [
          {
            code: "class Box { #value = ''; get value(): string { return this.#value; } set value(next: string) { this.#value = next; } }",
          },
        ],
        invalid: [
          {
            code: "class Box { #value = ''; get value(): string { return this.#value; } set value(next: number) { this.#value = String(next); } }",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs strict-void-return through RuleTester", () => {
    createTester().run("strict-void-return", corsaOxlintRules["strict-void-return"] as never, {
      valid: [
        { code: "declare function on(cb: () => void): void; on(() => undefined);" },
      ],
      invalid: [
        { code: "declare function on(cb: () => void): void; on(() => 123);", errors: 1 },
      ],
    });
  });

  integrationCase("runs prefer-optional-chain through RuleTester", () => {
    createTester().run(
      "prefer-optional-chain",
      corsaOxlintRules["prefer-optional-chain"] as never,
      {
        valid: [
          { code: "declare const holder: { value?: { size: number } }; holder.value?.size;" },
        ],
        invalid: [
          {
            code: "declare const holder: { value?: { size: number } } | undefined; holder && holder.value;",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs no-unnecessary-boolean-literal-compare through RuleTester", () => {
    createTester().run(
      "no-unnecessary-boolean-literal-compare",
      corsaOxlintRules["no-unnecessary-boolean-literal-compare"] as never,
      {
        valid: [
          {
            code: "declare const maybe: boolean | undefined; if (maybe === true) { console.log(1); }",
          },
        ],
        invalid: [
          {
            code: "declare const definitely: boolean; if (definitely === true) { console.log(1); }",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs return-await through RuleTester", () => {
    createTester().run("return-await", corsaOxlintRules["return-await"] as never, {
      valid: [
        {
          code: "async function ok() { try { return await Promise.resolve(1); } catch { return 0; } }",
        },
      ],
      invalid: [
        {
          code: "async function nope() { try { return Promise.resolve(1); } catch { return 0; } }",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs promise-function-async through RuleTester", () => {
    createTester().run(
      "promise-function-async",
      corsaOxlintRules["promise-function-async"] as never,
      {
        valid: [
          { code: "async function fine(): Promise<number> { return 1; }" },
        ],
        invalid: [
          { code: "function nope(): Promise<number> { return Promise.resolve(1); }", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs consistent-return through RuleTester", () => {
    createTester().run("consistent-return", corsaOxlintRules["consistent-return"] as never, {
      valid: [
        { code: "function fine(flag: boolean): number { if (flag) { return 1; } return 0; }" },
      ],
      invalid: [
        {
          code: "function nope(flag: boolean) { if (flag) { return 1; } return; }",
          errors: 1,
        },
      ],
    });
  });

  integrationCase("runs prefer-return-this-type through RuleTester", () => {
    createTester().run(
      "prefer-return-this-type",
      corsaOxlintRules["prefer-return-this-type"] as never,
      {
        valid: [
          { code: "class Builder { build(): this { return this; } }" },
        ],
        invalid: [
          { code: "class Builder { build(): Builder { return this; } }", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs non-nullable-type-assertion-style through RuleTester", () => {
    createTester().run(
      "non-nullable-type-assertion-style",
      corsaOxlintRules["non-nullable-type-assertion-style"] as never,
      {
        valid: [
          { code: "declare const wide: string | number; const narrowed = wide as string;" },
        ],
        invalid: [
          {
            code: "declare const maybe: string | undefined; const definite = maybe as string;",
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs dot-notation through RuleTester", () => {
    createTester().run("dot-notation", corsaOxlintRules["dot-notation"] as never, {
      valid: [
        { code: "const record = { value: 1 }; record.value;" },
        {
          code: "const record = { snake_case: 1 } as Record<string, number>; record['snake_case'];",
          options: [{ allowPattern: "^[a-z]+(_[a-z]+)+$" }],
        },
      ],
      invalid: [{ code: "const record = { value: 1 }; record['value'];", errors: 1 }],
    });
  });

  integrationCase("runs consistent-type-exports through RuleTester", () => {
    createTester().run(
      "consistent-type-exports",
      corsaOxlintRules["consistent-type-exports"] as never,
      {
        valid: [
          { code: "const runtimeValue = 1; export { runtimeValue };" },
          { code: "type Shape = { size: number }; export type { Shape };" },
        ],
        invalid: [
          { code: "type Shape = { size: number }; export { Shape };", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs no-confusing-void-expression through RuleTester", () => {
    createTester().run(
      "no-confusing-void-expression",
      corsaOxlintRules["no-confusing-void-expression"] as never,
      {
        valid: [
          { code: "declare function log(): void; log();" },
        ],
        invalid: [
          { code: "declare function log(): void; const result = log();", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs no-unnecessary-template-expression through RuleTester", () => {
    createTester().run(
      "no-unnecessary-template-expression",
      corsaOxlintRules["no-unnecessary-template-expression"] as never,
      {
        valid: [
          { code: "declare const count: number; const label = `${count}`;" },
        ],
        invalid: [
          { code: "declare const already: string; const copy = `${already}`;", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs no-unnecessary-type-conversion through RuleTester", () => {
    createTester().run(
      "no-unnecessary-type-conversion",
      corsaOxlintRules["no-unnecessary-type-conversion"] as never,
      {
        valid: [
          { code: "declare const count: number; const text = String(count);" },
        ],
        invalid: [
          { code: "declare const already: string; const copy = String(already);", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs no-unnecessary-type-parameters through RuleTester", () => {
    createTester().run(
      "no-unnecessary-type-parameters",
      corsaOxlintRules["no-unnecessary-type-parameters"] as never,
      {
        valid: [
          { code: "function pick<Value>(items: Value[], index: number): Value { return items[index]; }" },
        ],
        invalid: [
          { code: "function only<Value>(value: Value): void { console.log(value); }", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs no-useless-default-assignment through RuleTester", () => {
    createTester().run(
      "no-useless-default-assignment",
      corsaOxlintRules["no-useless-default-assignment"] as never,
      {
        valid: [
          { code: "function greet(who: string | undefined = 'world') { return who; }" },
        ],
        invalid: [
          { code: "function greet(who: string = 'world') { return who; }", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs prefer-readonly through RuleTester", () => {
    createTester().run("prefer-readonly", corsaOxlintRules["prefer-readonly"] as never, {
      valid: [
        {
          code: "class Counter { private count = 0; increment() { this.count += 1; } }",
        },
      ],
      invalid: [
        { code: "class Counter { private count = 0; read() { return this.count; } }", errors: 1 },
      ],
    });
  });

  integrationCase("runs restrict-template-expressions allow list through RuleTester", () => {
    createTester().run(
      "restrict-template-expressions",
      corsaOxlintRules["restrict-template-expressions"] as never,
      {
        valid: [
          { code: "declare const failure: Error; const label = `${failure}`;" },
          {
            code: "class Custom { toString() { return 'x'; } } declare const custom: Custom; const label = `${custom}`;",
            options: [{ allow: [{ from: "file", name: "Custom" }] }],
          },
        ],
        invalid: [
          {
            code: "declare const failure: Error; const label = `${failure}`;",
            options: [{ allow: [] }],
            errors: 1,
          },
        ],
      },
    );
  });

  integrationCase("runs prefer-string-starts-ends-with element equality through RuleTester", () => {
    createTester().run(
      "prefer-string-starts-ends-with",
      corsaOxlintRules["prefer-string-starts-ends-with"] as never,
      {
        valid: [
          { code: "declare const text: string; text.startsWith('a');" },
          {
            code: "declare const text: string; text[0] === 'a';",
            options: [{ allowSingleElementEquality: "always" }],
          },
        ],
        invalid: [
          { code: "declare const text: string; text[0] === 'a';", errors: 1 },
          { code: "declare const text: string; text[text.length - 1] === 'z';", errors: 1 },
        ],
      },
    );
  });

  integrationCase("runs switch-exhaustiveness-check defaultCaseCommentPattern through RuleTester", () => {
    createTester().run(
      "switch-exhaustiveness-check",
      corsaOxlintRules["switch-exhaustiveness-check"] as never,
      {
        valid: [
          {
            code: "type Kind = 'a' | 'b'; declare const kind: Kind; switch (kind) { case 'a': break; // skip exhaustiveness\n default: break; }",
            options: [{ defaultCaseCommentPattern: "skip exhaustiveness" }],
          },
        ],
        invalid: [
          {
            code: "type Kind = 'a' | 'b'; declare const kind: Kind; switch (kind) { case 'a': break; default: break; }",
            options: [{ defaultCaseCommentPattern: "skip exhaustiveness" }],
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
