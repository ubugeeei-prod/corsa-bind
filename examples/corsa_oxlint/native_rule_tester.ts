import { RuleTester } from "corsa-oxlint";
import { corsaOxlintRules } from "corsa-oxlint/rules";

import { isMain } from "../shared.ts";
import { createExampleSettings } from "./shared.ts";

export function runNativeRuleTesterExample() {
  const executed: string[] = [];

  RuleTester.describe = ((name: string, callback: () => void) => {
    executed.push(`describe:${name}`);
    callback();
  }) as typeof RuleTester.describe;

  RuleTester.it = ((name: string, callback: () => void) => {
    executed.push(`it:${name}`);
    callback();
  }) as typeof RuleTester.it;

  const tester = new RuleTester();
  const settings = createExampleSettings() as never;

  tester.run("no-unsafe-assignment", corsaOxlintRules["no-unsafe-assignment"] as never, {
    valid: [{ code: "declare const value: any; const safe: unknown = value;", settings }],
    invalid: [
      {
        code: "declare const value: any; const unsafe: string = value;",
        errors: [{ messageId: "unsafe" }],
        settings,
      },
    ],
  });

  tester.run(
    "prefer-string-starts-ends-with",
    corsaOxlintRules["prefer-string-starts-ends-with"] as never,
    {
      valid: [{ code: "const ok = text.startsWith(prefix);", settings }],
      invalid: [
        {
          code: "const broken = text.slice(0, prefix.length) === prefix;",
          errors: [{ messageId: "startsWith" }],
          settings,
        },
      ],
    },
  );

  return {
    executed,
    ruleNames: ["no-unsafe-assignment", "prefer-string-starts-ends-with"],
  };
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runNativeRuleTesterExample(), null, 2));
}
