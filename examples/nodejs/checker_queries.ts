import { CorsaApiClient } from "@corsa-bind/napi";
import type { ProjectResponse, UpdateSnapshotResponse } from "@corsa-bind/napi";

import { assertExists, isMain, mockBinary, workspaceRoot } from "../shared.ts";

interface SymbolResponse {
  id: string;
  name: string;
  valueDeclaration?: string;
}

interface TypeResponse {
  id: string;
  symbol?: string;
  texts: string[];
}

interface SignatureResponse {
  id: string;
  parameters: string[];
}

interface TypePredicateResponse {
  parameterName?: string;
  type?: TypeResponse;
}

interface IndexInfo {
  keyType: TypeResponse;
  valueType: TypeResponse;
  isReadonly: boolean;
}

function requireProject(snapshot: UpdateSnapshotResponse): ProjectResponse {
  const project = snapshot.projects[0];
  if (!project) {
    throw new Error("checker queries example did not return a project");
  }
  return project;
}

export function runCheckerQueriesExample() {
  assertExists(
    mockBinary,
    "mock Corsa binary",
    "run `vp run -w build_mock` or `vp run -w build` first",
  );

  const client = CorsaApiClient.spawn({
    executable: mockBinary,
    cwd: workspaceRoot,
    mode: "jsonrpc",
  });

  let snapshotHandle: string | undefined;

  try {
    const init = client.initialize();
    const snapshot = client.updateSnapshot({
      openProject: "/workspace/tsconfig.json",
    });
    snapshotHandle = snapshot.snapshot;
    const project = requireProject(snapshot);

    const symbol = client.callJson<SymbolResponse | null>("getSymbolAtPosition", {
      snapshot: snapshot.snapshot,
      project: project.id,
      file: "/workspace/src/index.ts",
      position: 1,
    });
    if (!symbol) {
      throw new Error("checker queries example did not resolve a symbol");
    }

    const apparentType = client.callJson<TypeResponse | null>("getTypeOfSymbol", {
      snapshot: snapshot.snapshot,
      project: project.id,
      symbol: symbol.id,
    });
    if (!apparentType) {
      throw new Error("checker queries example did not resolve an apparent type");
    }

    const declaredType = client.callJson<TypeResponse | null>("getDeclaredTypeOfSymbol", {
      snapshot: snapshot.snapshot,
      project: project.id,
      symbol: symbol.id,
    });
    const typeAtPosition = client.callJson<TypeResponse | null>("getTypeAtPosition", {
      snapshot: snapshot.snapshot,
      project: project.id,
      file: "/workspace/src/index.ts",
      position: 1,
    });
    const batchTypes =
      client.callJson<Array<TypeResponse | null> | null>("getTypesAtPositions", {
        snapshot: snapshot.snapshot,
        project: project.id,
        file: "/workspace/src/index.ts",
        positions: [1, 2],
      }) ?? [];
    const signatures = client.callJson<SignatureResponse[]>("getSignaturesOfType", {
      snapshot: snapshot.snapshot,
      project: project.id,
      type: apparentType.id,
      kind: 0,
    });
    const primarySignature = signatures[0];
    if (!primarySignature) {
      throw new Error("checker queries example did not return a signature");
    }

    const returnType = client.callJson<TypeResponse | null>("getReturnTypeOfSignature", {
      snapshot: snapshot.snapshot,
      project: project.id,
      signature: primarySignature.id,
    });
    const predicate = client.callJson<TypePredicateResponse | null>("getTypePredicateOfSignature", {
      snapshot: snapshot.snapshot,
      project: project.id,
      signature: primarySignature.id,
    });
    const properties =
      client.callJson<SymbolResponse[] | null>("getPropertiesOfType", {
        snapshot: snapshot.snapshot,
        project: project.id,
        type: apparentType.id,
      }) ?? [];
    const indexInfos =
      client.callJson<IndexInfo[] | null>("getIndexInfosOfType", {
        snapshot: snapshot.snapshot,
        project: project.id,
        type: apparentType.id,
      }) ?? [];
    const resolved = client.callJson<SymbolResponse | null>("resolveName", {
      snapshot: snapshot.snapshot,
      project: project.id,
      name: "value",
      meaning: 2,
      file: "/workspace/src/index.ts",
      position: 1,
    });
    const exported = client.callJson<SymbolResponse>("getExportSymbolOfSymbol", {
      snapshot: snapshot.snapshot,
      symbol: symbol.id,
    });

    return {
      currentDirectory: init.currentDirectory,
      projectId: project.id,
      symbol: {
        id: symbol.id,
        name: symbol.name,
        valueDeclaration: symbol.valueDeclaration ?? null,
      },
      types: {
        apparent: apparentType.texts[0] ?? null,
        apparentId: apparentType.id,
        declared: declaredType?.texts[0] ?? null,
        position: typeAtPosition?.texts[0] ?? null,
        batchIds: batchTypes.map((item) => item?.id ?? null),
        returnType: returnType?.texts[0] ?? null,
        predicateType: predicate?.type?.texts[0] ?? null,
      },
      signatures: signatures.map((signature) => ({
        id: signature.id,
        parameterCount: signature.parameters.length,
      })),
      properties: properties.map((property) => property.name),
      indexInfos: indexInfos.map((info) => ({
        keyType: info.keyType.texts[0] ?? null,
        valueType: info.valueType.texts[0] ?? null,
        isReadonly: info.isReadonly,
      })),
      resolvedName: resolved?.name ?? null,
      exportedName: exported.name,
    };
  } finally {
    if (snapshotHandle) {
      client.releaseHandle(snapshotHandle);
    }
    client.close();
  }
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runCheckerQueriesExample(), null, 2));
}
