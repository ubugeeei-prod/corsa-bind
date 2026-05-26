import type { Node } from "@oxlint/plugins";

import type { ContextWithParserOptions, TsgoNode } from "./types";

const estreeToTsgo = new WeakMap<object, TsgoNode>();
const tsgoToEstree = new WeakMap<object, Node>();

export function createNodeMaps(context: ContextWithParserOptions): {
  esTreeNodeToTSNodeMap: {
    get(node: Node): TsgoNode;
    has(node: Node): boolean;
  };
  tsNodeToESTreeNodeMap: {
    get(node: TsgoNode): Node;
    has(node: TsgoNode): boolean;
  };
} {
  return {
    esTreeNodeToTSNodeMap: {
      get(node) {
        let current = estreeToTsgo.get(node);
        if (!current) {
          current = createTsgoNode(context.filename, node);
          estreeToTsgo.set(node, current);
          tsgoToEstree.set(current, node);
        }
        return current;
      },
      has(node) {
        return estreeToTsgo.has(node);
      },
    },
    tsNodeToESTreeNodeMap: {
      get(node) {
        const value = tsgoToEstree.get(node);
        if (!value) {
          throw new Error("corsa-oxlint could not map Corsa node back to ESTree");
        }
        return value;
      },
      has(node) {
        return tsgoToEstree.has(node);
      },
    },
  };
}

export function toPosition(node: Node | TsgoNode): number {
  return "pos" in node ? node.pos : assertRange(node)[0];
}

function createTsgoNode(fileName: string, node: Node): TsgoNode {
  const [pos, end] = assertRange(node);
  return {
    fileName,
    pos,
    end,
    range: [pos, end],
  };
}

function assertRange(node: Node): readonly [number, number] {
  const range = (node as Node & { range?: readonly [number, number] }).range;
  if (!range) {
    throw new Error("corsa-oxlint requires ESTree nodes with range data");
  }
  return range;
}
