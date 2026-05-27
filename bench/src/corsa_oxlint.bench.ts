import { bench, describe } from "vitest";

import type { ApiMode } from "@corsa-bind/napi";

import type { CorsaNode, CorsaTypeCheckerShape } from "corsa-oxlint";
import { getParserServices } from "corsa-oxlint";

import {
  ensureBenchInputs,
  corsaPath,
  corsaOxlintConfigPath,
  corsaOxlintFixtureDir,
  corsaOxlintFilePath,
  corsaOxlintSourceText,
  workspaceRoot,
} from "./support";

ensureBenchInputs();

const expression = "lhs + rhs";
const expressionOffset = corsaOxlintSourceText.indexOf(expression);
const leftNode = createNode(expressionOffset, expressionOffset + 3);
const rightNode = createNode(expressionOffset + 6, expressionOffset + 9);

const warmCheckers = {
  jsonrpc: getParserServices(createContext("jsonrpc") as never).program.getTypeChecker(),
  msgpack: getParserServices(createContext("msgpack") as never).program.getTypeChecker(),
} as const;

for (const mode of ["msgpack", "jsonrpc"] as const) {
  describe(`corsa-oxlint ${mode}`, () => {
    bench("parserServices init", () => {
      const services = getParserServices(createContext(mode) as never);
      const checker = services.program.getTypeChecker();
      typeText(checker, leftNode);
      typeText(checker, rightNode);
    });

    bench("typeAtLocation", () => {
      const checker = warmCheckers[mode];
      typeText(checker, leftNode);
      typeText(checker, rightNode);
    });
  });
}

function createContext(mode: ApiMode) {
  return {
    cwd: corsaOxlintFixtureDir,
    filename: corsaOxlintFilePath,
    settings: {
      corsaOxlint: {
        parserOptions: {
          project: [corsaOxlintConfigPath],
          tsconfigRootDir: corsaOxlintFixtureDir,
          corsa: {
            executable: corsaPath,
            cwd: workspaceRoot,
            cacheLifetimeMs: 60_000,
            mode,
          },
        },
      },
    },
    sourceCode: {
      text: corsaOxlintSourceText,
    },
  };
}

function createNode(pos: number, end: number): CorsaNode {
  return {
    fileName: corsaOxlintFilePath,
    pos,
    end,
    range: [pos, end],
  };
}

function typeText(checker: CorsaTypeCheckerShape, node: CorsaNode): string | undefined {
  const type = checker.getTypeAtLocation(node);
  if (!type) {
    return undefined;
  }
  return checker.typeToString(checker.getBaseTypeOfLiteralType(type) ?? type);
}
