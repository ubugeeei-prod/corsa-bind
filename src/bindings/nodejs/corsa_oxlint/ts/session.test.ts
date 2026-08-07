import { beforeEach, describe, expect, it, vi } from "vitest";

const clients: FakeClient[] = [];
const clientSetups: ((client: FakeClient) => void)[] = [];

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
  readonly getSymbolOfType = vi.fn(() => ({
    id: "symbol-1",
    name: "value",
  }));
  readonly getSymbolAtPosition = vi.fn(() => undefined as { id: string; name: string } | undefined);
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

  constructor() {
    clientSetups.shift()?.(this);
  }
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

const { CorsaProjectSession, uniqueClassDeclarationPosition } = await import("./session");

describe("CorsaProjectSession", () => {
  beforeEach(() => {
    clientSetups.length = 0;
  });

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

  it("does not send synthetic fallback types back to the runtime", () => {
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

    expect(
      session.getBaseTypes({
        id: "synthetic-type-argument:14:0:Derived",
        flags: 0,
        texts: ["Derived"],
      } as never),
    ).toEqual([]);
    expect(client.callJson).not.toHaveBeenCalledWith("getBaseTypes", expect.anything());
  });

  it("normalizes numeric raw type handles before typed client calls", () => {
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
    client.callJson.mockImplementationOnce(
      () =>
        ({
          id: 14,
          flags: 0,
          symbol: 3,
          texts: [],
        }) as never,
    );

    const type = session.getBaseTypeOfLiteralType({
      id: "literal-1",
      flags: 0,
      texts: [],
    } as never);

    expect(type?.id).toBe("14");
    expect(type?.symbol).toBe("3");
    session.typeToString(type as never);
    expect(client.typeToString).toHaveBeenLastCalledWith(
      expect.any(String),
      "project-1",
      "14",
      undefined,
      undefined,
    );
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

  it("returns an empty list when getBaseTypes hits an empty type handle", () => {
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
      throw new Error("protocol error: api: client error: empty type handle");
    });

    expect(
      session.getBaseTypes({
        id: "type-1",
        flags: 0,
        texts: ["Base"],
      } as never),
    ).toEqual([]);
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

  it("returns undefined when getSymbolOfType hits a stale handle", () => {
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

    client.getSymbolOfType.mockImplementationOnce(() => {
      throw new Error(
        'protocol error: api: client error: type handle "synthetic-type-argument:1:0:T" not found in snapshot registry',
      );
    });

    expect(
      session.getSymbolOfType({
        id: "synthetic-type-argument:1:0:T",
        flags: 0,
        texts: ["T"],
      } as never),
    ).toBeUndefined();
  });

  it("resolves a matching symbol from the original type lookup position", () => {
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

    const type = session.getTypeAtPosition("/tmp/one.ts", 4);
    const client = clients[0];
    if (!client) {
      throw new Error("expected a fake client");
    }
    client.getSymbolOfType.mockReturnValueOnce(null as never);
    client.getSymbolAtPosition.mockReturnValueOnce({ id: "symbol-base", name: "Base" });
    client.typeToString.mockReturnValueOnce("Base");

    expect(session.getSymbolOfType(type as never)?.name).toBe("Base");
    expect(client.getSymbolAtPosition).toHaveBeenCalledWith(
      expect.any(String),
      "project-1",
      "/tmp/one.ts",
      4,
    );
  });

  it("resolves a nominal type symbol from a property type annotation", () => {
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
    const sourceText = "interface Props { p: Derived; }";
    const propertyPosition = sourceText.indexOf("p:");
    const typePosition = sourceText.indexOf("Derived");

    const type = session.getTypeAtPosition("/tmp/one.ts", propertyPosition, sourceText);
    const client = clients[0];
    if (!client) {
      throw new Error("expected a fake client");
    }
    client.getSymbolOfType.mockReturnValueOnce(null as never);
    client.getSymbolAtPosition
      .mockReturnValueOnce({ id: "symbol-property", name: "p" })
      .mockReturnValueOnce({ id: "symbol-derived", name: "Derived" });
    client.typeToString.mockReturnValueOnce("Derived");
    (type as { texts: string[] }).texts = [];

    expect(session.getSymbolOfType(type as never)?.name).toBe("Derived");
    expect(client.getSymbolAtPosition).toHaveBeenLastCalledWith(
      expect.any(String),
      "project-1",
      "/tmp/one.ts",
      typePosition,
    );
  });

  it("parses declaration handles that omit an end position", () => {
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
    const sourceText = "class Container {}";
    session.getTypeAtPosition("/tmp/one.ts", 0, sourceText);

    expect(session.getNode("0.264./tmp/one.ts")).toEqual({
      id: "0.264./tmp/one.ts",
      fileName: "/tmp/one.ts",
      pos: 0,
      end: sourceText.length,
      range: [0, sourceText.length],
      positionless: true,
    });
    expect(session.getNode("0.18.264./tmp/one.ts")?.range).toEqual([0, 18]);
  });

  it("returns undefined when getSymbolOfType hits an empty type handle", () => {
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
    client.getSymbolOfType.mockImplementationOnce(() => {
      throw new Error("protocol error: api: client error: empty type handle");
    });

    expect(
      session.getSymbolOfType({
        id: "type-1",
        flags: 0,
        texts: ["Base"],
      } as never),
    ).toBeUndefined();
  });

  it("restarts the client once when a type lookup sees a closed transport", () => {
    clients.length = 0;
    clientSetups.push((client) => {
      client.getTypeAtPosition.mockImplementationOnce(() => {
        throw new Error("process is closed: msgpack stdout");
      });
    });
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

    const type = session.getTypeAtPosition("/tmp/one.ts", 0);

    expect(type?.id).toBe("type-1");
    expect(clients).toHaveLength(2);
    expect(clients[0]?.close).toHaveBeenCalled();
    expect(clients[1]?.updateSnapshot).toHaveBeenCalledTimes(1);
    expect(clients[1]?.getTypeAtPosition).toHaveBeenCalledTimes(1);
  });

  it("suppresses transport-close errors while closing the session", () => {
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
    client.releaseHandle.mockImplementationOnce(() => {
      throw new Error("process is closed: msgpack stdin");
    });
    client.close.mockImplementationOnce(() => {
      throw new Error("Broken pipe (os error 32)");
    });

    expect(() => session.close()).not.toThrow();
  });

  it("resolves a type symbol in the project that owns the type handle", () => {
    clients.length = 0;
    clientSetups.push((client) => {
      client.callJson.mockImplementation((method: string) => {
        if (method === "describeCapabilities") {
          return { overlay: { updateSnapshotOverlayChanges: false } };
        }
        if (method === "getDefaultProjectForFile") {
          return { id: "project-2" };
        }
        return undefined;
      });
    });
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

    const type = session.getTypeAtPosition("/tmp/two.ts", 0);
    const client = clients[0];
    if (!client) {
      throw new Error("expected a fake client");
    }

    expect(session.getSymbolOfType(type as never)?.name).toBe("value");
    expect(client.getSymbolOfType).toHaveBeenCalledWith(expect.any(String), "type-1", "project-2");
  });
});

describe("uniqueClassDeclarationPosition", () => {
  it("returns the position of the only class declaration", () => {
    const sourceText = "interface I {}\nclass Descendant implements I {}";

    expect(uniqueClassDeclarationPosition(sourceText, "Descendant")).toBe(
      sourceText.indexOf("class Descendant"),
    );
  });

  it("ignores the same declaration text inside comments", () => {
    const sourceText =
      "interface I {}\n// class Descendant\n/* class Descendant */\nclass Descendant implements I {}";

    expect(uniqueClassDeclarationPosition(sourceText, "Descendant")).toBe(
      sourceText.lastIndexOf("class Descendant"),
    );
  });

  it("ignores the same declaration text inside string literals", () => {
    const sourceText =
      'interface I {}\nconst s = "class Descendant";\nclass Descendant implements I {}';

    expect(uniqueClassDeclarationPosition(sourceText, "Descendant")).toBe(
      sourceText.lastIndexOf("class Descendant"),
    );
  });

  it("returns undefined when only comments or strings mention the declaration", () => {
    const sourceText = '// class Descendant\nconst s = "class Descendant";\nnew Descendant();';

    expect(uniqueClassDeclarationPosition(sourceText, "Descendant")).toBeUndefined();
  });

  it("returns undefined when the file declares the class twice", () => {
    const sourceText = "class Descendant {}\nnamespace N {\n  export class Descendant {}\n}";

    expect(uniqueClassDeclarationPosition(sourceText, "Descendant")).toBeUndefined();
  });
});
