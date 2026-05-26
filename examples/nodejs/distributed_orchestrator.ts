import { CorsaDistributedOrchestrator, CorsaVirtualDocument } from "@corsa-bind/napi";

import { isMain } from "../shared.ts";

export function runDistributedOrchestratorExample() {
  const cluster = new CorsaDistributedOrchestrator(["n1", "n2", "n3"]);
  const term = cluster.campaign("n1");
  const document = CorsaVirtualDocument.inMemory(
    "cluster",
    "/main.ts",
    "typescript",
    "let value = 1;",
  );

  cluster.openVirtualDocument(document.state());
  cluster.changeVirtualDocument(document.uri, [
    {
      range: {
        start: { line: 0, character: 12 },
        end: { line: 0, character: 13 },
      },
      text: "2",
    },
  ]);

  return {
    leaderId: cluster.leaderId(),
    node2Document: cluster.document("n2", document.uri),
    term,
  };
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runDistributedOrchestratorExample(), null, 2));
}
