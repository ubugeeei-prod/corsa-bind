import * as nativeModule from "../index.js";

import type {
  ApiClientOptions,
  ConfigResponse,
  InitializeResponse,
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
