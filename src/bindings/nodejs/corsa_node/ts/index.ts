import * as nativeModule from "../index.js";

import {
  resolveCheckerBatch as resolveCheckerBatchFromOrchestrator,
  resolveCheckerBatchAsync as resolveCheckerBatchAsyncFromOrchestrator,
} from "./orchestrator";
import type { AsyncCheckerBatchCapableClient, CheckerBatchCapableClient } from "./checker_batch";
import type {
  CheckerBatchQuery,
  CheckerBatchScope,
  ResolvedCheckerBatchItem,
} from "./orchestrator_types";
import type {
  ApiClientOptions,
  ConfigResponse,
  ContentMapperDefinition,
  EncodedSourceFile,
  InitializeResponse,
  MappedPosition,
  MappedRange,
  SpanMapSegment,
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRuleMeta,
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
  getEncodedSourceFile(snapshot: string, project: string, file: string): EncodedSourceFile | null;
  getEncodedSourceFileAsync(
    snapshot: string,
    project: string,
    file: string,
  ): Promise<EncodedSourceFile | null>;
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
export const CorsaVirtualDocument =
  binding.CorsaVirtualDocument as unknown as CorsaVirtualDocumentConstructor;

/**
 * Bidirectional mapping between a mapper's virtual text and the original file.
 *
 * Every query takes an optional `feature` bitmask (see {@link SpanMap}); when it
 * is omitted, all features are considered.
 */
export interface CorsaSpanMap {
  readonly segments: SpanMapSegment[];
  readonly segmentCount: number;
  virtualToOriginalPosition(position: number, feature?: number): MappedPosition;
  virtualToOriginalSpan(pos: number, end: number, feature?: number): MappedRange;
  originalToVirtualPositions(position: number, feature?: number): MappedPosition[];
  originalToVirtualSpans(pos: number, end: number, feature?: number): MappedRange[];
}

type CorsaSpanMapConstructor = {
  fromSegments(segments: readonly SpanMapSegment[]): CorsaSpanMap;
};

export const CorsaSpanMap = binding.CorsaSpanMap as unknown as CorsaSpanMapConstructor;

/** Decodes the source-file fields of a `getSourceFile` payload. */
export const decodeSourceFile = binding.decodeSourceFile as (
  payload: Uint8Array,
) => EncodedSourceFile;

/** Reports whether a `getSourceFile` payload came out of a content mapper. */
export const isContentMappedSourceFile = binding.isContentMappedSourceFile as (
  payload: Uint8Array,
) => boolean;

/** Builds the span map of a payload, or `null` when the file is not mapped. */
export const spanMapForSourceFile = binding.spanMapForSourceFile as (
  payload: Uint8Array,
) => CorsaSpanMap | null;

/** Reads the content mappers a parsed `tsconfig` declares. */
export const contentMappersFromConfig = binding.contentMappersFromConfig as (
  config: unknown,
) => ContentMapperDefinition[];

/**
 * Numeric enums mirrored from upstream `spanMapKind`, `spanMapFidelity`, and
 * `spanMapFeature`.
 */
export const SpanMap = Object.freeze({
  Kind: Object.freeze({ Verbatim: 0, Atom: 1, Alias: 2 }),
  Fidelity: Object.freeze({ Exact: 0, Atom: 1, Approximate: 2, None: 3 }),
  Feature: Object.freeze({
    Hover: 1 << 0,
    SignatureHelp: 1 << 1,
    Completion: 1 << 2,
    Definition: 1 << 3,
    TypeDefinition: 1 << 4,
    Implementation: 1 << 5,
    References: 1 << 6,
    DocumentHighlights: 1 << 7,
    Rename: 1 << 8,
    CallHierarchy: 1 << 9,
    CodeActions: 1 << 10,
    Formatting: 1 << 11,
    InlayHints: 1 << 12,
    SemanticTokens: 1 << 13,
    FoldingRanges: 1 << 14,
    SelectionRanges: 1 << 15,
    LinkedEditing: 1 << 16,
    AutoInsert: 1 << 17,
    DocumentSymbols: 1 << 18,
    CodeLens: 1 << 19,
    None: 0,
    All: (1 << 20) - 1,
  }),
} as const);

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

let rootCheckerBatchResolverWarningShown = false;

/**
 * @deprecated Import from `@corsa-bind/napi/orchestrator` instead. The root
 * export remains as a compatibility shim and warns once at runtime.
 */
export function resolveCheckerBatch(
  client: CheckerBatchCapableClient,
  scope: CheckerBatchScope,
  queries: readonly CheckerBatchQuery[],
): ResolvedCheckerBatchItem[] {
  warnRootCheckerBatchResolver();
  return resolveCheckerBatchFromOrchestrator(client, scope, queries);
}

/**
 * @deprecated Import from `@corsa-bind/napi/orchestrator` instead. The root
 * export remains as a compatibility shim and warns once at runtime.
 */
export async function resolveCheckerBatchAsync(
  client: AsyncCheckerBatchCapableClient,
  scope: CheckerBatchScope,
  queries: readonly CheckerBatchQuery[],
): Promise<ResolvedCheckerBatchItem[]> {
  warnRootCheckerBatchResolver();
  return resolveCheckerBatchAsyncFromOrchestrator(client, scope, queries);
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
export { batchCheckerRequests, batchCheckerRequestsAsync } from "./checker_batch";
export type { AsyncCheckerBatchCapableClient, CheckerBatchCapableClient } from "./checker_batch";
export type {
  CheckerBatchQuery,
  CheckerBatchResult,
  CheckerBatchScope,
  ResolvedCheckerBatchItem,
} from "./orchestrator_types";
export type * from "./types";

function warnRootCheckerBatchResolver(): void {
  if (rootCheckerBatchResolverWarningShown) {
    return;
  }
  rootCheckerBatchResolverWarningShown = true;
  console.warn(
    "@corsa-bind/napi: resolveCheckerBatch is a compatibility shim; import from @corsa-bind/napi/orchestrator for new code.",
  );
}
