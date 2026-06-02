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
  readonly typeToString = vi.fn(() => "type:string");
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

  it("does not rotate an unchanged snapshot only because the cache lifetime expired", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    try {
      clients.length = 0;
      const runtime = {
        executable: "/tmp/corsa",
        cwd: "/tmp",
        mode: "msgpack",
        cacheLifetimeMs: 1,
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

      const type = session.getTypeAtPosition("/tmp/one.ts", 0);
      vi.advanceTimersByTime(2);
      session.typeToString(type as never);
      session.getTypeAtPosition("/tmp/one.ts", 1);

      expect(clients[0]?.updateSnapshot).toHaveBeenCalledTimes(1);
      expect(clients[0]?.releaseHandle).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

  // Regression for GH#211 crash site 1: implemented-interface handles have
  // empty `texts`, and upstream Corsa sometimes evicts the handle from its
  // snapshot registry before typeToString runs. The checker warms the cache
  // with the `implements` identifier via rememberTypeText, so typeToString
  // should return that name instead of rethrowing the stale-handle error.
  it("returns a remembered type text when typeToString hits a stale handle", () => {
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

    const type = { id: "type-7", flags: 0, texts: [] as string[] };
    session.rememberTypeText(type.id, "Serializable");
    client.typeToString.mockImplementationOnce(() => {
      throw new Error(
        'protocol error: api: client error: type handle "type-7" not found in snapshot registry',
      );
    });

    expect(session.typeToString(type as never)).toBe("Serializable");
  });
});
