import { defineRule } from "../plugin";

export function createNativeRule(
  name: string,
  meta: Record<string, unknown>,
  create: (context: any) => Record<string, (node: any) => void>,
) {
  return defineRule({
    defaultOptions: [],
    meta: {
      type: "problem",
      // Native rules accept their upstream typescript-eslint options; the
      // Rust side deserializes and validates them, so the JS-side schema
      // stays permissive.
      schema: { type: "array" },
      ...meta,
      docs: {
        requiresTypeChecking: true,
        url: `https://github.com/ubugeeei-prod/corsa-bind/tree/main/src/bindings/nodejs/corsa_oxlint/ts/rules/${name.replaceAll("-", "_")}.ts`,
        ...(meta.docs as object | undefined),
      },
    },
    create,
  });
}
