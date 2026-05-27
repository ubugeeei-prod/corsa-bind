import { bench, describe } from "vitest";

import { CorsaApiClient } from "@corsa-bind/napi";

import { benchOptions, ensureBenchInputs, openBenchSession } from "./support";

ensureBenchInputs();

const sessions = {
  jsonrpc: openBenchSession("jsonrpc"),
  msgpack: openBenchSession("msgpack"),
} as const;

process.on("exit", () => {
  for (const session of Object.values(sessions)) {
    session.client.releaseHandle(session.snapshot);
    session.client.close();
  }
});

for (const mode of ["msgpack", "jsonrpc"] as const) {
  const session = sessions[mode];

  describe(`CorsaApiClient ${mode}`, () => {
    bench("spawn+initialize", () => {
      const client = CorsaApiClient.spawn(benchOptions(mode));
      try {
        client.initialize();
      } finally {
        client.close();
      }
    });

    bench("parseConfigFile", () => {
      session.client.parseConfigFile(session.configPath);
    });

    bench("updateSnapshot warm", () => {
      const fresh = session.client.updateSnapshot({
        openProject: session.configPath,
      });
      session.client.releaseHandle(fresh.snapshot);
    });

    bench("getSourceFile", () => {
      session.client.getSourceFile(session.snapshot, session.projectId, session.primaryFile);
    });

    bench("getStringType", () => {
      session.client.getStringType(session.snapshot, session.projectId);
    });

    bench("typeToString", () => {
      const type = session.client.getStringType(session.snapshot, session.projectId);
      session.client.typeToString(session.snapshot, session.projectId, type.id);
    });
  });
}
