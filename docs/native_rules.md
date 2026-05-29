---
title: Native rules
description: The full set of type-aware lint rules implemented natively in Rust and exposed through corsa-oxlint.
---

# Native Rules

`corsa-oxlint` ships a set of **type-aware lint rules implemented natively in
Rust** (`corsa_core::lint`) and surfaced through the Oxlint JS plugin. The
decision logic runs on the Rust hot path; the JS layer is a thin bridge that
feeds each rule the type facts it needs from the pinned Corsa checker.

The rule set tracks the upstream
[`tsgolint`](https://github.com/oxc-project/tsgolint) builtin rules as its
parity target. There are currently **59 rules**.

## Enabling them

Install the plugin and enable rules under the `typescript/` namespace
(see the [Oxlint guide](./oxlint_guide.md) for the full setup and
`settings.corsaOxlint` configuration):

```ts
import { corsaOxlintPlugin } from "corsa-oxlint/rules";

export default [
  {
    plugins: { typescript: corsaOxlintPlugin },
    rules: {
      "typescript/no-floating-promises": "error",
      "typescript/restrict-plus-operands": ["error", { allowNumberAndString: false }],
    },
  },
];
```

The exact set is also exported programmatically as `implementedNativeRuleNames`
from `corsa-oxlint/rules`, so presets and tooling can enumerate it without
instantiating the plugin.

## Supported rules

| Rule                                     | Description                                                                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `await-thenable`                         | Disallow awaiting non-thenable values.                                                         |
| `consistent-return`                      | Require return statements to either always or never specify values.                            |
| `consistent-type-exports`                | Require type-only exports where possible.                                                      |
| `dot-notation`                           | Enforce dot notation whenever possible.                                                        |
| `no-array-delete`                        | Disallow deleting elements from array-like values.                                             |
| `no-base-to-string`                      | Disallow stringifying values that fall back to Object.prototype.toString().                    |
| `no-confusing-void-expression`           | Disallow void-typed expressions in confusing value positions.                                  |
| `no-deprecated`                          | Disallow use of deprecated declarations.                                                       |
| `no-duplicate-type-constituents`         | Disallow duplicate union or intersection constituents.                                         |
| `no-floating-promises`                   | Require promises to be awaited or otherwise handled.                                           |
| `no-for-in-array`                        | Disallow for-in iteration over array-like values.                                              |
| `no-implied-eval`                        | Disallow string-based dynamic code execution APIs.                                             |
| `no-meaningless-void-operator`           | Disallow void operators on expressions that are already void-like.                             |
| `no-misused-promises`                    | Disallow Promises in places not designed to handle them.                                       |
| `no-misused-spread`                      | Disallow spreading values into incompatible positions.                                         |
| `no-mixed-enums`                         | Disallow mixing string and numeric enum members.                                               |
| `no-redundant-type-constituents`         | Disallow members of unions and intersections that do nothing or override type information.     |
| `no-unnecessary-boolean-literal-compare` | Disallow unnecessary comparisons against boolean literals.                                     |
| `no-unnecessary-condition`               | Disallow conditions that are always truthy, always falsy, never, or always nullish.            |
| `no-unnecessary-qualifier`               | Disallow unnecessary namespace qualifiers.                                                     |
| `no-unnecessary-template-expression`     | Disallow template literals that wrap a single expression unnecessarily.                        |
| `no-unnecessary-type-arguments`          | Disallow type arguments that are equal to the default.                                         |
| `no-unnecessary-type-assertion`          | Disallow type assertions that do not change the expression type.                               |
| `no-unnecessary-type-conversion`         | Disallow conversions that do not change the type or value of the expression.                   |
| `no-unnecessary-type-parameters`         | Disallow type parameters that are not used more than once.                                     |
| `no-unsafe-argument`                     | Disallow calling a function with a value of type `any`.                                        |
| `no-unsafe-assignment`                   | Disallow assigning any-typed values to more specific targets.                                  |
| `no-unsafe-call`                         | Disallow calling values typed as any.                                                          |
| `no-unsafe-enum-comparison`              | Disallow comparing an enum value with a value from a different enum domain.                    |
| `no-unsafe-member-access`                | Disallow member access on values typed as any.                                                 |
| `no-unsafe-return`                       | Disallow returning any-typed values from functions.                                            |
| `no-unsafe-type-assertion`               | Disallow unsafe type assertions.                                                               |
| `no-unsafe-unary-minus`                  | Disallow unary negation on non-number and non-bigint values.                                   |
| `no-useless-default-assignment`          | Disallow default value assignments that can never be used.                                     |
| `non-nullable-type-assertion-style`      | Prefer non-null assertions over equivalent non-nullable type assertions.                       |
| `only-throw-error`                       | Require thrown values to be Error-like.                                                        |
| `prefer-find`                            | Prefer find over filtering and taking the first element.                                       |
| `prefer-includes`                        | Prefer includes over indexOf/lastIndexOf comparisons.                                          |
| `prefer-nullish-coalescing`              | Prefer nullish coalescing for nullish fallbacks.                                               |
| `prefer-optional-chain`                  | Prefer optional chaining over repeated short-circuit checks.                                   |
| `prefer-promise-reject-errors`           | Require Promise rejection reasons to be Error-like values.                                     |
| `prefer-readonly`                        | Prefer private members that are never reassigned to be marked readonly.                        |
| `prefer-readonly-parameter-types`        | Require function parameters to be typed as readonly to prevent immutable-by-contract mutation. |
| `prefer-reduce-type-parameter`           | Prefer Array#reduce type parameters over default-value assertions.                             |
| `prefer-regexp-exec`                     | Prefer RegExp#exec over String#match for single matches.                                       |
| `prefer-return-this-type`                | Enforce that `this` is used when only `this` type is returned.                                 |
| `prefer-string-starts-ends-with`         | Prefer startsWith()/endsWith() over manual string prefix/suffix checks.                        |
| `promise-function-async`                 | Require functions that return promises to be async.                                            |
| `related-getter-setter-pairs`            | Require paired getters and setters to use compatible types.                                    |
| `require-array-sort-compare`             | Require compare callbacks for array sorting calls.                                             |
| `require-await`                          | Disallow async functions that contain no await expression.                                     |
| `restrict-plus-operands`                 | Require plus operands to be explicitly compatible.                                             |
| `restrict-template-expressions`          | Require template literal expressions to be string-compatible.                                  |
| `return-await`                           | Enforce consistent use of `return await` based on context and configuration.                   |
| `strict-boolean-expressions`             | Disallow non-boolean values in boolean expression positions.                                   |
| `strict-void-return`                     | Disallow returning a value from a function in a context expecting a void return.               |
| `switch-exhaustiveness-check`            | Require switch statements over unions to cover every case.                                     |
| `unbound-method`                         | Disallow referencing methods without their receiver (`this`).                                  |
| `use-unknown-in-catch-callback-variable` | Require Promise catch callback variables to use an explicit unknown annotation.                |

> [!NOTE]
> Every rule keeps its decision logic in Rust. Rules that need type-checker
> information consume raw facts collected by the bridge; where a required
> checker fact is not yet surfaced, the rule degrades conservatively (it
> prefers silence over false positives) until that fact lands.

## See also

- [Type-aware Oxlint](./oxlint_guide.md) — authoring model, native rules, and stylistic rules
- [Node.js binding](./nodejs_binding.md) — the underlying `@corsa-bind/napi` surface
