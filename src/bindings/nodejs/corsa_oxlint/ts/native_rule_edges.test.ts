import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { defaultCorsaExecutable } from "./context";
import { RuleTester } from "./rule_tester";
import { corsaOxlintRules } from "./rules";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realCorsaBinary = defaultCorsaExecutable(workspaceRoot);
const integrationCase = existsSync(realCorsaBinary) ? it : it.skip;

describe("corsa oxlint native rule edges", () => {
  integrationCase("covers array and enum edge cases", () => {
    const tester = createTester();

    tester.run("no-array-delete", corsaOxlintRules["no-array-delete"] as never, {
      valid: [
        {
          code: "const record = { value: 1 }; delete record.value;",
        },
      ],
      invalid: [
        {
          code: "const values = [1, 2, 3]; const index = 1; delete values[index];",
          errors: [{ messageId: "unexpected" }],
        },
      ],
    });

    tester.run("no-mixed-enums", corsaOxlintRules["no-mixed-enums"] as never, {
      valid: [
        {
          code: "enum Labels { A = 'two', B = 'three' }",
        },
      ],
      invalid: [
        {
          code: "const label = 'two' as const; enum Mixed { A = 1, B = label }",
          errors: [{ messageId: "mixed" }],
        },
      ],
    });
  });

  integrationCase("covers base-to-string edge cases", () => {
    const tester = createTester();

    tester.run("no-base-to-string", corsaOxlintRules["no-base-to-string"] as never, {
      valid: [
        {
          code: "const label = `${new Date()}`;",
        },
      ],
      invalid: [
        {
          code: "const label = String({ value: 1 });",
          errors: [{ messageId: "unexpected" }],
        },
      ],
    });
  });

  integrationCase("covers unsafe assignment edge cases", () => {
    const tester = createTester();

    tester.run("no-unsafe-assignment", corsaOxlintRules["no-unsafe-assignment"] as never, {
      valid: [
        {
          code: "declare const value: any; const safe: unknown = value;",
        },
      ],
      invalid: [
        {
          code: "declare const value: Set<any>; const unsafe: Set<string> = value;",
          errors: [{ messageId: "unsafe" }],
        },
        {
          code: "declare const value: any; const unsafe = value;",
          errors: [{ messageId: "unsafe" }],
        },
      ],
    });
  });

  integrationCase("covers unsafe return edge cases", () => {
    const tester = createTester();

    tester.run("no-unsafe-return", corsaOxlintRules["no-unsafe-return"] as never, {
      valid: [
        {
          code: "declare const value: any; const fn = (): unknown => value;",
        },
      ],
      invalid: [
        {
          code: "declare const value: Promise<any>; async function unsafe(): Promise<string> { return value; }",
          errors: [{ messageId: "unsafe" }],
        },
      ],
    });
  });

  integrationCase("covers unary minus, promise reject, and sort edge cases", () => {
    const tester = createTester();

    tester.run("no-unsafe-unary-minus", corsaOxlintRules["no-unsafe-unary-minus"] as never, {
      valid: [
        {
          code: "declare const value: bigint; const result = -value;",
        },
        {
          code: "declare const value: any; const result = -value;",
        },
      ],
      invalid: [
        {
          code: "declare const value: string | number; const result = -value;",
          errors: [{ messageId: "unaryMinus" }],
        },
      ],
    });

    tester.run(
      "prefer-promise-reject-errors",
      corsaOxlintRules["prefer-promise-reject-errors"] as never,
      {
        valid: [
          {
            code: "new Promise((resolve, reject) => reject(new Error('boom')));",
          },
          {
            code: "Promise.reject();",
            options: [{ allowEmptyReject: true }],
          },
          {
            code: "Promise.reject(undefined as unknown);",
            options: [{ allowThrowingUnknown: true }],
          },
        ],
        invalid: [
          {
            code: "new Promise((resolve, reject) => reject('boom'));",
            errors: [{ messageId: "rejectAnError" }],
          },
        ],
      },
    );

    tester.run(
      "require-array-sort-compare",
      corsaOxlintRules["require-array-sort-compare"] as never,
      {
        valid: [
          {
            code: "const values = ['b', 'a']; values.sort();",
          },
        ],
        invalid: [
          {
            code: "const values = ['b', 'a']; values.sort();",
            options: [{ ignoreStringArrays: false }],
            errors: [{ messageId: "requireCompare" }],
          },
        ],
      },
    );
  });

  integrationCase("covers prefer-string-starts-ends-with edge cases", () => {
    const tester = createTester();

    tester.run(
      "prefer-string-starts-ends-with",
      corsaOxlintRules["prefer-string-starts-ends-with"] as never,
      {
        valid: [
          {
            code: "const matches = text.startsWith(prefix) || text.endsWith(suffix);",
          },
        ],
        invalid: [
          {
            code: "const starts = text.slice(0, prefix.length) === prefix;",
            errors: [{ messageId: "startsWith" }],
          },
          {
            code: "const ends = text.slice(-suffix.length) === suffix;",
            errors: [{ messageId: "endsWith" }],
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
