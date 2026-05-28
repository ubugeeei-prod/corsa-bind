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

  // Regression for GH#206: upstream Corsa occasionally drops a type handle
  // from its snapshot registry after a base-types query on a class with no
  // explicit `extends` clause, which then makes a follow-up
  // `getImplementedTypesOfType` on the same handle throw "type handle ...
  // not found in snapshot registry". The wrapper should treat that as "no
  // base types" so the caller can still see the type's own `implements`.
  it("treats a 'handle not found in snapshot registry' error from getBaseTypes as no bases", () => {
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
    const client = clients[0];
    if (!client) {
      throw new Error("expected a fake client");
    }
    client.callJson.mockImplementationOnce(() => {
      throw new Error(
        'protocol error: api: client error: type handle "t0000000000000057" not found in snapshot registry',
      );
    });

    const result = session.getBaseTypes({
      id: "type-1",
      flags: 0,
      texts: ["Base"],
    } as never);

    expect(result).toEqual([]);
  });

  it("rethrows unexpected errors from getBaseTypes", () => {
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
    const client = clients[0];
    if (!client) {
      throw new Error("expected a fake client");
    }
    client.callJson.mockImplementationOnce(() => {
      throw new Error("protocol error: api: unexpected failure");
    });

    expect(() =>
      session.getBaseTypes({
        id: "type-1",
        flags: 0,
        texts: ["Base"],
      } as never),
    ).toThrow(/unexpected failure/);
  });
});
