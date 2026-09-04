import * as nativeModule from "../index.js";

import type {
  ApiClientOptions,
  CheckerBatchQuery,
  CheckerBatchRequest,
  CheckerBatchResponse,
  CheckerBatchResult,
  CheckerBatchScope,
  ConfigResponse,
  InitializeResponse,
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRuleMeta,
  ResolvedCheckerBatchItem,
  SymbolResponse,
  TypeResponse,
  TypeTextKind,
  UnsafeTypeFlowInput,
  UpdateSnapshotParams,
  UpdateSnapshotResponse,
  VirtualChange,
  VirtualDocumentState,
} from "./types";

const binding = (
  "default" in nativeModule ? nativeModule.default : nativeModule
) as typeof import("../index.js");

const OBJECT_FLAGS_REFERENCE = 1 << 2;
const OBJECT_FLAGS_MAPPED = 1 << 5;

type CorsaApiClientConstructor = {
  spawn(options: ApiClientOptions): CorsaApiClient;
  spawnAsync(options: ApiClientOptions): Promise<CorsaApiClient>;
};

export interface CorsaApiClient {
  initialize(): InitializeResponse;
  initializeAsync(): Promise<InitializeResponse>;
  parseConfigFile(file: string): ConfigResponse;
  parseConfigFileAsync(file: string): Promise<ConfigResponse>;
  updateSnapshot(params?: UpdateSnapshotParams): UpdateSnapshotResponse;
  updateSnapshotAsync(params?: UpdateSnapshotParams): Promise<UpdateSnapshotResponse>;
  getSourceFile(snapshot: string, project: string, file: string): Uint8Array | null;
  getSourceFileAsync(snapshot: string, project: string, file: string): Promise<Uint8Array | null>;
  getStringType(snapshot: string, project: string): TypeResponse;
  getStringTypeAsync(snapshot: string, project: string): Promise<TypeResponse>;
  getTypeAtPosition(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): TypeResponse | null;
  getTypeAtPositionAsync(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): Promise<TypeResponse | null>;
  getTypesAtPositions(
    snapshot: string,
    project: string,
    file: string,
    positions: number[],
  ): Array<TypeResponse | null>;
  getTypesAtPositionsAsync(
    snapshot: string,
    project: string,
    file: string,
    positions: number[],
  ): Promise<Array<TypeResponse | null>>;
  getTypeAtSourceRange(
    snapshot: string,
    project: string,
    file: string,
    start: number,
    end: number,
    sourceText: string,
    kind?: string,
  ): TypeResponse | null;
  getTypeAtSourceRangeAsync(
    snapshot: string,
    project: string,
    file: string,
    start: number,
    end: number,
    sourceText: string,
    kind?: string,
  ): Promise<TypeResponse | null>;
  getSymbolAtPosition(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): SymbolResponse | null;
  getSymbolAtPositionAsync(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): Promise<SymbolResponse | null>;
  getSymbolsAtPositions(
    snapshot: string,
    project: string,
    file: string,
    positions: number[],
  ): Array<SymbolResponse | null>;
  getSymbolsAtPositionsAsync(
    snapshot: string,
    project: string,
    file: string,
    positions: number[],
  ): Promise<Array<SymbolResponse | null>>;
  getAliasedSymbol(snapshot: string, project: string, symbol: string): SymbolResponse | null;
  getAliasedSymbolAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<SymbolResponse | null>;
  getImmediateAliasedSymbol(
    snapshot: string,
    project: string,
    symbol: string,
  ): SymbolResponse | null;
  getImmediateAliasedSymbolAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<SymbolResponse | null>;
  getExportsOfModule(snapshot: string, project: string, symbol: string): SymbolResponse[];
  getExportsOfModuleAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<SymbolResponse[]>;
  getSymbolOfType(snapshot: string, typeHandle: string, project?: string): SymbolResponse | null;
  getSymbolOfTypeAsync(
    snapshot: string,
    typeHandle: string,
    project?: string,
  ): Promise<SymbolResponse | null>;
  getTypeArguments(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags?: number,
  ): TypeResponse[];
  getTypeArgumentsAtSourceRange(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags: number | undefined | null,
    file: string,
    start: number,
    end: number,
    sourceText: string,
  ): TypeResponse[];
  getTypeArgumentsAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags?: number,
  ): Promise<TypeResponse[]>;
  getTypeArgumentsAtSourceRangeAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags: number | undefined | null,
    file: string,
    start: number,
    end: number,
    sourceText: string,
  ): Promise<TypeResponse[]>;
  getPropertyOfType(
    snapshot: string,
    project: string,
    typeHandle: string,
    name: string,
  ): SymbolResponse | null;
  getPropertyOfTypeAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
    name: string,
  ): Promise<SymbolResponse | null>;
  isTypeAssignableTo(snapshot: string, project: string, source: string, target: string): boolean;
  isTypeAssignableToAsync(
    snapshot: string,
    project: string,
    source: string,
    target: string,
  ): Promise<boolean>;
  getConstraintOfType(snapshot: string, project: string, typeHandle: string): TypeResponse | null;
  getConstraintOfTypeAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
  ): Promise<TypeResponse | null>;
  getTypeOfSymbol(snapshot: string, project: string, symbol: string): TypeResponse | null;
  getTypeOfSymbolAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<TypeResponse | null>;
  getDeclaredTypeOfSymbol(snapshot: string, project: string, symbol: string): TypeResponse | null;
  getDeclaredTypeOfSymbolAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<TypeResponse | null>;
  typeToString(
    snapshot: string,
    project: string,
    typeHandle: string,
    location?: string,
    flags?: number,
  ): string;
  typeToStringAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
    location?: string,
    flags?: number,
  ): Promise<string>;
  callJson<T>(method: string, params?: unknown): T;
  callJsonAsync<T>(method: string, params?: unknown): Promise<T>;
  callBinary(method: string, params?: unknown): Uint8Array | null;
  callBinaryAsync(method: string, params?: unknown): Promise<Uint8Array | null>;
  releaseHandle(handle: string): void;
  releaseHandleAsync(handle: string): Promise<void>;
  close(): void;
  closeAsync(): Promise<void>;
}

type CorsaDistributedOrchestratorConstructor = {
  new (nodeIds: string[]): CorsaDistributedOrchestrator;
};

export interface CorsaDistributedOrchestrator {
  campaign(nodeId: string): number;
  leaderId(): string | null;
  state<T>(): T | null;
  nodeState<T>(nodeId: string): T | null;
  document(nodeId: string, uri: string): VirtualDocumentState | null;
  openVirtualDocument(document: VirtualDocumentState): VirtualDocumentState;
  changeVirtualDocument(uri: string, changes: VirtualChange[]): VirtualDocumentState;
  closeVirtualDocument(uri: string): void;
}

type CorsaVirtualDocumentConstructor = {
  untitled(path: string, languageId: string, text: string): CorsaVirtualDocument;
  inMemory(authority: string, path: string, languageId: string, text: string): CorsaVirtualDocument;
};

export interface CorsaVirtualDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
  state(): VirtualDocumentState;
  replace(text: string): void;
  applyChanges(changes: VirtualChange[]): unknown[];
}

export const CorsaApiClient = binding.CorsaApiClient as unknown as CorsaApiClientConstructor;
export const CorsaDistributedOrchestrator =
  binding.CorsaDistributedOrchestrator as unknown as CorsaDistributedOrchestratorConstructor;
export const CorsaVirtualDocument =
  binding.CorsaVirtualDocument as unknown as CorsaVirtualDocumentConstructor;

export const version = binding.version as () => string;
export const spawnCorsaApiClientAsync = binding.spawnCorsaApiClientAsync as (
  options: ApiClientOptions,
) => Promise<CorsaApiClient>;
export const isUnsafeAssignment = binding.isUnsafeAssignment as (
  input: UnsafeTypeFlowInput,
) => boolean;
export const isUnsafeReturn = binding.isUnsafeReturn as (input: UnsafeTypeFlowInput) => boolean;
export const runNativeLintRule = binding.runNativeLintRule as (
  ruleName: string,
  node: NativeLintNode,
) => NativeLintDiagnostic[];
export const nativeLintRuleMetas = binding.nativeLintRuleMetas as () => NativeLintRuleMeta[];
export const classifyTypeText = binding.classifyTypeText as (text?: string) => TypeTextKind;
export const splitTopLevelTypeText = binding.splitTopLevelTypeText as (
  text: string,
  delimiter: string,
) => string[];
export const splitTypeText = binding.splitTypeText as (text: string) => string[];
export const isStringLikeTypeTexts = binding.isStringLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isNumberLikeTypeTexts = binding.isNumberLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isBigIntLikeTypeTexts = binding.isBigIntLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isAnyLikeTypeTexts = binding.isAnyLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isUnknownLikeTypeTexts = binding.isUnknownLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isArrayLikeTypeTexts = binding.isArrayLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isStringArrayLikeTypeTexts = binding.isStringArrayLikeTypeTexts as (
  typeTexts: readonly string[],
) => boolean;
export const isPromiseLikeTypeTexts = binding.isPromiseLikeTypeTexts as (
  typeTexts: readonly string[],
  propertyNames?: readonly string[],
) => boolean;
export const isErrorLikeTypeTexts = binding.isErrorLikeTypeTexts as (
  typeTexts: readonly string[],
  propertyNames?: readonly string[],
) => boolean;

export type CheckerBatchCapableClient = Pick<CorsaApiClient, "callJson">;
export type AsyncCheckerBatchCapableClient = Pick<CorsaApiClient, "callJsonAsync">;
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
 * Sends multiple raw checker endpoint calls through upstream `batchRequests`.
 *
 * This keeps the original typed primitives available while giving hot paths a
 * single transport round trip for relation-heavy workflows.
 */
export function batchCheckerRequests(
  client: CheckerBatchCapableClient,
  requests: readonly CheckerBatchRequest[],
): CheckerBatchResponse[] {
  if (requests.length === 0) {
    return [];
  }
  const response = client.callJson<{ responses: unknown }>("batchRequests", {
    requests: requests.map(normalizeCheckerBatchRequest),
  });
  return normalizeCheckerBatchResponses(response, requests.length);
}

/**
 * Async counterpart of {@link batchCheckerRequests}.
 */
export async function batchCheckerRequestsAsync(
  client: AsyncCheckerBatchCapableClient,
  requests: readonly CheckerBatchRequest[],
): Promise<CheckerBatchResponse[]> {
  if (requests.length === 0) {
    return [];
  }
  const response = await client.callJsonAsync<{ responses: unknown }>("batchRequests", {
    requests: requests.map(normalizeCheckerBatchRequest),
  });
  return normalizeCheckerBatchResponses(response, requests.length);
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

export const Utils = Object.freeze({
  classifyTypeText,
  splitTopLevelTypeText,
  splitTypeText,
  isStringLikeTypeTexts,
  isNumberLikeTypeTexts,
  isBigIntLikeTypeTexts,
  isAnyLikeTypeTexts,
  isUnknownLikeTypeTexts,
  isArrayLikeTypeTexts,
  isStringArrayLikeTypeTexts,
  isPromiseLikeTypeTexts,
  isErrorLikeTypeTexts,
});

export default binding;
export type * from "./types";

function normalizeCheckerBatchRequest(request: CheckerBatchRequest): CheckerBatchRequest {
  if (request.params === undefined) {
    return { method: request.method };
  }
  return { method: request.method, params: request.params };
}

function normalizeCheckerBatchResponses(
  response: { responses?: unknown },
  expectedLength: number,
): CheckerBatchResponse[] {
  if (typeof response !== "object" || response === null) {
    throw new Error("batchRequests returned a malformed response");
  }
  const responses = response.responses;
  if (!Array.isArray(responses)) {
    throw new Error("batchRequests returned a malformed response list");
  }
  if (responses.length !== expectedLength) {
    throw new Error(
      `batchRequests returned ${responses.length} responses for ${expectedLength} requests`,
    );
  }
  return responses.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`batchRequests response ${index} is not an object`);
    }
    const record = item as Record<string, unknown>;
    const method = typeof record.method === "string" ? record.method : "";
    const normalized: CheckerBatchResponse = { method };
    if (typeof record.error === "string" && record.error.length > 0) {
      normalized.error = record.error;
    }
    if ("result" in record) {
      normalized.result = record.result;
    }
    return normalized;
  });
}

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
