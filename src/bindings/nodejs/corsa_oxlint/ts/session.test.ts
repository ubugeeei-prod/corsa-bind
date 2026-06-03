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

  it("uses the client-normalized base-types result", () => {
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
    client.callJson.mockImplementationOnce(() => [] as never);

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

  it("returns a server-rendered cached type text when typeToString later hits a stale handle", () => {
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
    client.typeToString.mockReturnValueOnce("Serializable");
    expect(session.typeToString(type as never)).toBe("Serializable");
    client.typeToString.mockImplementationOnce(() => {
      throw new Error(
        'protocol error: api: client error: type handle "type-7" not found in snapshot registry',
      );
    });

    expect(session.typeToString(type as never)).toBe("Serializable");
  });
});
