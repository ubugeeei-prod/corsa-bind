import { CorsaApiClient } from "@corsa-bind/napi";

import { assertExists, isMain, mockBinary, workspaceRoot } from "../shared.ts";

export interface MockClientExampleResult {
  currentDirectory: string;
  projectId: string;
  sourceFileText: string;
  stringTypeText: string;
}

export function runMockClientExample(): MockClientExampleResult {
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
    const project = snapshot.projects[0];
    if (!project) {
      throw new Error("mock client did not return a project");
    }

    const sourceFile = client.getSourceFile(
      snapshot.snapshot,
      project.id,
      "/workspace/src/index.ts",
    );
    const stringType = client.getStringType(snapshot.snapshot, project.id);

    return {
      currentDirectory: init.currentDirectory,
      projectId: project.id,
      sourceFileText: Buffer.from(sourceFile ?? []).toString("utf8"),
      stringTypeText: client.typeToString(snapshot.snapshot, project.id, stringType.id),
    };
  } finally {
    if (snapshotHandle) {
      client.releaseHandle(snapshotHandle);
    }
    client.close();
  }
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runMockClientExample(), null, 2));
}
