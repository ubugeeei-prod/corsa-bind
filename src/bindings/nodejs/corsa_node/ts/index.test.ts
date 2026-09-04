import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import {
  CorsaApiClient,
  CorsaDistributedOrchestrator,
  CorsaVirtualDocument,
  batchCheckerRequests,
  classifyTypeText,
  isAnyLikeTypeTexts,
  isArrayLikeTypeTexts,
  isErrorLikeTypeTexts,
  isStringArrayLikeTypeTexts,
  isPromiseLikeTypeTexts,
  nativeLintRuleMetas,
  resolveCheckerBatch as resolveCheckerBatchFromRoot,
  runNativeLintRule,
  splitTopLevelTypeText,
  splitTypeText,
  isUnsafeAssignment,
  isUnsafeReturn,
} from "./index";
import { resolveCheckerBatch } from "./orchestrator";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const mockBinary = resolve(workspaceRoot, `target/debug/mock_corsa${executableSuffix}`);
const realBinary = resolve(workspaceRoot, `.cache/corsa${executableSuffix}`);
const realDatasetCandidates = ["ref/corsa-upstream/packages/typescript/tsconfig.json"].map((path) =>
  resolve(workspaceRoot, path),
);
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

    const lintMetas = nativeLintRuleMetas();
    expect(lintMetas.map((meta) => meta.name)).toEqual([
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
    const bridgeMetas = new Map(lintMetas.map((meta) => [meta.name, meta.bridge]));
    expect(bridgeMetas.get("consistent-return")).toEqual({ maxDepth: 5 });
    expect(bridgeMetas.get("no-misused-promises")).toEqual({
      maxDepth: 5,
      typeTexts: { minDepth: 0, maxDepth: 2 },
    });
    expect(bridgeMetas.get("no-array-delete")).toEqual({
      maxDepth: 2,
      typeTexts: { minDepth: 2, maxDepth: 2 },
    });
    expect(bridgeMetas.get("await-thenable")).toEqual({
      maxDepth: 3,
      typeTexts: { minDepth: 1, maxDepth: 2 },
      propertyNames: { minDepth: 1, maxDepth: 2 },
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].messageId).toBe("unexpected");
    expect(diagnostics[0].suggestions?.[0]?.fixes.map((fix) => fix.replacementText)).toEqual([
      "",
      ".splice(",
      ", 1)",
    ]);
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
      expect(
        client.callJson<Array<{ parameterTypeTexts?: string[][] }>>("getSignaturesOfType", {
          snapshot: snapshot.snapshot,
          project: project.id,
          type: "t0000000000000001",
          kind: 0,
        })[0]?.parameterTypeTexts,
      ).toEqual([["type-text"]]);
      expect(
        client.callJson<{ expectedArgumentTypeTexts?: string[][] }>("getCallSignatureFacts", {
          snapshot: snapshot.snapshot,
          project: project.id,
          type: "t0000000000000001",
          kind: 0,
          argumentTypeTexts: [["type-text"]],
        }).expectedArgumentTypeTexts,
      ).toEqual([["type-text"]]);
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
        client.getPropertyOfType(snapshot.snapshot, project.id, stringType.id, "length")?.name,
      ).toBe("value");
      expect(
        client.isTypeAssignableTo(snapshot.snapshot, project.id, stringType.id, stringType.id),
      ).toBe(true);
      expect(
        client
          .getTypesAtPositions(snapshot.snapshot, project.id, "/workspace/src/index.ts", [1, 2])
          .map((item) => item?.id),
      ).toEqual(["t0000000000000001", "t0000000000000001"]);
      expect(
        client.getSymbolAtPosition(snapshot.snapshot, project.id, "/workspace/src/index.ts", 1)
          ?.name,
      ).toBe("value");
      expect(
        client
          .getSymbolsAtPositions(snapshot.snapshot, project.id, "/workspace/src/index.ts", [1, 2])
          .map((item) => item?.name),
      ).toEqual(["value", undefined]);
      const positionedSymbol = client.getSymbolAtPosition(
        snapshot.snapshot,
        project.id,
        "/workspace/src/index.ts",
        1,
      );
      expect(
        client.getAliasedSymbol(snapshot.snapshot, project.id, positionedSymbol!.id)?.name,
      ).toBe("value");
      expect(
        client.getImmediateAliasedSymbol(snapshot.snapshot, project.id, positionedSymbol!.id)?.name,
      ).toBe("value");
      expect(
        client.getExportsOfModule(snapshot.snapshot, project.id, positionedSymbol!.id),
      ).toEqual([expect.objectContaining({ name: "value" })]);
      expect(client.getSymbolOfType(snapshot.snapshot, stringType.id, project.id)?.name).toBe(
        "value",
      );
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

  it("keeps the root checker batch resolver as a warned compatibility shim", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = {
      callJson<T>(method: string, params?: unknown): T {
        expect(method).toBe("batchRequests");
        const requests = (params as { requests: Array<{ method: string }> }).requests;
        return {
          responses: requests.map((request) => ({
            method: request.method,
            result: {
              id: "s0000000000000001",
              name: "value",
              flags: 2,
              checkFlags: 0,
              declarations: ["1.3.80./workspace/src/index.ts"],
            },
          })),
        } as T;
      },
    };

    try {
      const query = {
        key: "property",
        kind: "propertyOfType",
        type: "t0000000000000010",
        name: "length",
      } as const;
      const first = resolveCheckerBatchFromRoot(client, { snapshot: "s1", project: "p1" }, [query]);
      const second = resolveCheckerBatchFromRoot(client, { snapshot: "s1", project: "p1" }, [
        query,
      ]);

      expect(first[0]).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(second[0]).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(warning).toHaveBeenCalledTimes(1);
      expect(String(warning.mock.calls[0]?.[0])).toContain("@corsa-bind/napi/orchestrator");
    } finally {
      warning.mockRestore();
    }
  });

  it("coalesces checker N+1 lookups through upstream batchRequests", () => {
    const countDir = mkdtempSync(join(tmpdir(), "corsa-batch-counts-"));
    const previousCountDir = process.env.CORSA_MOCK_COUNT_DIR;
    process.env.CORSA_MOCK_COUNT_DIR = countDir;

    const client = CorsaApiClient.spawn({
      executable: mockBinary,
      cwd: workspaceRoot,
      mode: "msgpack",
    });

    try {
      client.initialize();
      const snapshot = client.updateSnapshot({
        openProject: "/workspace/tsconfig.json",
      });
      const project = snapshot.projects[0];
      expect(project).toBeDefined();

      const rawResponses = batchCheckerRequests(client, [
        {
          method: "getPropertyOfType",
          params: {
            snapshot: snapshot.snapshot,
            project: project.id,
            type: "t0000000000000010",
            name: "length",
          },
        },
        {
          method: "isTypeAssignableTo",
          params: {
            snapshot: snapshot.snapshot,
            project: project.id,
            source: "t0000000000000010",
            target: "t0000000000000010",
          },
        },
        {
          method: "getSymbolsAtPositions",
          params: {
            snapshot: snapshot.snapshot,
            project: project.id,
            file: "/workspace/src/index.ts",
            positions: [1, 2, 3],
          },
        },
        {
          method: "getPropertyOfType",
          params: {
            snapshot: snapshot.snapshot,
            type: "t0000000000000010",
            name: "length",
          },
        },
      ]);
      expect(rawResponses.map((response) => response.method)).toEqual([
        "getPropertyOfType",
        "isTypeAssignableTo",
        "getSymbolsAtPositions",
        "getPropertyOfType",
      ]);
      expect(rawResponses[0].result).toEqual(expect.objectContaining({ name: "value" }));
      expect(rawResponses[1].result).toBe(true);
      expect(rawResponses[2].result).toEqual([
        expect.objectContaining({ name: "value" }),
        expect.objectContaining({ name: "value" }),
        expect.objectContaining({ name: "value" }),
      ]);
      expect(rawResponses[3].error).toMatch("empty project ID for type handle");

      const file = "/workspace/src/index.ts";
      const results = resolveCheckerBatch(
        client,
        { snapshot: snapshot.snapshot, project: project.id },
        [
          { key: "type", kind: "typeAtPosition", file, position: 1 },
          { key: "same-type", kind: "typeAtPosition", file, position: 1 },
          { key: "types", kind: "typesAtPositions", file, positions: [1, 2, 1] },
          { key: "symbol", kind: "symbolAtPosition", file, position: 1 },
          { key: "symbols", kind: "symbolsAtPositions", file, positions: [1, 2, 3] },
          { key: "symbol-types", kind: "typesOfSymbols", symbols: ["s1", "s2", "s1"] },
          { key: "symbol-type", kind: "typeOfSymbol", symbol: "s1" },
          { key: "type-symbol", kind: "symbolOfType", type: "t0000000000000010" },
          { key: "declared", kind: "declaredTypeOfSymbol", symbol: "s1" },
          { key: "property", kind: "propertyOfType", type: "t0000000000000010", name: "length" },
          {
            key: "type-arguments",
            kind: "typeArguments",
            type: "t0000000000000010",
            objectFlags: 1 << 2,
          },
          {
            key: "skipped-type-arguments",
            kind: "typeArguments",
            type: "t0000000000000010",
            objectFlags: 0,
          },
          { key: "constraint", kind: "constraintOfType", type: "t0000000000000010" },
          {
            key: "assignable",
            kind: "isTypeAssignableTo",
            source: "t0000000000000010",
            target: "t0000000000000010",
          },
          { key: "alias", kind: "aliasedSymbol", symbol: "s1" },
          { key: "immediate-alias", kind: "immediateAliasedSymbol", symbol: "s1" },
          { key: "exports", kind: "exportsOfModule", symbol: "s1" },
          { key: "display", kind: "typeToString", type: "t0000000000000010" },
        ],
      );
      const byKey = new Map(results.map((result) => [result.key, result]));
      expect(byKey.get("type")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ id: "t0000000000000001" }) }),
      );
      expect(byKey.get("same-type")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ id: "t0000000000000001" }) }),
      );
      expect(byKey.get("types")).toEqual(
        expect.objectContaining({
          result: [
            expect.objectContaining({ id: "t0000000000000001" }),
            expect.objectContaining({ id: "t0000000000000001" }),
            expect.objectContaining({ id: "t0000000000000001" }),
          ],
        }),
      );
      expect(byKey.get("symbol")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(byKey.get("symbols")).toEqual(
        expect.objectContaining({
          result: [
            expect.objectContaining({ name: "value" }),
            expect.objectContaining({ name: "value" }),
            expect.objectContaining({ name: "value" }),
          ],
        }),
      );
      expect(byKey.get("symbol-types")).toEqual(
        expect.objectContaining({
          result: [
            expect.objectContaining({ id: "t0000000000000001" }),
            expect.objectContaining({ id: "t0000000000000001" }),
            expect.objectContaining({ id: "t0000000000000001" }),
          ],
        }),
      );
      expect(byKey.get("symbol-type")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ id: "t0000000000000001" }) }),
      );
      expect(byKey.get("type-symbol")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(byKey.get("declared")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ id: "t0000000000000001" }) }),
      );
      expect(byKey.get("property")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(byKey.get("type-arguments")).toEqual(
        expect.objectContaining({
          result: [expect.objectContaining({ id: "t0000000000000001" })],
        }),
      );
      expect(byKey.get("skipped-type-arguments")).toEqual(expect.objectContaining({ result: [] }));
      expect(byKey.get("constraint")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ id: "t0000000000000001" }) }),
      );
      expect(byKey.get("assignable")).toEqual(expect.objectContaining({ result: true }));
      expect(byKey.get("alias")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(byKey.get("immediate-alias")).toEqual(
        expect.objectContaining({ result: expect.objectContaining({ name: "value" }) }),
      );
      expect(byKey.get("exports")).toEqual(
        expect.objectContaining({
          result: [expect.objectContaining({ name: "value" })],
        }),
      );
      expect(byKey.get("display")).toEqual(expect.objectContaining({ result: "type:string" }));

      expect(readMockCallCount(countDir, "batchRequests")).toBe(2);
      expect(readMockCallCount(countDir, "getTypeAtPosition")).toBe(0);
      expect(readMockCallCount(countDir, "getTypesAtPositions")).toBe(0);
      expect(readMockCallCount(countDir, "getTypeOfSymbol")).toBe(0);
      expect(readMockCallCount(countDir, "getTypesOfSymbols")).toBe(0);
      expect(readMockCallCount(countDir, "getSymbolOfType")).toBe(0);
      expect(readMockCallCount(countDir, "getTypeArguments")).toBe(0);
      expect(readMockCallCount(countDir, "getConstraintOfType")).toBe(0);
      expect(readMockCallCount(countDir, "getPropertyOfType")).toBe(0);

      client.releaseHandle(snapshot.snapshot);
    } finally {
      try {
        client.close();
      } finally {
        if (previousCountDir === undefined) {
          delete process.env.CORSA_MOCK_COUNT_DIR;
        } else {
          process.env.CORSA_MOCK_COUNT_DIR = previousCountDir;
        }
        rmSync(countDir, { force: true, recursive: true });
      }
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
        client.getPropertyOfTypeAsync(snapshot.snapshot, project.id, stringType.id, "length"),
      ).resolves.toEqual(expect.objectContaining({ name: "value" }));
      await expect(
        client.isTypeAssignableToAsync(snapshot.snapshot, project.id, stringType.id, stringType.id),
      ).resolves.toBe(true);
      await expect(
        client.getTypesAtPositionsAsync(
          snapshot.snapshot,
          project.id,
          "/workspace/src/index.ts",
          [1, 2],
        ),
      ).resolves.toEqual([
        expect.objectContaining({ id: "t0000000000000001" }),
        expect.objectContaining({ id: "t0000000000000001" }),
      ]);
      await expect(
        client.getSymbolsAtPositionsAsync(
          snapshot.snapshot,
          project.id,
          "/workspace/src/index.ts",
          [1, 2],
        ),
      ).resolves.toEqual([expect.objectContaining({ name: "value" }), null]);
      const positionedSymbol = await client.getSymbolAtPositionAsync(
        snapshot.snapshot,
        project.id,
        "/workspace/src/index.ts",
        1,
      );
      await expect(
        client.getAliasedSymbolAsync(snapshot.snapshot, project.id, positionedSymbol!.id),
      ).resolves.toEqual(expect.objectContaining({ name: "value" }));
      await expect(
        client.getImmediateAliasedSymbolAsync(snapshot.snapshot, project.id, positionedSymbol!.id),
      ).resolves.toEqual(expect.objectContaining({ name: "value" }));
      await expect(
        client.getExportsOfModuleAsync(snapshot.snapshot, project.id, positionedSymbol!.id),
      ).resolves.toEqual([expect.objectContaining({ name: "value" })]);
      await expect(
        client.getSymbolOfTypeAsync(snapshot.snapshot, stringType.id, project.id),
      ).resolves.toEqual(expect.objectContaining({ name: "value" }));
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

  const contentMapperCase = realCorsaReady ? it : it.skip;

  contentMapperCase(
    "runs trusted TypeScript content mappers through the spawned runtime",
    async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), "corsa-content-mapper-"));
      const tsconfig = join(projectRoot, "tsconfig.json");
      const mapperFile = join(projectRoot, "node_modules", "mapper", "mapper.mjs");
      let client: ReturnType<typeof CorsaApiClient.spawn> | undefined;
      let snapshotHandle: string | undefined;

      try {
        writeContentMapperProject(projectRoot);

        client = CorsaApiClient.spawn({
          executable: realBinary,
          cwd: projectRoot,
          mode: "msgpack",
          runExternalCode: true,
        });
        client.initialize();

        const config = client.parseConfigFile(tsconfig);
        expect(config.fileNames.some((fileName) => fileName.endsWith("main.ts"))).toBe(true);

        const snapshot = client.updateSnapshot({ openProject: tsconfig });
        snapshotHandle = snapshot.snapshot;
        const project = snapshot.projects[0];
        expect(project).toBeDefined();

        const source = readText(
          client.getSourceFile(snapshot.snapshot, project.id, join(projectRoot, "app.box")),
        );
        expect(source).toContain('export const mapped: string = "from mapper";');
        expect(existsSync(mapperFile)).toBe(true);
      } finally {
        try {
          if (client && snapshotHandle) {
            client.releaseHandle(snapshotHandle);
          }
        } finally {
          client?.close();
          await removeTemporaryProject(projectRoot);
        }
      }
    },
  );
});

function writeContentMapperProject(projectRoot: string): void {
  const mapperRoot = join(projectRoot, "node_modules", "mapper");
  mkdirSync(mapperRoot, { recursive: true });
  writeFileSync(
    join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          target: "es2020",
        },
        contentMappers: [{ package: "mapper", extensions: [".box"] }],
        include: ["**/*"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(projectRoot, "app.box"), "ignored by the mapper\n");
  writeFileSync(
    join(projectRoot, "main.ts"),
    ['import { mapped } from "./app.box";', "export const value: string = mapped;", ""].join("\n"),
  );
  writeFileSync(
    join(mapperRoot, "package.json"),
    JSON.stringify(
      {
        name: "mapper",
        version: "1.0.0",
        typescript: {
          contentMapper: {
            exec: [process.execPath, join(mapperRoot, "mapper.mjs")],
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(mapperRoot, "mapper.mjs"),
    [
      "let buffer = Buffer.alloc(0);",
      'process.stdin.on("data", (chunk) => {',
      "  buffer = Buffer.concat([buffer, chunk]);",
      "  drain();",
      "});",
      'process.stdin.on("end", () => process.exit(0));',
      "function drain() {",
      "  for (;;) {",
      '    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");',
      "    if (headerEnd < 0) return;",
      '    const header = buffer.subarray(0, headerEnd).toString("utf8");',
      "    const match = /^Content-Length: (\\d+)/im.exec(header);",
      '    if (!match) throw new Error("missing Content-Length");',
      "    const bodyStart = headerEnd + 4;",
      "    const length = Number(match[1]);",
      "    if (buffer.length < bodyStart + length) return;",
      '    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString("utf8"));',
      "    buffer = buffer.subarray(bodyStart + length);",
      "    handle(message);",
      "  }",
      "}",
      "function handle(message) {",
      "  switch (message.method) {",
      '    case "initialize":',
      '      send(message.id, { protocolVersion: 1, positionEncoding: "utf-8", diagnosticSource: "box" });',
      "      return;",
      '    case "openProject":',
      "      send(message.id, {});",
      "      return;",
      '    case "closeProject":',
      "      send(message.id, null);",
      "      return;",
      '    case "transform":',
      '      send(message.id, { text: "export const mapped: string = \\"from mapper\\";\\n", extension: ".ts", mappings: [] });',
      "      return;",
      "    default:",
      "      sendError(message.id, `unexpected method ${message.method}`);",
      "  }",
      "}",
      "function send(id, result) {",
      '  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }), "utf8");',
      "  process.stdout.write(`Content-Length: ${body.length}\\r\\n\\r\\n`);",
      "  process.stdout.write(body);",
      "}",
      "function sendError(id, message) {",
      '  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message } }), "utf8");',
      "  process.stdout.write(`Content-Length: ${body.length}\\r\\n\\r\\n`);",
      "  process.stdout.write(body);",
      "}",
      "",
    ].join("\n"),
  );
}

function readText(source: Uint8Array | null): string {
  expect(source).not.toBeNull();
  return Buffer.from(source!).toString("utf8");
}

function readMockCallCount(dir: string, method: string): number {
  const file = join(dir, `${method}.count`);
  if (!existsSync(file)) {
    return 0;
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() === "1").length;
}

async function removeTemporaryProject(projectRoot: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  for (;;) {
    try {
      rmSync(projectRoot, { force: true, recursive: true });
      return;
    } catch (error) {
      if (!isRetryableWindowsRmError(error) || Date.now() >= deadline) {
        throw error;
      }
      await delay(50);
    }
  }
}

function isRetryableWindowsRmError(error: unknown): boolean {
  if (process.platform !== "win32" || typeof error !== "object" || error === null) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "ENOTEMPTY" || code === "EPERM";
}

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
