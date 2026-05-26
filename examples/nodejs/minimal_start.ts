import { isUnsafeAssignment, isUnsafeReturn, CorsaVirtualDocument } from "@corsa-bind/napi";

import { isMain } from "../shared.ts";

export function runMinimalStartExample() {
  const document = CorsaVirtualDocument.untitled(
    "/virtual/minimal.ts",
    "typescript",
    "const answer = 41;\n",
  );
  const emitted = document.applyChanges([
    {
      range: {
        start: { line: 0, character: 15 },
        end: { line: 0, character: 17 },
      },
      text: "42",
    },
  ]);

  return {
    document: document.state(),
    emittedChangeCount: emitted.length,
    unsafeAssignment: isUnsafeAssignment({
      sourceTypeTexts: ["Set<any>"],
      targetTypeTexts: ["Set<string>"],
    }),
    unsafeReturn: isUnsafeReturn({
      sourceTypeTexts: ["Promise<any>"],
      targetTypeTexts: ["Promise<string>"],
    }),
  };
}

if (isMain(import.meta.url)) {
  console.log(JSON.stringify(runMinimalStartExample(), null, 2));
}
