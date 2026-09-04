import {
  batchCheckerRequests,
  batchCheckerRequestsAsync,
  type AsyncCheckerBatchCapableClient,
  type CheckerBatchCapableClient,
} from "./checker_batch";

import type { CheckerBatchRequest, CheckerBatchResponse } from "./types";
import type {
  CheckerBatchQuery,
  CheckerBatchResult,
  CheckerBatchScope,
  ResolvedCheckerBatchItem,
} from "./orchestrator_types";

const OBJECT_FLAGS_REFERENCE = 1 << 2;
const OBJECT_FLAGS_MAPPED = 1 << 5;

type CheckerBatchRoute = (response: CheckerBatchResponse) => void;

interface PositionBatchGroup {
  file: string;
  positions: number[];
  positionSet: Set<number>;
  routes: PositionBatchRoute[];
}

interface PositionBatchRoute {
  query: CheckerBatchQuery;
  queryIndex: number;
  positions: readonly number[];
  single: boolean;
}

interface SymbolTypeBatchGroup {
  symbols: string[];
  symbolSet: Set<string>;
  routes: SymbolTypeBatchRoute[];
}

interface SymbolTypeBatchRoute {
  query: CheckerBatchQuery;
  queryIndex: number;
  symbols: readonly string[];
  single: boolean;
}

interface CheckerBatchPlan {
  requests: CheckerBatchRequest[];
  resolve(responses: CheckerBatchResponse[]): ResolvedCheckerBatchItem[];
}

/**
 * Resolves common project-scoped checker lookups as one coalesced batch.
 *
 * Position queries are grouped per source file and symbol-type queries use
 * `getTypesOfSymbols`, so callers can express per-node facts without writing
 * their own N+1 loop.
 */
export function resolveCheckerBatch(
  client: CheckerBatchCapableClient,
  scope: CheckerBatchScope,
  queries: readonly CheckerBatchQuery[],
): ResolvedCheckerBatchItem[] {
  const plan = planCheckerBatch(scope, queries);
  if (plan.requests.length === 0) {
    return plan.resolve([]);
  }
  return plan.resolve(batchCheckerRequests(client, plan.requests));
}

/**
 * Async counterpart of {@link resolveCheckerBatch}.
 */
export async function resolveCheckerBatchAsync(
  client: AsyncCheckerBatchCapableClient,
  scope: CheckerBatchScope,
  queries: readonly CheckerBatchQuery[],
): Promise<ResolvedCheckerBatchItem[]> {
  const plan = planCheckerBatch(scope, queries);
  if (plan.requests.length === 0) {
    return plan.resolve([]);
  }
  return plan.resolve(await batchCheckerRequestsAsync(client, plan.requests));
}

export type * from "./orchestrator_types";

function planCheckerBatch(
  scope: CheckerBatchScope,
  queries: readonly CheckerBatchQuery[],
): CheckerBatchPlan {
  const results: Array<ResolvedCheckerBatchItem | undefined> = [];
  results.length = queries.length;
  const requests: CheckerBatchRequest[] = [];
  const requestRoutes: CheckerBatchRoute[][] = [];
  const directRequestIndexes = new Map<string, number>();
  const typePositionGroups = new Map<string, PositionBatchGroup>();
  const symbolPositionGroups = new Map<string, PositionBatchGroup>();
  const symbolTypeGroup: SymbolTypeBatchGroup = {
    symbols: [],
    symbolSet: new Set(),
    routes: [],
  };

  const addRequest = (request: CheckerBatchRequest, route: CheckerBatchRoute): void => {
    requests.push(request);
    requestRoutes.push([route]);
  };
  const addDirectRequest = (
    query: CheckerBatchQuery,
    queryIndex: number,
    method: string,
    params: Record<string, unknown>,
    transform: (result: unknown) => CheckerBatchResult = directBatchResult,
  ): void => {
    const compactParams = omitUndefinedProperties(params);
    const requestKey = `${method}\0${JSON.stringify(compactParams)}`;
    const route = (response: CheckerBatchResponse): void => {
      setResponseResult(results, queryIndex, query, response, transform);
    };
    const existingIndex = directRequestIndexes.get(requestKey);
    if (existingIndex !== undefined) {
      requestRoutes[existingIndex]?.push(route);
      return;
    }
    directRequestIndexes.set(requestKey, requests.length);
    addRequest({ method, params: compactParams }, route);
  };

  queries.forEach((query, queryIndex) => {
    switch (query.kind) {
      case "typeAtPosition":
        addPositionBatchQuery(
          typePositionGroups,
          query,
          queryIndex,
          query.file,
          [query.position],
          true,
        );
        break;
      case "typesAtPositions":
        if (query.positions.length === 0) {
          results[queryIndex] = { key: query.key, kind: query.kind, result: [] };
        } else {
          addPositionBatchQuery(
            typePositionGroups,
            query,
            queryIndex,
            query.file,
            query.positions,
            false,
          );
        }
        break;
      case "symbolAtPosition":
        addPositionBatchQuery(
          symbolPositionGroups,
          query,
          queryIndex,
          query.file,
          [query.position],
          true,
        );
        break;
      case "symbolsAtPositions":
        if (query.positions.length === 0) {
          results[queryIndex] = { key: query.key, kind: query.kind, result: [] };
        } else {
          addPositionBatchQuery(
            symbolPositionGroups,
            query,
            queryIndex,
            query.file,
            query.positions,
            false,
          );
        }
        break;
      case "typeOfSymbol":
        addSymbolTypeBatchQuery(symbolTypeGroup, query, queryIndex, [query.symbol], true);
        break;
      case "typesOfSymbols":
        if (query.symbols.length === 0) {
          results[queryIndex] = { key: query.key, kind: query.kind, result: [] };
        } else {
          addSymbolTypeBatchQuery(symbolTypeGroup, query, queryIndex, query.symbols, false);
        }
        break;
      case "symbolOfType":
        addDirectRequest(query, queryIndex, "getSymbolOfType", {
          snapshot: scope.snapshot,
          project: scope.project,
          type: query.type,
        });
        break;
      case "declaredTypeOfSymbol":
        addDirectRequest(query, queryIndex, "getDeclaredTypeOfSymbol", {
          snapshot: scope.snapshot,
          project: scope.project,
          symbol: query.symbol,
        });
        break;
      case "aliasedSymbol":
        addDirectRequest(query, queryIndex, "getAliasedSymbol", {
          snapshot: scope.snapshot,
          project: scope.project,
          symbol: query.symbol,
        });
        break;
      case "immediateAliasedSymbol":
        addDirectRequest(query, queryIndex, "getImmediateAliasedSymbol", {
          snapshot: scope.snapshot,
          project: scope.project,
          symbol: query.symbol,
        });
        break;
      case "exportsOfModule":
        addDirectRequest(
          query,
          queryIndex,
          "getExportsOfModule",
          {
            snapshot: scope.snapshot,
            project: scope.project,
            symbol: query.symbol,
          },
          arrayBatchResult,
        );
        break;
      case "propertyOfType":
        addDirectRequest(query, queryIndex, "getPropertyOfType", {
          snapshot: scope.snapshot,
          project: scope.project,
          type: query.type,
          name: query.name,
        });
        break;
      case "typeArguments":
        if (
          query.objectFlags !== undefined &&
          (query.objectFlags & (OBJECT_FLAGS_REFERENCE | OBJECT_FLAGS_MAPPED)) === 0
        ) {
          results[queryIndex] = { key: query.key, kind: query.kind, result: [] };
        } else {
          addDirectRequest(
            query,
            queryIndex,
            "getTypeArguments",
            {
              snapshot: scope.snapshot,
              project: scope.project,
              type: query.type,
            },
            arrayBatchResult,
          );
        }
        break;
      case "constraintOfType":
        addDirectRequest(query, queryIndex, "getConstraintOfType", {
          snapshot: scope.snapshot,
          project: scope.project,
          type: query.type,
        });
        break;
      case "isTypeAssignableTo":
        addDirectRequest(query, queryIndex, "isTypeAssignableTo", {
          snapshot: scope.snapshot,
          project: scope.project,
          source: query.source,
          target: query.target,
        });
        break;
      case "typeToString":
        addDirectRequest(query, queryIndex, "typeToString", {
          snapshot: scope.snapshot,
          project: scope.project,
          type: query.type,
          location: query.location,
          flags: query.flags,
        });
        break;
    }
  });

  flushPositionBatchGroups(
    scope,
    typePositionGroups,
    "getTypesAtPositions",
    requests,
    requestRoutes,
    results,
  );
  flushPositionBatchGroups(
    scope,
    symbolPositionGroups,
    "getSymbolsAtPositions",
    requests,
    requestRoutes,
    results,
  );
  flushSymbolTypeBatchGroup(scope, symbolTypeGroup, requests, requestRoutes, results);

  return {
    requests,
    resolve(responses) {
      for (const [index, response] of responses.entries()) {
        for (const route of requestRoutes[index] ?? []) {
          route(response);
        }
      }
      return queries.map((query, index) => {
        return (
          results[index] ?? {
            key: query.key,
            kind: query.kind,
            error: "checker batch query did not produce a result",
          }
        );
      });
    },
  };
}

function addPositionBatchQuery(
  groups: Map<string, PositionBatchGroup>,
  query: CheckerBatchQuery,
  queryIndex: number,
  file: string,
  positions: readonly number[],
  single: boolean,
): void {
  let group = groups.get(file);
  if (!group) {
    group = {
      file,
      positions: [],
      positionSet: new Set(),
      routes: [],
    };
    groups.set(file, group);
  }
  for (const position of positions) {
    if (!group.positionSet.has(position)) {
      group.positionSet.add(position);
      group.positions.push(position);
    }
  }
  group.routes.push({ query, queryIndex, positions, single });
}

function addSymbolTypeBatchQuery(
  group: SymbolTypeBatchGroup,
  query: CheckerBatchQuery,
  queryIndex: number,
  symbols: readonly string[],
  single: boolean,
): void {
  for (const symbol of symbols) {
    if (!group.symbolSet.has(symbol)) {
      group.symbolSet.add(symbol);
      group.symbols.push(symbol);
    }
  }
  group.routes.push({ query, queryIndex, symbols, single });
}

function flushPositionBatchGroups(
  scope: CheckerBatchScope,
  groups: Map<string, PositionBatchGroup>,
  method: "getTypesAtPositions" | "getSymbolsAtPositions",
  requests: CheckerBatchRequest[],
  requestRoutes: CheckerBatchRoute[][],
  results: Array<ResolvedCheckerBatchItem | undefined>,
): void {
  for (const group of groups.values()) {
    requests.push({
      method,
      params: {
        snapshot: scope.snapshot,
        project: scope.project,
        file: group.file,
        positions: group.positions,
      },
    });
    requestRoutes.push([
      (response) => {
        if (response.error) {
          for (const route of group.routes) {
            results[route.queryIndex] = {
              key: route.query.key,
              kind: route.query.kind,
              error: response.error,
            };
          }
          return;
        }
        if (!Array.isArray(response.result)) {
          const error = `${method} returned a non-array result`;
          for (const route of group.routes) {
            results[route.queryIndex] = {
              key: route.query.key,
              kind: route.query.kind,
              error,
            };
          }
          return;
        }
        const byPosition = new Map<number, unknown>();
        for (const [index, position] of group.positions.entries()) {
          byPosition.set(position, response.result[index] ?? null);
        }
        for (const route of group.routes) {
          const result = route.single
            ? (byPosition.get(route.positions[0] ?? -1) ?? null)
            : route.positions.map((position) => byPosition.get(position) ?? null);
          results[route.queryIndex] = {
            key: route.query.key,
            kind: route.query.kind,
            result: result as CheckerBatchResult,
          };
        }
      },
    ]);
  }
}

function flushSymbolTypeBatchGroup(
  scope: CheckerBatchScope,
  group: SymbolTypeBatchGroup,
  requests: CheckerBatchRequest[],
  requestRoutes: CheckerBatchRoute[][],
  results: Array<ResolvedCheckerBatchItem | undefined>,
): void {
  if (group.symbols.length === 0) {
    return;
  }
  requests.push({
    method: "getTypesOfSymbols",
    params: {
      snapshot: scope.snapshot,
      project: scope.project,
      symbols: group.symbols,
    },
  });
  requestRoutes.push([
    (response) => {
      if (response.error) {
        for (const route of group.routes) {
          results[route.queryIndex] = {
            key: route.query.key,
            kind: route.query.kind,
            error: response.error,
          };
        }
        return;
      }
      if (!Array.isArray(response.result)) {
        const error = "getTypesOfSymbols returned a non-array result";
        for (const route of group.routes) {
          results[route.queryIndex] = {
            key: route.query.key,
            kind: route.query.kind,
            error,
          };
        }
        return;
      }
      const bySymbol = new Map<string, unknown>();
      for (const [index, symbol] of group.symbols.entries()) {
        bySymbol.set(symbol, response.result[index] ?? null);
      }
      for (const route of group.routes) {
        const result = route.single
          ? (bySymbol.get(route.symbols[0] ?? "") ?? null)
          : route.symbols.map((symbol) => bySymbol.get(symbol) ?? null);
        results[route.queryIndex] = {
          key: route.query.key,
          kind: route.query.kind,
          result: result as CheckerBatchResult,
        };
      }
    },
  ]);
}

function setResponseResult(
  results: Array<ResolvedCheckerBatchItem | undefined>,
  queryIndex: number,
  query: CheckerBatchQuery,
  response: CheckerBatchResponse,
  transform: (result: unknown) => CheckerBatchResult,
): void {
  if (response.error) {
    results[queryIndex] = {
      key: query.key,
      kind: query.kind,
      error: response.error,
    };
    return;
  }
  results[queryIndex] = {
    key: query.key,
    kind: query.kind,
    result: transform(response.result),
  };
}

function directBatchResult(result: unknown): CheckerBatchResult {
  return (result ?? null) as CheckerBatchResult;
}

function arrayBatchResult(result: unknown): CheckerBatchResult {
  if (result === null || result === undefined) {
    return [];
  }
  return result as CheckerBatchResult;
}

function omitUndefinedProperties(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, unknown] => entry[1] !== undefined),
  );
}
