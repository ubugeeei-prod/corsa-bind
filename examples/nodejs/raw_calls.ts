import { CorsaApiClient } from "@corsa-bind/napi";

import { assertExists, isMain, mockBinary, workspaceRoot } from "../shared.ts";

export function runRawCallsExample() {
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
    client.initialize();
    const echoed = client.callJson<{ value: number }>("echo", { value: 42 });
    const snapshot = client.updateSnapshot({
      openProject: "/workspace/tsconfig.json",
    });
    snapshotHandle = snapshot.snapshot;
    const project = snapshot.projects[0];
    if (!project) {
      throw new Error("raw calls example did not return a project");
    }

    const source = client.callBinary("getSourceFile", {
      snapshot: snapshot.snapshot,
      project: project.id,
      file: "/workspace/src/index.ts",
    });

    return {
      binaryLength: source?.byteLength ?? 0,
      echo: echoed,
      ping: client.callJson<string>("ping"),
      sourceText: Buffer.from(source ?? []).toString("utf8"),
    };
  } finally {
    if (snapshotHandle) {
      client.releaseHandle(snapshotHandle);
    }
    client.close();
  }
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runRawCallsExample(), null, 2));
}
