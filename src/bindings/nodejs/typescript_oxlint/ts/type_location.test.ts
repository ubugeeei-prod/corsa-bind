import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { defaultTsgoExecutable } from "./context";
import { createTypeChecker } from "./checker";
import { OxlintUtils } from "./oxlint_utils";
import { RuleTester } from "./rule_tester";

const workspaceRoot = resolve(import.meta.dirname, "../../../../..");
const realTsgoBinary = defaultTsgoExecutable(workspaceRoot);
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const mockBinary = resolve(workspaceRoot, `target/debug/mock_tsgo${executableSuffix}`);
const integrationCase = existsSync(realTsgoBinary) ? it : it.skip;

describe("corsa-oxlint type locations", () => {
  integrationCase("resolves types from declaration wrapper nodes", () => {
    const seen: Record<string, string | undefined> = {};
    const createRule = OxlintUtils.RuleCreator((name) => `https://example.com/rules/${name}`);
    const rule = createRule({
      name: "wrapper-node-types",
      meta: {
        type: "problem",
        docs: {
          description: "exercise wrapper node type lookup",
          requiresTypeChecking: true,
        },
        messages: {
          unexpected: "unexpected",
        },
        schema: [],
      },
      defaultOptions: [],
      create(context: any) {
        const services = OxlintUtils.getParserServices(context);
        const checker = services.program.getTypeChecker();
        return {
          TSPropertySignature(node: any) {
            if (node.key?.name !== "label") {
              return;
            }
            const fromNode = checker.getTypeAtLocation(node);
            const fromKey = checker.getTypeAtLocation(node.key);
            seen.propertyFromNode = fromNode ? checker.typeToString(fromNode) : undefined;
            seen.propertyFromKey = fromKey ? checker.typeToString(fromKey) : undefined;
          },
          ClassDeclaration(node: any) {
            if (node.id?.name !== "ChildClass") {
              return;
            }
            const fromNode = checker.getTypeAtLocation(node);
            const fromId = checker.getTypeAtLocation(node.id);
            seen.classFromNode = fromNode ? checker.typeToString(fromNode) : undefined;
            seen.classFromId = fromId ? checker.typeToString(fromId) : undefined;
          },
        };
      },
    });

    const tester = new RuleTester();
    tester.run("wrapper-node-types", rule as any, {
      valid: [
        {
          code: ["interface Demo {", "  readonly label: string;", "}", "class ChildClass {}"].join(
            "\n",
          ),
          settings: {
            typescriptOxlint: {
              parserOptions: {
                tsgo: {
                  executable: realTsgoBinary,
                },
              },
            },
          },
        },
      ],
      invalid: [],
    });

    expect(seen.propertyFromNode).toBe("string");
    expect(seen.propertyFromNode).toBe(seen.propertyFromKey);
    expect(seen.classFromNode).toBeDefined();
    expect(seen.classFromNode).not.toBe("any");
    expect(seen.classFromNode).toBe(seen.classFromId);
  });

  it("sends linted source text overlay changes when it differs from disk", () => {
    const workspace = mkdtempSync(resolve(tmpdir(), "corsa-oxlint-overlay-"));
    const srcDir = resolve(workspace, "src");
    mkdirSync(srcDir, { recursive: true });
    const filename = resolve(srcDir, "fixture.ts");
    const diskText = "const value: number = 1;\n";
    writeFileSync(filename, diskText);
    writeFileSync(
      resolve(workspace, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }),
    );
    const paramsDir = resolve(workspace, "params");
    const previousParamsDir = process.env.CORSA_MOCK_TSGO_PARAMS_DIR;
    process.env.CORSA_MOCK_TSGO_PARAMS_DIR = paramsDir;
    try {
      const text = "const value: string = 'memory';\n";
      const checker = createTypeChecker({
        cwd: workspace,
        filename,
        settings: {
          typescriptOxlint: {
            parserOptions: {
              project: ["tsconfig.json"],
              tsgo: {
                executable: mockBinary,
                cwd: workspace,
                mode: "jsonrpc",
              },
            },
          },
        },
        sourceCode: {
          text,
        },
      } as any);

      checker.getTypeAtLocation({ type: "Identifier", range: [6, 11] } as any);

      const diskChecker = createTypeChecker({
        cwd: workspace,
        filename,
        settings: {
          typescriptOxlint: {
            parserOptions: {
              project: ["tsconfig.json"],
              tsgo: {
                executable: mockBinary,
                cwd: workspace,
                mode: "jsonrpc",
              },
            },
          },
        },
        sourceCode: {
          text: diskText,
        },
      } as any);

      diskChecker.getTypeAtLocation({ type: "Identifier", range: [6, 11] } as any);

      const updates = readFileSync(resolve(paramsDir, "updateSnapshot.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(updates.at(-2)?.overlayChanges?.upsert?.[0]).toMatchObject({
        document: filename,
        text,
        languageId: "typescript",
      });
      expect(updates.at(-1)?.overlayChanges?.delete).toEqual([filename]);
    } finally {
      if (previousParamsDir === undefined) {
        delete process.env.CORSA_MOCK_TSGO_PARAMS_DIR;
      } else {
        process.env.CORSA_MOCK_TSGO_PARAMS_DIR = previousParamsDir;
      }
    }
  });
});
