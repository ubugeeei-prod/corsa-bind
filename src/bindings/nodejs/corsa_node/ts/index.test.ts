import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CorsaApiClient,
  CorsaDistributedOrchestrator,
  CorsaVirtualDocument,
  classifyTypeText,
  isAnyLikeTypeTexts,
  isArrayLikeTypeTexts,
  isErrorLikeTypeTexts,
  isStringArrayLikeTypeTexts,
  isPromiseLikeTypeTexts,
  nativeStylisticRuleMetas,
  nativeLintRuleMetas,
  runNativeLintRule,
  runNativeStylisticLint,
  splitTopLevelTypeText,
  splitTypeText,
  isUnsafeAssignment,
  isUnsafeReturn,
} from "./index";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const mockBinary = resolve(workspaceRoot, `target/debug/mock_corsa${executableSuffix}`);
const realBinary = resolve(workspaceRoot, `.cache/corsa${executableSuffix}`);
const realDatasetCandidates = [
  "ref/corsa-upstream/_packages/native-preview/tsconfig.json",
  "ref/corsa-upstream/_packages/api/tsconfig.json",
].map((path) => resolve(workspaceRoot, path));
const realDataset =
  realDatasetCandidates.find((candidate) => existsSync(candidate)) ?? realDatasetCandidates[0];
const realCorsaReady = existsSync(realBinary) && existsSync(realDataset);

describe("CorsaApiClient", () => {
  it("exports the Corsa wrapper classes", () => {
    expect(CorsaApiClient).toBeTypeOf("function");
    expect(CorsaVirtualDocument).toBeTypeOf("function");
    expect(CorsaDistributedOrchestrator).toBeTypeOf("function");
  });

  it("evaluates Rust-backed unsafe type flow predicates", () => {
    expect(
      isUnsafeAssignment({
        sourceTypeTexts: ["Set<any>"],
        targetTypeTexts: ["Set<string>"],
      }),
    ).toBe(true);
    expect(
      isUnsafeAssignment({
        sourceTypeTexts: ["any"],
        targetTypeTexts: ["unknown"],
      }),
    ).toBe(false);
    expect(
      isUnsafeReturn({
        sourceTypeTexts: ["Promise<any>"],
        targetTypeTexts: ["Promise<string>"],
      }),
    ).toBe(true);
  });

  it("exposes Rust-backed type-text utilities", () => {
    expect(classifyTypeText('"value"')).toBe("string");
    expect(classifyTypeText("42n")).toBe("bigint");
    expect(splitTopLevelTypeText("Promise<string | number> | null", "|")).toEqual([
      "Promise<string | number>",
      "null",
    ]);
    expect(splitTypeText("string | Promise<Array<number>> & undefined")).toEqual([
      "string",
      "Promise<Array<number>>",
      "undefined",
    ]);
    expect(isArrayLikeTypeTexts(["ReadonlyArray<string>"])).toBe(true);
    expect(isStringArrayLikeTypeTexts(["readonly string[]"])).toBe(true);
    expect(isStringArrayLikeTypeTexts(["Array<number>"])).toBe(false);
    expect(isPromiseLikeTypeTexts(["Promise<string>"])).toBe(true);
    expect(isPromiseLikeTypeTexts([], ["then"])).toBe(true);
    expect(isErrorLikeTypeTexts(["TypeError"])).toBe(true);
    expect(isAnyLikeTypeTexts(["any"])).toBe(true);
  });

  it("runs Rust-authored native lint rules", () => {
    const diagnostics = runNativeLintRule("no-array-delete", {
      kind: "UnaryExpression",
      range: { start: 0, end: 20 },
      fields: { operator: "delete" },
      children: {
        argument: {
          kind: "MemberExpression",
          range: { start: 7, end: 20 },
          fields: { computed: true },
          children: {
            object: {
              kind: "Identifier",
              range: { start: 7, end: 13 },
              text: "values",
              typeTexts: ["number[]"],
            },
            property: {
              kind: "Identifier",
              range: { start: 14, end: 19 },
              text: "index",
            },
          },
        },
      },
    });

    expect(nativeLintRuleMetas().map((meta) => meta.name)).toEqual([
      "consistent-return",
      "consistent-type-exports",
      "dot-notation",
      "no-array-delete",
      "no-base-to-string",
      "no-confusing-void-expression",
      "no-deprecated",
      "no-duplicate-type-constituents",
      "no-floating-promises",
      "no-for-in-array",
      "await-thenable",
      "no-implied-eval",
      "no-meaningless-void-operator",
      "no-misused-promises",
      "no-misused-spread",
      "no-mixed-enums",
      "no-redundant-type-constituents",
      "no-unnecessary-boolean-literal-compare",
      "no-unnecessary-condition",
      "no-unnecessary-qualifier",
      "no-unnecessary-template-expression",
      "no-unnecessary-type-arguments",
      "no-unnecessary-type-assertion",
      "no-unnecessary-type-conversion",
      "no-unnecessary-type-parameters",
      "no-unsafe-argument",
      "no-unsafe-assignment",
      "no-unsafe-call",
      "no-unsafe-enum-comparison",
      "no-unsafe-member-access",
      "no-unsafe-return",
      "no-unsafe-type-assertion",
      "no-unsafe-unary-minus",
      "no-useless-default-assignment",
      "non-nullable-type-assertion-style",
      "only-throw-error",
      "prefer-find",
      "prefer-includes",
      "prefer-nullish-coalescing",
      "prefer-optional-chain",
      "prefer-promise-reject-errors",
      "prefer-readonly",
      "prefer-readonly-parameter-types",
      "prefer-reduce-type-parameter",
      "prefer-regexp-exec",
      "prefer-return-this-type",
      "prefer-string-starts-ends-with",
      "promise-function-async",
      "related-getter-setter-pairs",
      "require-array-sort-compare",
      "require-await",
      "restrict-plus-operands",
      "restrict-template-expressions",
      "return-await",
      "strict-boolean-expressions",
      "strict-void-return",
      "switch-exhaustiveness-check",
      "unbound-method",
      "use-unknown-in-catch-callback-variable",
    ]);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].messageId).toBe("unexpected");
    expect(diagnostics[0].suggestions?.[0]?.fixes.map((fix) => fix.replacementText)).toEqual([
      "",
      ".splice(",
      ", 1)",
    ]);
  });

  it("runs Rust-authored native stylistic rules", () => {
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

    expect(nativeStylisticRuleMetas().map((meta) => meta.name)).toEqual([
      "eol-last",
      "linebreak-style",
      "no-multiple-empty-lines",
      "no-tabs",
      "no-trailing-spaces",
      "quotes",
      "unicode-bom",
    ]);
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

  it("roundtrips through the mock corsa binary", () => {
    const client = CorsaApiClient.spawn({
      executable: mockBinary,
      cwd: workspaceRoot,
      mode: "jsonrpc",
    });

    try {
      const init = client.initialize();
      expect(init.currentDirectory).toBe(workspaceRoot);

      const snapshot = client.updateSnapshot({
        openProject: "/workspace/tsconfig.json",
      });
      const project = snapshot.projects[0];
      expect(project).toBeDefined();

      const sourceFile = client.getSourceFile(
        snapshot.snapshot,
        project.id,
        "/workspace/src/index.ts",
      );
      expect(Buffer.from(sourceFile ?? []).toString("utf8")).toBe("source-file");
      expect(client.callJson<string>("ping")).toBe("pong");
      const sourceViaGeneric = client.callBinary("getSourceFile", {
        snapshot: snapshot.snapshot,
        project: project.id,
        file: "/workspace/src/index.ts",
      });
      expect(Buffer.from(sourceViaGeneric ?? []).toString("utf8")).toBe("source-file");

      const stringType = client.getStringType(snapshot.snapshot, project.id);
      expect(stringType.id).toBe("t0000000000000010");
      expect(
        client.getTypeAtPosition(snapshot.snapshot, project.id, "/workspace/src/index.ts", 1)?.id,
      ).toBe("t0000000000000001");
      expect(
        client.getSymbolAtPosition(snapshot.snapshot, project.id, "/workspace/src/index.ts", 1)
          ?.name,
      ).toBe("value");
      expect(
        client.getTypeArguments(
          snapshot.snapshot,
          project.id,
          stringType.id,
          stringType.objectFlags,
        ),
      ).toEqual([]);
      expect(
        client.getTypeArguments(snapshot.snapshot, project.id, stringType.id, 1 << 2),
      ).toHaveLength(1);
      expect(client.typeToString(snapshot.snapshot, project.id, stringType.id)).toBe("type:string");
      const nodeType = client.getTypeAtPosition(
        snapshot.snapshot,
        project.id,
        "/workspace/src/index.ts",
        1,
      );
      expect(nodeType?.id).toBe("t0000000000000001");
      const symbol = client.getSymbolAtPosition(
        snapshot.snapshot,
        project.id,
        "/workspace/src/index.ts",
        1,
      );
      expect(symbol?.name).toBe("value");
      expect(client.getTypeOfSymbol(snapshot.snapshot, project.id, symbol!.id)?.id).toBe(
        "t0000000000000001",
      );
      expect(client.getDeclaredTypeOfSymbol(snapshot.snapshot, project.id, symbol!.id)?.id).toBe(
        "t0000000000000001",
      );

      client.releaseHandle(snapshot.snapshot);
    } finally {
      client.close();
    }
  });

  it("roundtrips through the mock corsa binary without blocking on async APIs", async () => {
    const client = await CorsaApiClient.spawnAsync({
      executable: mockBinary,
      cwd: workspaceRoot,
      mode: "jsonrpc",
    });

    try {
      const init = await client.initializeAsync();
      expect(init.currentDirectory).toBe(workspaceRoot);

      const snapshot = await client.updateSnapshotAsync({
        openProject: "/workspace/tsconfig.json",
      });
      const project = snapshot.projects[0];
      expect(project).toBeDefined();

      await expect(client.callJsonAsync<string>("ping")).resolves.toBe("pong");
      const sourceViaGeneric = await client.callBinaryAsync("getSourceFile", {
        snapshot: snapshot.snapshot,
        project: project.id,
        file: "/workspace/src/index.ts",
      });
      expect(Buffer.from(sourceViaGeneric ?? []).toString("utf8")).toBe("source-file");

      const stringType = await client.getStringTypeAsync(snapshot.snapshot, project.id);
      expect(stringType.id).toBe("t0000000000000010");
      const nodeType = await client.getTypeAtPositionAsync(
        snapshot.snapshot,
        project.id,
        "/workspace/src/index.ts",
        1,
      );
      expect(nodeType?.id).toBe("t0000000000000001");
      await expect(
        client.typeToStringAsync(snapshot.snapshot, project.id, stringType.id),
      ).resolves.toBe("type:string");

      await client.releaseHandleAsync(snapshot.snapshot);
    } finally {
      await client.closeAsync();
    }
  });

  for (const mode of ["msgpack", "jsonrpc"] as const) {
    const realCase = realCorsaReady ? it : it.skip;

    realCase(`keeps real ${mode} snapshots alive across follow-up calls`, () => {
      const client = CorsaApiClient.spawn({
        executable: realBinary,
        cwd: workspaceRoot,
        mode,
      });

      try {
        client.initialize();
        const config = client.parseConfigFile(realDataset);
        const snapshot = client.updateSnapshot({ openProject: realDataset });
        const project = snapshot.projects[0];
        const primaryFile =
          config.fileNames.find((fileName) => !fileName.endsWith(".d.ts")) ?? config.fileNames[0];

        expect(project).toBeDefined();
        expect(primaryFile).toBeDefined();
        expect(client.getSourceFile(snapshot.snapshot, project.id, primaryFile)).not.toBeNull();
        const stringType = client.getStringType(snapshot.snapshot, project.id);
        expect(client.typeToString(snapshot.snapshot, project.id, stringType.id)).toBe("string");

        client.releaseHandle(snapshot.snapshot);
      } finally {
        client.close();
      }
    });
  }
});

describe("CorsaVirtualDocument", () => {
  it("tracks incremental virtual file changes", () => {
    const document = CorsaVirtualDocument.untitled(
      "/virtual/demo.ts",
      "typescript",
      "const value = 1;\n",
    );
    document.applyChanges([
      {
        range: {
          start: { line: 0, character: 14 },
          end: { line: 0, character: 15 },
        },
        text: "2",
      },
    ]);

    expect(document.version).toBe(2);
    expect(document.text).toBe("const value = 2;\n");
    expect(document.state().uri).toContain("untitled:");
  });
});

describe("CorsaDistributedOrchestrator", () => {
  it("replicates virtual documents after leader election", () => {
    const cluster = new CorsaDistributedOrchestrator(["n1", "n2", "n3"]);
    expect(cluster.campaign("n1")).toBe(1);

    const document = CorsaVirtualDocument.inMemory(
      "cluster",
      "/main.ts",
      "typescript",
      "let value = 1;",
    );
    cluster.openVirtualDocument(document.state());
    const updated = cluster.changeVirtualDocument(document.uri, [
      {
        range: {
          start: { line: 0, character: 12 },
          end: { line: 0, character: 13 },
        },
        text: "2",
      },
    ]);

    expect(updated.text).toBe("let value = 2;");
    expect(cluster.document("n2", document.uri)?.text).toBe("let value = 2;");
  });
});
