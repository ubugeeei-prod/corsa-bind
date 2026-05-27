# corsa oxlint

`corsa oxlint` is a self-hosted type-aware framework for building Oxlint JS
plugins with real type information powered by Corsa.

> [!WARNING]
> This package is still an early WIP.
> The core direction is stable, but the API surface will keep moving while
> Corsa upstream, Oxlint's JS plugin APIs, and the surrounding benchmarks are
> still evolving.

## What It Does

- exposes `OxlintUtils.RuleCreator()` and `getParserServices()` backed by Corsa
- exposes compatibility namespaces such as `ESLintUtils`, `TSESLint`, `TSESTree`, and `TSUtils`
- keeps a compact self-hosted helper surface with no extra lint-framework dependency
- binds Rust-implemented hot paths into JS through `napi-rs`
- lets custom Oxlint rules query types and symbols from JS or TS
- ships a `RuleTester` wrapper that injects temp projects and type-aware config
- ships a growing TS-native ruleset under `corsa-oxlint/rules`

The design goal is simple: performance-critical pieces live in Rust, `napi-rs`
bridges them into Node, and end users still get to author custom plugins and
custom rules in plain JS/TS.

## Configuration

Oxlint does not expose arbitrary parser options at runtime, so
`corsa oxlint` reads its type-aware settings from `settings.corsaOxlint`.

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
    messages: {
      unexpected: "string plus number is forbidden",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = OxlintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      BinaryExpression(node) {
        if (node.operator !== "+") {
          return;
        }
        const left = checker.getTypeAtLocation(node.left);
        const right = checker.getTypeAtLocation(node.right);
        if (!left || !right) {
          return;
        }
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

```js
export default [
  {
    settings: {
      corsaOxlint: {
        parserOptions: {
          project: ["./tsconfig.json"],
          tsconfigRootDir: import.meta.dirname,
          corsa: {
            executable: "./.cache/corsa",
            mode: "msgpack",
            requestTimeoutMs: 30000,
          },
        },
      },
    },
  },
];
```

## Native Rules

`corsa oxlint` exports the TS-native rule set and plugin surface via `corsa-oxlint/rules`.
Rule parity is tracked against upstream `tsgolint/internal/rules`, but the
runtime implementation lives entirely in this package.

```ts
import { corsaOxlintPlugin } from "corsa-oxlint/rules";

export default [
  {
    plugins: {
      typescript: corsaOxlintPlugin,
    },
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/prefer-promise-reject-errors": "error",
      "typescript/restrict-plus-operands": ["error", { allowNumberAndString: false }],
    },
  },
];
```

Current native coverage is exported from `implementedNativeRuleNames`. It now
covers the tracked upstream `tsgolint/internal/rules` surface, including the
unsafe, unnecessary, promise/control-flow, preference/style, and type/export
families. `pendingNativeRuleNames` is intentionally empty, and
`native_rules.test.ts` fails if implemented + pending drift away from the
tracked upstream rule list.

## Rust-Authored Rule Lane

General-purpose built-in rules can be implemented as Rust rules and still ship
as Oxlint JS plugin rules. The bridge is:

1. Oxlint visits the ESTree node in JS.
2. `corsa oxlint` collects compact node facts and type texts.
3. `@corsa-bind/napi` calls `corsa::lint::RustLintRule`.
4. Rust returns Oxlint-shaped diagnostics, suggestions, and fixes.
5. The JS rule reports them through `context.report()`.

The built-in tsgolint parity rules are registered through
`corsa::lint::RustLintRule`. Custom project-specific rules can still be
authored in JS/TS with `OxlintUtils.RuleCreator()`, while hot, shared rules can
continue to move deeper into compact Rust facts as the bridge grows.

## Runtime Safety Controls

The underlying `@corsa-bind/napi` client now exposes a few production-oriented
runtime controls:

- `requestTimeoutMs`
- `shutdownTimeoutMs`
- `outboundCapacity`
- `allowUnstableUpstreamCalls`

Leaving `allowUnstableUpstreamCalls` unset keeps unstable upstream endpoints
such as `printNode` disabled by default.

## Development

```bash
vp install
vp run -w build_corsa_oxlint
vp fmt
vp lint
vp check
vp test run --config ./vite.config.ts src/bindings/nodejs/corsa_oxlint/ts/**/*.test.ts
vp test bench --config ./vite.config.ts bench/src/corsa_oxlint.bench.ts
vp test bench --config ./vite.config.ts bench/src/corsa_oxlint_rules.bench.ts
vp run -w bench_tooling_compare
```

Repository-level examples live under [`examples/`](../../examples/README.md),
including custom-rule, custom-plugin, and native-rules flat-config samples.
