import {
  CorsaVirtualDocument,
  classifyTypeText,
  isUnsafeAssignment,
  splitTypeText,
  version,
} from "@corsa-bind/napi";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const versionText = version();

assert(
  typeof versionText === "string" && versionText.length > 0,
  "version export should be available",
);
assert(classifyTypeText('"value"') === "string", "classifyTypeText should call the native binding");
assert(
  isUnsafeAssignment({
    sourceTypeTexts: ["Set<any>"],
    targetTypeTexts: ["Set<string>"],
  }),
  "isUnsafeAssignment should call the native binding",
);
assert(
  splitTypeText("string | Promise<number>").join(",") === "string,Promise<number>",
  "splitTypeText should preserve top-level type terms",
);

const document = CorsaVirtualDocument.untitled(
  "/runtime-compat.ts",
  "typescript",
  "let value = 1;\n",
);
document.applyChanges([
  {
    range: {
      start: { line: 0, character: 12 },
      end: { line: 0, character: 13 },
    },
    text: "2",
  },
]);
assert(document.text === "let value = 2;\n", "virtual document edits should work");

console.log(`@corsa-bind/napi runtime compatibility ok (${versionText})`);
