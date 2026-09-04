import type { SymbolResponse, TypeResponse } from "./types";

export interface CheckerBatchScope {
  snapshot: string;
  project: string;
}

export type CheckerBatchQuery =
  | {
      key: string;
      kind: "typeAtPosition";
      file: string;
      position: number;
    }
  | {
      key: string;
      kind: "typesAtPositions";
      file: string;
      positions: readonly number[];
    }
  | {
      key: string;
      kind: "symbolAtPosition";
      file: string;
      position: number;
    }
  | {
      key: string;
      kind: "symbolsAtPositions";
      file: string;
      positions: readonly number[];
    }
  | {
      key: string;
      kind: "typeOfSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "typesOfSymbols";
      symbols: readonly string[];
    }
  | {
      key: string;
      kind: "symbolOfType";
      type: string;
    }
  | {
      key: string;
      kind: "declaredTypeOfSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "aliasedSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "immediateAliasedSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "exportsOfModule";
      symbol: string;
    }
  | {
      key: string;
      kind: "propertyOfType";
      type: string;
      name: string;
    }
  | {
      key: string;
      kind: "typeArguments";
      type: string;
      objectFlags?: number;
    }
  | {
      key: string;
      kind: "constraintOfType";
      type: string;
    }
  | {
      key: string;
      kind: "isTypeAssignableTo";
      source: string;
      target: string;
    }
  | {
      key: string;
      kind: "typeToString";
      type: string;
      location?: string;
      flags?: number;
    };

export type CheckerBatchResult =
  | TypeResponse
  | Array<TypeResponse | null>
  | SymbolResponse
  | Array<SymbolResponse | null>
  | boolean
  | string
  | null;

export type ResolvedCheckerBatchItem =
  | {
      key: string;
      kind: CheckerBatchQuery["kind"];
      result: CheckerBatchResult;
      error?: never;
    }
  | {
      key: string;
      kind: CheckerBatchQuery["kind"];
      result?: never;
      error: string;
    };
