import type { Node } from "@oxlint/plugins";

import type { ContextWithParserOptions, CorsaNode } from "./types";

const estreeToCorsa = new WeakMap<object, CorsaNode>();
const corsaToEstree = new WeakMap<object, Node>();

export function createNodeMaps(context: ContextWithParserOptions): {
  esTreeNodeToTSNodeMap: {
    get(node: Node): CorsaNode;
    has(node: Node): boolean;
  };
  tsNodeToESTreeNodeMap: {
    get(node: CorsaNode): Node;
    has(node: CorsaNode): boolean;
  };
} {
  return {
    esTreeNodeToTSNodeMap: {
      get(node) {
        let current = estreeToCorsa.get(node);
        if (!current) {
          current = createCorsaNode(context.filename, node);
          estreeToCorsa.set(node, current);
          corsaToEstree.set(current, node);
        }
        return current;
      },
      has(node) {
        return estreeToCorsa.has(node);
      },
    },
    tsNodeToESTreeNodeMap: {
      get(node) {
        const value = corsaToEstree.get(node);
        if (!value) {
          throw new Error("corsa oxlint could not map Corsa node back to ESTree");
        }
        return value;
      },
      has(node) {
        return corsaToEstree.has(node);
      },
    },
  };
}

export function toPosition(node: Node | CorsaNode): number {
  return "pos" in node ? node.pos : assertRange(node)[0];
}

function createCorsaNode(fileName: string, node: Node): CorsaNode {
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
    throw new Error("corsa oxlint requires ESTree nodes with range data");
  }
  return range;
}
