import { RuleTester } from "corsa-oxlint";

import { isMain } from "../shared.ts";
import { noStringPlusNumberRule } from "./custom_rule.ts";
import { createExampleSettings } from "./shared.ts";

export function runRuleTesterExample() {
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

  tester.run("no-string-plus-number", noStringPlusNumberRule, {
    valid: [{ code: 'const text = "a" + "b";', settings }],
    invalid: [
      {
        code: 'const broken = "value" + 1;',
        errors: [{ messageId: "unexpected" }],
        settings,
      },
    ],
  });

  return {
    executed,
    ruleName: "no-string-plus-number",
  };
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runRuleTesterExample(), null, 2));
}
