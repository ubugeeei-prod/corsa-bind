import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createTypeChecker } from "./checker";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const mockBinary = resolve(workspaceRoot, `target/debug/mock_corsa${executableSuffix}`);

/**
 * Request fields that carry an object handle minted by a specific project.
 *
 * Stable TypeScript 7 runtimes resolve these handles per project and answer a
 * project-less lookup with `empty project ID for <kind> handle <n>`, so a
 * request naming one of these fields must also name a project.
 */
const PROJECT_SCOPED_HANDLE_FIELDS = ["type", "symbol", "signature"] as const;

/**
 * Type-relation accessors this suite drives.
 *
 * Recorded traffic — not this list — is what the contract assertion inspects,
 * so an endpoint added later is covered as soon as anything calls it. The list
 * exists so the suite fails when a call stops reaching the wire, rather than
 * passing vacuously.
 */
const TRAVERSAL_ACCESSORS = [
  "getTypesOfType",
  "getTargetOfType",
  "getTypeParametersOfType",
  "getOuterTypeParametersOfType",
  "getLocalTypeParametersOfType",
  "getObjectTypeOfType",
  "getIndexTypeOfType",
  "getCheckTypeOfType",
  "getExtendsTypeOfType",
  "getBaseTypeOfType",
  // `getConstraintOfType` answers from `getConstraintOfTypeParameter` first and
  // only falls through to the direct endpoint when that yields nothing.
  "getConstraintOfTypeParameter",
  "getPropertiesOfType",
  "getBaseTypes",
  "getTypeArguments",
] as const;

interface RecordedRequest {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function recordedRequests(paramsDir: string): readonly RecordedRequest[] {
  return readdirSync(paramsDir)
    .filter((entry) => entry.endsWith(".jsonl"))
    .flatMap((entry) =>
      readFileSync(resolve(paramsDir, entry), "utf8")
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => ({
          method: entry.slice(0, -".jsonl".length),
          params: (JSON.parse(line) ?? {}) as Record<string, unknown>,
        }))
        .filter((request) => typeof request.params === "object"),
    );
}

function namesAHandle(params: Record<string, unknown>): boolean {
  return PROJECT_SCOPED_HANDLE_FIELDS.some((field) => {
    const value = params[field];
    return typeof value === "number" || (typeof value === "string" && value.trim().length > 0);
  });
}

function hasProject(params: Record<string, unknown>): boolean {
  return typeof params.project === "string" && params.project.trim().length > 0;
}

function driveTypeRelationSurface(paramsDir: string): readonly RecordedRequest[] {
  const workspace = mkdtempSync(resolve(tmpdir(), "corsa-oxlint-project-scope-"));
  const srcDir = resolve(workspace, "src");
  mkdirSync(srcDir, { recursive: true });
  const filename = resolve(srcDir, "fixture.ts");
  writeFileSync(filename, "const value: number = 1;\n");
  writeFileSync(
    resolve(workspace, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
  );

  const previousParamsDir = process.env.CORSA_MOCK_PARAMS_DIR;
  const previousAllFlags = process.env.CORSA_MOCK_ALL_TYPE_FLAGS;
  process.env.CORSA_MOCK_PARAMS_DIR = paramsDir;
  // Clients skip a traversal request unless the type carries the matching
  // TypeFlags bit, so ask the mock for a type that satisfies every guard.
  process.env.CORSA_MOCK_ALL_TYPE_FLAGS = "1";
  try {
    const checker = createTypeChecker({
      cwd: workspace,
      filename,
      settings: {
        corsaOxlint: {
          parserOptions: {
            project: ["tsconfig.json"],
            corsa: { executable: mockBinary, cwd: workspace, mode: "jsonrpc" },
          },
        },
      },
      sourceCode: { text: "const value: number = 1;\n" },
    } as never);

    const type = checker.getTypeAtLocation({ type: "Identifier", range: [6, 11] } as never);
    expect(type).toBeDefined();
    // A contract violation makes the mock reject the request. Swallow it here so
    // the assertions below can report every offending endpoint at once instead
    // of the suite dying on the first one.
    const attempt = (call: () => unknown): void => {
      try {
        call();
      } catch {
        // Reported by the recorded-traffic assertions.
      }
    };
    const accessors = checker as unknown as Record<string, (value: unknown) => unknown>;
    for (const accessor of [...TRAVERSAL_ACCESSORS, "getConstraintOfType"]) {
      attempt(() => accessors[accessor]?.(type));
    }
    attempt(() => checker.getSignaturesOfType(type as never, 0));
    attempt(() => checker.getSymbolOfType(type as never));
  } finally {
    if (previousParamsDir === undefined) {
      delete process.env.CORSA_MOCK_PARAMS_DIR;
    } else {
      process.env.CORSA_MOCK_PARAMS_DIR = previousParamsDir;
    }
    if (previousAllFlags === undefined) {
      delete process.env.CORSA_MOCK_ALL_TYPE_FLAGS;
    } else {
      process.env.CORSA_MOCK_ALL_TYPE_FLAGS = previousAllFlags;
    }
  }
  return recordedRequests(paramsDir);
}

describe("project-scoped handle requests", () => {
  const paramsDir = mkdtempSync(resolve(tmpdir(), "corsa-oxlint-params-"));
  const requests = driveTypeRelationSurface(paramsDir);

  /**
   * Guards the whole bug family behind issues #384, #389, #390, #392, #393,
   * #395, #410, #413, #416, #418, #427, and #440: each was one endpoint
   * forgetting to name the project that issued the handle it was resolving.
   *
   * Asserting over recorded traffic rather than a hand-maintained endpoint list
   * is what makes this hold for endpoints added later.
   */
  it("names a project on every request that carries an object handle", () => {
    const offenders = requests
      .filter((request) => namesAHandle(request.params) && !hasProject(request.params))
      .map((request) => request.method);

    expect([...new Set(offenders)]).toEqual([]);
  });

  it("actually exercised the type-relation surface", () => {
    const methods = new Set(requests.map((request) => request.method));
    const missing = TRAVERSAL_ACCESSORS.filter((accessor) => !methods.has(accessor));

    expect(missing).toEqual([]);
  });
});
