import { beforeEach, describe, expect, it, vi } from "vitest";

const clients: FakeClient[] = [];
const clientSetups: ((client: FakeClient) => void)[] = [];
const spawnOptions: unknown[] = [];

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
  readonly getEncodedSourceFile = vi.fn(
    () => undefined as { text: string; contentMapping?: unknown } | undefined,
  );
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

vi.mock("@corsa-bind/napi", async () => {
  const actual = await vi.importActual<typeof import("@corsa-bind/napi")>("@corsa-bind/napi");
  return {
    ...actual,
    CorsaApiClient: {
      spawn: vi.fn((options: unknown) => {
        spawnOptions.push(options);
        const client = new FakeClient();
        clients.push(client);
        return client;
      }),
    },
  };
});

const { SpanMap } = await import("@corsa-bind/napi");
const { CorsaProjectSession, uniqueClassDeclarationPosition } = await import("./session");

describe("CorsaProjectSession", () => {
  beforeEach(() => {
    clientSetups.length = 0;
    spawnOptions.length = 0;
  });

  it("reuses the current snapshot when visiting a new unchanged file", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: false,
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

  it("passes trusted content mapper external-code opt-in to the spawned runtime", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: true,
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

    expect(spawnOptions[0]).toMatchObject({
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: true,
    });
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
        runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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

  it("returns an empty list when getBaseTypes hits an empty signature handle", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: false,
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
      throw new Error("protocol error: api: client error: empty signature handle");
    });

    expect(
      session.getBaseTypes({
        id: "type-1",
        flags: 0,
        texts: ["Base"],
      } as never),
    ).toEqual([]);
  });

  it("does not send empty signatures back to the runtime", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: false,
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
    client.callJson.mockClear();

    expect(
      session.getReturnTypeOfSignature({
        id: "",
        flags: 0,
        typeParameters: [],
        parameters: [],
      } as never),
    ).toBeUndefined();
    expect(
      session.getTypePredicateOfSignature({
        id: "",
        flags: 0,
        typeParameters: [],
        parameters: [],
      } as never),
    ).toBeUndefined();
    expect(client.callJson).not.toHaveBeenCalled();
  });

  it("returns undefined when signature relations hit an empty signature handle", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: false,
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
    client.callJson.mockImplementation(() => {
      throw new Error("protocol error: api: client error: empty signature handle");
    });

    const signature = {
      id: "signature-1",
      flags: 0,
      typeParameters: [],
      parameters: [],
    };
    expect(session.getReturnTypeOfSignature(signature as never)).toBeUndefined();
    expect(session.getTypePredicateOfSignature(signature as never)).toBeUndefined();
  });

  it("returns a server-rendered cached type text when typeToString later hits a stale handle", () => {
    clients.length = 0;
    const runtime = {
      executable: "/tmp/corsa",
      cwd: "/tmp",
      mode: "msgpack",
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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
      runExternalCode: false,
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

describe("CorsaProjectSession content mappers", () => {
  const runtime = {
    executable: "/tmp/corsa",
    cwd: "/tmp",
    mode: "msgpack",
    runExternalCode: true,
    cacheLifetimeMs: 60_000,
  } as const;

  /** `<script>\nconst count = 1;\n</script>` mapped to virtual TypeScript. */
  const mappedSourceFile = {
    text: "export const count: number = 1;\n",
    contentMapping: {
      contentMapper: "vue-mapper@1.2.3",
      virtualFileName: "/tmp/App.vue.ts",
      spanMap: [
        {
          virtualStart: 13,
          virtualEnd: 18,
          originalStart: 15,
          originalEnd: 20,
          kind: 0,
          features: SpanMap.Feature.All,
        },
      ],
      diagnosticDirectives: [],
      supplementalSourceFileNames: [],
    },
  };

  function newSession(filename: string) {
    return new CorsaProjectSession(
      { filename, rootDir: "/tmp", configPath: "/tmp/tsconfig.json", runtime },
      runtime,
    );
  }

  function declareVueMapper(client: FakeClient): void {
    client.parseConfigFile.mockReturnValue({
      options: {},
      fileNames: [],
      raw: { contentMappers: [{ package: "vue-mapper", extensions: [".vue"] }] },
    } as never);
  }

  beforeEach(() => {
    clients.length = 0;
    clientSetups.length = 0;
  });

  it("leaves projects without content mappers untouched", () => {
    const session = newSession("/tmp/one.ts");

    session.getTypeAtPosition("/tmp/one.ts", 7);

    expect(clients[0]?.getEncodedSourceFile).not.toHaveBeenCalled();
    expect(clients[0]?.getTypeAtPosition).toHaveBeenCalledWith(
      expect.any(String),
      "project-1",
      "/tmp/one.ts",
      7,
    );
  });

  it("reads the content mappers the tsconfig declares", () => {
    clientSetups.push(declareVueMapper);
    const session = newSession("/tmp/App.vue");

    expect(session.getContentMappers()).toEqual([{ package: "vue-mapper", extensions: [".vue"] }]);
  });

  it("only inspects files whose extension a mapper claims", () => {
    clientSetups.push(declareVueMapper);
    const session = newSession("/tmp/one.ts");

    session.getTypeAtPosition("/tmp/one.ts", 7);

    expect(clients[0]?.getEncodedSourceFile).not.toHaveBeenCalled();
  });

  it("asks the checker at the mapped position for a content mapped file", () => {
    clientSetups.push((client) => {
      declareVueMapper(client);
      client.getEncodedSourceFile.mockReturnValue(mappedSourceFile as never);
    });
    const session = newSession("/tmp/App.vue");

    // Offset 15 is `count` in the `.vue` file; the checker knows it at 13.
    session.getTypeAtPosition("/tmp/App.vue", 15);
    session.getSymbolAtPosition("/tmp/App.vue", 16);

    expect(clients[0]?.getTypeAtPosition).toHaveBeenCalledWith(
      expect.any(String),
      "project-1",
      "/tmp/App.vue",
      13,
    );
    expect(clients[0]?.getSymbolAtPosition).toHaveBeenCalledWith(
      expect.any(String),
      "project-1",
      "/tmp/App.vue",
      14,
    );
    expect(clients[0]?.getEncodedSourceFile).toHaveBeenCalledTimes(1);
  });

  it("reports no type for text the mapper never emitted", () => {
    clientSetups.push((client) => {
      declareVueMapper(client);
      client.getEncodedSourceFile.mockReturnValue(mappedSourceFile as never);
    });
    const session = newSession("/tmp/App.vue");

    // Offset 2 is inside the `<script>` tag, which is not in the virtual text.
    expect(session.getTypeAtPosition("/tmp/App.vue", 2)).toBeUndefined();
    expect(clients[0]?.getTypeAtPosition).not.toHaveBeenCalled();
  });

  it("treats an undecodable payload as not content mapped", () => {
    clientSetups.push((client) => {
      declareVueMapper(client);
      client.getEncodedSourceFile.mockImplementation(() => {
        throw new Error("unsupported encoded source file protocol version 9");
      });
    });
    const session = newSession("/tmp/App.vue");

    expect(session.getContentMapping("/tmp/App.vue")).toBeUndefined();
    expect(session.getTypeAtPosition("/tmp/App.vue", 15)).toBeDefined();
    expect(clients[0]?.getTypeAtPosition).toHaveBeenCalledWith(
      expect.any(String),
      "project-1",
      "/tmp/App.vue",
      15,
    );
  });

  it("still restarts the worker when the decode request hits a closed transport", () => {
    clientSetups.push((client) => {
      declareVueMapper(client);
      client.getEncodedSourceFile.mockImplementation(() => {
        throw new Error("process is closed: msgpack worker");
      });
    });
    clientSetups.push((client) => {
      declareVueMapper(client);
      client.getEncodedSourceFile.mockReturnValue(mappedSourceFile as never);
    });
    const session = newSession("/tmp/App.vue");

    expect(session.getContentMapping("/tmp/App.vue")?.contentMapper).toBe("vue-mapper@1.2.3");
    expect(clients).toHaveLength(2);
  });

  it("exposes the resolved mapping to rule authors", () => {
    clientSetups.push((client) => {
      declareVueMapper(client);
      client.getEncodedSourceFile.mockReturnValue(mappedSourceFile as never);
    });
    const session = newSession("/tmp/App.vue");

    const mapping = session.getContentMapping("/tmp/App.vue");

    expect(mapping?.contentMapper).toBe("vue-mapper@1.2.3");
    expect(mapping?.virtualFileName).toBe("/tmp/App.vue.ts");
    expect(mapping?.virtualText).toBe("export const count: number = 1;\n");
    expect(mapping?.spanMap.virtualToOriginalPosition(13)).toEqual({
      position: 15,
      fidelity: SpanMap.Fidelity.Exact,
    });
    expect(session.getContentMapping("/tmp/plain.ts")).toBeUndefined();
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
