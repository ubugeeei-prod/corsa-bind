---
title: Type-aware Oxlint
description: Author type-aware Oxlint rules with corsa-oxlint — RuleCreator, parser services, settings.corsaOxlint config, the native rule set, stylistic rules, and RuleTester.
---

# Type-Aware Oxlint (`corsa-oxlint`)

`corsa-oxlint` is a self-hosted framework for building Oxlint JS plugins with
real type information powered by Corsa. The performance-critical work lives in
Rust and is bridged into Node through `@corsa-bind/napi`, while you keep
authoring custom rules in plain JS/TS with the familiar
`typescript-eslint`-style model.

> [!WARNING]
> This package is an early WIP. The core direction is stable, but the API
> surface will keep moving while Corsa upstream, Oxlint's JS plugin APIs, and
> the surrounding benchmarks evolve.

## Install

```bash
npm i corsa-oxlint
```

The package exposes several entry points:

| Import                                                | Purpose                                                   |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `corsa-oxlint`                                        | `OxlintUtils`, `RuleTester`, and compatibility namespaces |
| `corsa-oxlint/rules`                                  | the built-in TS-native / Rust-backed rule plugin          |
| `corsa-oxlint/stylistic`                              | the native stylistic rule plugin                          |
| `corsa-oxlint/ast-utils`, `corsa-oxlint/eslint-utils` | AST and ESLint-style helpers                              |

It also re-exports compatibility namespaces (`ESLintUtils`, `TSESLint`,
`TSESTree`, `TSUtils`) so existing `typescript-eslint`-style code ports with
minimal changes, and it does **not** depend on any third-party TypeScript lint
helper package.

## Authoring a type-aware rule

Use `OxlintUtils.RuleCreator()` to define a rule, then pull type information
from `getParserServices()`:

```ts
import { OxlintUtils } from "corsa-oxlint";

const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);

export const noStringPlusNumber = createRule({
  name: "no-string-plus-number",
  meta: {
    type: "problem",
    docs: {
      description: "forbid string + number",
      requiresTypeChecking: true,
    },
    messages: { unexpected: "string plus number is forbidden" },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = OxlintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      BinaryExpression(node) {
        if (node.operator !== "+") return;
        const left = checker.getTypeAtLocation(node.left);
        const right = checker.getTypeAtLocation(node.right);
        if (!left || !right) return;

        const leftText = checker.typeToString(checker.getBaseTypeOfLiteralType(left) ?? left);
        const rightText = checker.typeToString(checker.getBaseTypeOfLiteralType(right) ?? right);
        if (leftText === "string" && rightText === "number") {
          context.report({ node, messageId: "unexpected" });
        }
      },
    };
  },
});
```

Setting `requiresTypeChecking: true` is what tells the framework a rule needs
the type-aware path. The checker object behaves like the TypeScript checker
(`getTypeAtLocation`, `typeToString`, `getBaseTypeOfLiteralType`, …), but the
types come from the pinned Corsa binary.

## Configuration: `settings.corsaOxlint`

Oxlint does not expose arbitrary parser options at runtime, so `corsa-oxlint`
reads its type-aware settings from `settings.corsaOxlint` in your flat config:

```js
export default [
  {
    settings: {
      corsaOxlint: {
        parserOptions: {
          project: ["./tsconfig.json"],
          tsconfigRootDir: import.meta.dirname,
          corsa: {
            executable: "./.cache/corsa", // the Corsa binary you provide
            mode: "msgpack",
            requestTimeoutMs: 30000,
          },
        },
      },
    },
  },
];
```

The `corsa` block maps onto the same runtime controls as the
[Node binding](./nodejs_binding.md): `executable`, `mode`, `requestTimeoutMs`,
`shutdownTimeoutMs`, `outboundCapacity`, and `allowUnstableUpstreamCalls`.
Leaving `allowUnstableUpstreamCalls` unset keeps unstable upstream endpoints
such as `printNode` disabled.

> [!IMPORTANT]
> `corsa-oxlint` needs a Corsa binary at the `executable` path. It is not
> bundled. During development, point it at the repo-local mock
> (`vp run -w build_mock`) or a real build (`vp run -w build_corsa`).

## Built-in native rules

`corsa-oxlint/rules` exports a ready-made plugin whose rules are implemented in
Rust and surfaced through the same Oxlint JS plugin shape. Rule parity is
tracked against upstream `tsgolint/internal/rules`, but the runtime
implementation lives entirely in this package.

```ts
import { corsaOxlintPlugin } from "corsa-oxlint/rules";

export default [
  {
    plugins: { typescript: corsaOxlintPlugin },
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/restrict-plus-operands": ["error", { allowNumberAndString: false }],
    },
  },
];
```

Current coverage is exported from `implementedNativeRuleNames`. It now covers
the tracked upstream `tsgolint/internal/rules` surface — the unsafe,
unnecessary, promise/control-flow, preference/style, and type/export families.
`pendingNativeRuleNames` is intentionally empty, and a test fails if the
implemented + pending sets drift away from the tracked upstream list.

## Stylistic rules

`corsa-oxlint/stylistic` is a separate path for Rust-backed style rules that do
**not** need type information. The rules scan the full source text in native
code, and the JS plugin caches diagnostics per source/config so all enabled
rules share a single N-API call.

```ts
import { corsaStylisticPlugin } from "corsa-oxlint/stylistic";

export default [
  {
    settings: {
      corsaStylistic: {
        rules: {
          "eol-last": ["always"],
          "linebreak-style": ["unix"],
          "no-multiple-empty-lines": [{ max: 1, maxBOF: 0, maxEOF: 1 }],
          "no-tabs": [{ allowIndentationTabs: false }],
          "no-trailing-spaces": [{ skipBlankLines: false }],
          quotes: ["single", { avoidEscape: true }],
          "unicode-bom": ["never"],
        },
      },
    },
    plugins: { stylistic: corsaStylisticPlugin },
    rules: {
      "stylistic/eol-last": "error",
      "stylistic/linebreak-style": "error",
      "stylistic/quotes": "error",
    },
  },
];
```

Options can be supplied directly in `rules` (for example
`"stylistic/quotes": ["error", "single"]`). For the fastest multi-rule path,
put the same option payloads in `settings.corsaStylistic.rules` so the bridge
batches every configured stylistic rule into one Rust source scan.

## Testing rules with `RuleTester`

`corsa-oxlint` ships a `RuleTester` that injects a temporary project and the
type-aware config for you:

```ts
import { RuleTester } from "corsa-oxlint";
import { noStringPlusNumber } from "./no-string-plus-number.ts";

const tester = new RuleTester();

tester.run("no-string-plus-number", noStringPlusNumber, {
  valid: [{ code: 'const text = "a" + "b";', settings }],
  invalid: [
    {
      code: 'const broken = "value" + 1;',
      errors: [{ messageId: "unexpected" }],
      settings,
    },
  ],
});
```

`RuleTester.describe` / `RuleTester.it` can be wired to your test runner. See
the runnable `examples/corsa_oxlint/rule_tester.ts` and
`native_rule_tester.ts` samples for end-to-end usage against the real pinned
Corsa binary.

## How the Rust lane works

General-purpose built-in rules are implemented in Rust yet still ship as Oxlint
JS plugin rules. The bridge is:

1. Oxlint visits the ESTree node in JS.
2. `corsa-oxlint` collects compact node facts and type texts.
3. `@corsa-bind/napi` calls `corsa::lint::RustLintRule`.
4. Rust returns Oxlint-shaped diagnostics, suggestions, and fixes.
5. The JS rule reports them through `context.report()`.

This keeps the public integration point aligned with Oxlint's JS plugin API
while leaving room for Rust-authored rule crates. Project-specific rules stay
in JS/TS via `RuleCreator()`; hot, shared rules can move deeper into Rust as
the bridge grows.

## Development

```bash
vp install
vp run -w build_corsa_oxlint
vp test run --config ./vite.config.ts src/bindings/nodejs/corsa_oxlint/ts/**/*.test.ts
vp test bench --config ./vite.config.ts bench/src/corsa_oxlint.bench.ts
vp test bench --config ./vite.config.ts bench/src/corsa_oxlint_rules.bench.ts
```

## See also

- [Node.js binding](./nodejs_binding.md) — the underlying client and runtime controls
- [Getting started](./getting_started.md) — the quickest first rule
- [Examples](https://github.com/ubugeeei/corsa-bind/tree/main/examples) — custom-rule, plugin, and native-rules samples
