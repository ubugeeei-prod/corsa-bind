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
      schema: [],
      ...meta,
      docs: {
        requiresTypeChecking: true,
        url: `https://github.com/ubugeeei/corsa-bind/tree/main/src/bindings/nodejs/corsa_oxlint/ts/rules/${name.replaceAll("-", "_")}.ts`,
        ...(meta.docs as object | undefined),
      },
    },
    create,
  });
}
