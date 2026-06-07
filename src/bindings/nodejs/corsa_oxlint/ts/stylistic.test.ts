import { nativeStylisticRuleMetas, runNativeStylisticLint } from "@corsa-bind/napi";
import { describe, expect, it } from "vitest";

import { RuleTester } from "./rule_tester";
import {
  corsaStylisticPlugin,
  corsaStylisticRules,
  implementedStylisticRuleNames,
} from "./stylistic";
import defaultStylisticPlugin from "./stylistic";

describe("corsa stylistic rules", () => {
  it("exports a separate stylistic plugin surface", () => {
    expect(defaultStylisticPlugin).toBe(corsaStylisticPlugin);
    expect(Object.keys(corsaStylisticPlugin.rules ?? {}).sort()).toEqual(
      [...implementedStylisticRuleNames].sort(),
    );
    expect(nativeStylisticRuleMetas().map((meta) => meta.name)).toEqual([
      "eol-last",
      "linebreak-style",
      "no-multiple-empty-lines",
      "no-tabs",
      "no-trailing-spaces",
      "quotes",
      "unicode-bom",
      "arrow-spacing",
      "comma-spacing",
      "semi-spacing",
      "space-in-parens",
      "template-curly-spacing",
      "rest-spread-spacing",
      "no-multi-spaces",
      "no-whitespace-before-property",
      "dot-location",
      "spaced-comment",
      "object-curly-spacing",
      "array-bracket-spacing",
      "computed-property-spacing",
      "block-spacing",
      "space-before-blocks",
      "function-call-spacing",
      "space-before-function-paren",
      "no-floating-decimal",
      "template-tag-spacing",
      "yield-star-spacing",
      "generator-star-spacing",
      "comma-dangle",
      "space-infix-ops",
      "max-len",
      "semi-style",
      "comma-style",
      "arrow-parens",
      "switch-colon-spacing",
      "no-extra-semi",
      "new-parens",
      "space-unary-ops",
      "wrap-regex",
      "implicit-arrow-linebreak",
      "operator-linebreak",
      "keyword-spacing",
    ]);
  });

  it("runs multiple stylistic rules through one native binding call", () => {
    const diagnostics = runNativeStylisticLint('\u{feff}const\tlabel = "value";  \r\n\n\n', {
      rules: [
        { name: "unicode-bom", options: ["never"] },
        { name: "quotes", options: ["single"] },
        { name: "no-trailing-spaces", options: [] },
        { name: "no-tabs", options: [] },
        { name: "linebreak-style", options: ["unix"] },
        { name: "no-multiple-empty-lines", options: [{ max: 1 }] },
      ],
    });

    expect(diagnostics.map((diagnostic) => diagnostic.ruleName)).toEqual([
      "unicode-bom",
      "quotes",
      "no-trailing-spaces",
      "no-tabs",
      "linebreak-style",
      "no-multiple-empty-lines",
    ]);
    expect(diagnostics[1].suggestions?.[0]?.fixes[0]?.replacementText).toBe("'value'");
  });

  it("runs quotes through Oxlint RuleTester", () => {
    new RuleTester().run("quotes", corsaStylisticRules.quotes as never, {
      valid: [{ code: "const label = 'value';", options: ["single"] }],
      invalid: [
        {
          code: 'const label = "value";',
          options: ["single"],
          errors: [{ messageId: "wrongQuote" }],
        },
      ],
    });
  });

  it("shares configured stylistic settings across enabled rules", () => {
    const tester = new RuleTester({
      settings: {
        corsaStylistic: {
          rules: {
            quotes: ["single"],
            "no-trailing-spaces": [],
          },
        },
      },
    });

    tester.run("no-trailing-spaces", corsaStylisticRules["no-trailing-spaces"] as never, {
      valid: [{ code: "const label = 'value';\n" }],
      invalid: [
        {
          code: "const label = 'value';  \n",
          errors: [{ messageId: "trailingSpace" }],
        },
      ],
    });
  });

  it("does not reuse native diagnostics across files sharing a sourceCode object", () => {
    const sourceCode = {
      text: "const source = { foo: 1 };\n",
      getText() {
        return this.text;
      },
    };
    const reports: Array<{ messageId?: string }> = [];
    const context = {
      sourceCode,
      cwd: process.cwd(),
      languageOptions: {},
      settings: {
        corsaStylistic: {
          rules: {
            "object-curly-spacing": ["always"],
          },
        },
      },
      options: [],
      report(descriptor: { messageId?: string }) {
        reports.push(descriptor);
      },
    };
    const rule = corsaStylisticRules["object-curly-spacing"] as {
      create(context: unknown): { Program(node: { type: string; range: [number, number] }): void };
    };

    rule.create(context).Program({ type: "Program", range: [0, sourceCode.text.length] });
    expect(reports).toEqual([]);

    sourceCode.text = "const {foo} = source;\n";
    rule.create(context).Program({ type: "Program", range: [0, sourceCode.text.length] });

    expect(reports.map((report) => report.messageId)).toEqual([
      "requireSpaceAfter",
      "requireSpaceBefore",
    ]);
  });
});
