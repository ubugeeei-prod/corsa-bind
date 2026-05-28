import { describe, expect, it, vi } from "vitest";

const clients: FakeClient[] = [];

class FakeClient {
  readonly initialize = vi.fn();
  readonly parseConfigFile = vi.fn(() => ({ options: {}, fileNames: [] }));
  readonly updateSnapshot = vi.fn(() => ({
    snapshot: `snapshot-${this.updateSnapshot.mock.calls.length}`,
    projects: [{ id: "project-1" }],
  }));
  readonly getTypeAtPosition = vi.fn(() => ({
    id: "type-1",
    flags: 0,
    texts: ["string"],
  }));
  readonly releaseHandle = vi.fn();
  readonly close = vi.fn();

  readonly callJson = vi.fn((method: string) => {
    if (method === "describeCapabilities") {
      return { overlay: { updateSnapshotOverlayChanges: false } };
    }
    if (method === "getDefaultProjectForFile") {
      return { id: "project-1" };
    }
    return undefined;
  });
}

vi.mock("@corsa-bind/napi", () => ({
  CorsaApiClient: {
    spawn: vi.fn(() => {
      const client = new FakeClient();
      clients.push(client);
      return client;
    }),
  },
}));

const { CorsaProjectSession } = await import("./session");

describe("CorsaProjectSession", () => {
  it("reuses the current snapshot when visiting a new unchanged file", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      cacheLifetimeMs: 60_000,
    } as const;
    const session = new CorsaProjectSession(
      {
        filename: "/tmp/one.ts",
        rootDir: "/tmp",
        configPath: "/tmp/tsconfig.json",
        runtime,
      },
      runtime,
    );

    session.getTypeAtPosition("/tmp/one.ts", 0);
    session.getTypeAtPosition("/tmp/two.ts", 0);

    expect(clients[0]?.updateSnapshot).toHaveBeenCalledTimes(1);
  });
});
