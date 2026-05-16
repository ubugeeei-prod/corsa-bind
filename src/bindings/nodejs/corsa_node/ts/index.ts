import * as nativeModule from "../index.js";

import type {
  ApiClientOptions,
  ConfigResponse,
  InitializeResponse,
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRuleMeta,
  SymbolResponse,
  TypeTextKind,
  TypeResponse,
  UnsafeTypeFlowInput,
  UpdateSnapshotParams,
  UpdateSnapshotResponse,
  VirtualChange,
  VirtualDocumentState,
} from "./types";

const binding = (
  "default" in nativeModule ? nativeModule.default : nativeModule
) as typeof import("../index.js");

type NativeApiClient = InstanceType<typeof binding.TsgoApiClient>;
type NativeDistributedOrchestrator = InstanceType<typeof binding.TsgoDistributedOrchestrator>;
type NativeVirtualDocument = InstanceType<typeof binding.TsgoVirtualDocument>;

function fromJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function isUnsafeAssignment(input: UnsafeTypeFlowInput): boolean {
  return binding.isUnsafeAssignment(toJson(input));
}

export function isUnsafeReturn(input: UnsafeTypeFlowInput): boolean {
  return binding.isUnsafeReturn(toJson(input));
}

export function runNativeLintRule(ruleName: string, node: NativeLintNode): NativeLintDiagnostic[] {
  return fromJson(binding.runNativeLintRule(ruleName, toJson(node)));
}

export function nativeLintRuleMetas(): NativeLintRuleMeta[] {
  return fromJson(binding.nativeLintRuleMetasJson());
}

export function classifyTypeText(text?: string): TypeTextKind {
  return binding.classifyTypeText(text) as TypeTextKind;
}

export function splitTopLevelTypeText(text: string, delimiter: string): string[] {
  return binding.splitTopLevelTypeText(text, delimiter);
}

export function splitTypeText(text: string): string[] {
  return binding.splitTypeText(text);
}

export function isStringLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isStringLikeTypeTexts([...typeTexts]);
}

export function isNumberLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isNumberLikeTypeTexts([...typeTexts]);
}

export function isBigIntLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isBigIntLikeTypeTexts([...typeTexts]);
}

export function isAnyLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isAnyLikeTypeTexts([...typeTexts]);
}

export function isUnknownLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isUnknownLikeTypeTexts([...typeTexts]);
}

export function isArrayLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isArrayLikeTypeTexts([...typeTexts]);
}

export function isStringArrayLikeTypeTexts(typeTexts: readonly string[]): boolean {
  return binding.isStringArrayLikeTypeTexts([...typeTexts]);
}

export function isPromiseLikeTypeTexts(
  typeTexts: readonly string[],
  propertyNames: readonly string[] = [],
): boolean {
  return binding.isPromiseLikeTypeTexts([...typeTexts], [...propertyNames]);
}

export function isErrorLikeTypeTexts(
  typeTexts: readonly string[],
  propertyNames: readonly string[] = [],
): boolean {
  return binding.isErrorLikeTypeTexts([...typeTexts], [...propertyNames]);
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

export class CorsaApiClient {
  readonly #inner: NativeApiClient;

  private constructor(inner: NativeApiClient) {
    this.#inner = inner;
  }

  static spawn(options: ApiClientOptions): CorsaApiClient {
    return new CorsaApiClient(binding.TsgoApiClient.spawn(toJson(options)));
  }

  initialize(): InitializeResponse {
    return fromJson(this.#inner.initializeJson());
  }

  parseConfigFile(file: string): ConfigResponse {
    return fromJson(this.#inner.parseConfigFileJson(file));
  }

  updateSnapshot(params?: UpdateSnapshotParams): UpdateSnapshotResponse {
    return fromJson(this.#inner.updateSnapshotJson(params ? toJson(params) : undefined));
  }

  getSourceFile(snapshot: string, project: string, file: string): Uint8Array | null {
    return this.#inner.getSourceFile(snapshot, project, file) ?? null;
  }

  getStringType(snapshot: string, project: string): TypeResponse {
    return fromJson(this.#inner.getStringTypeJson(snapshot, project));
  }

  getTypeAtPosition(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): TypeResponse | undefined {
    return (
      fromJson<TypeResponse | null>(
        this.#inner.getTypeAtPositionJson(snapshot, project, file, position),
      ) ?? undefined
    );
  }

  getSymbolAtPosition(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): SymbolResponse | undefined {
    return (
      fromJson<SymbolResponse | null>(
        this.#inner.getSymbolAtPositionJson(snapshot, project, file, position),
      ) ?? undefined
    );
  }

  getTypeArguments(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags?: number,
  ): TypeResponse[] {
    return fromJson(this.#inner.getTypeArgumentsJson(snapshot, project, typeHandle, objectFlags));
  }

  getTypeOfSymbol(snapshot: string, project: string, symbol: string): TypeResponse | undefined {
    return (
      fromJson<TypeResponse | null>(this.#inner.getTypeOfSymbolJson(snapshot, project, symbol)) ??
      undefined
    );
  }

  getDeclaredTypeOfSymbol(
    snapshot: string,
    project: string,
    symbol: string,
  ): TypeResponse | undefined {
    return (
      fromJson<TypeResponse | null>(
        this.#inner.getDeclaredTypeOfSymbolJson(snapshot, project, symbol),
      ) ?? undefined
    );
  }

  typeToString(
    snapshot: string,
    project: string,
    typeHandle: string,
    location?: string,
    flags?: number,
  ): string {
    return this.#inner.typeToString(snapshot, project, typeHandle, location, flags);
  }

  callJson<T>(method: string, params?: unknown): T {
    return fromJson(this.#inner.callJson(method, params ? toJson(params) : undefined));
  }

  callBinary(method: string, params?: unknown): Uint8Array | null {
    return this.#inner.callBinary(method, params ? toJson(params) : undefined) ?? null;
  }

  releaseHandle(handle: string): void {
    this.#inner.releaseHandle(handle);
  }

  close(): void {
    this.#inner.close();
  }
}

export class CorsaVirtualDocument {
  readonly #inner: NativeVirtualDocument;

  private constructor(inner: NativeVirtualDocument) {
    this.#inner = inner;
  }

  static untitled(path: string, languageId: string, text: string): CorsaVirtualDocument {
    return new CorsaVirtualDocument(binding.TsgoVirtualDocument.untitled(path, languageId, text));
  }

  static inMemory(
    authority: string,
    path: string,
    languageId: string,
    text: string,
  ): CorsaVirtualDocument {
    return new CorsaVirtualDocument(
      binding.TsgoVirtualDocument.inMemory(authority, path, languageId, text),
    );
  }

  get uri(): string {
    return this.#inner.uri;
  }

  get languageId(): string {
    return this.#inner.languageId;
  }

  get version(): number {
    return this.#inner.version;
  }

  get text(): string {
    return this.#inner.text;
  }

  state(): VirtualDocumentState {
    return fromJson(this.#inner.stateJson());
  }

  replace(text: string): void {
    this.#inner.replace(text);
  }

  applyChanges(changes: VirtualChange[]): unknown[] {
    return fromJson(this.#inner.applyChangesJson(toJson(changes)));
  }
}

export class CorsaDistributedOrchestrator {
  readonly #inner: NativeDistributedOrchestrator;

  constructor(nodeIds: string[]) {
    this.#inner = new binding.TsgoDistributedOrchestrator(nodeIds);
  }

  campaign(nodeId: string): number {
    return this.#inner.campaign(nodeId);
  }

  leaderId(): string | undefined {
    return this.#inner.leaderId() ?? undefined;
  }

  state<T>(): T | undefined {
    const value = this.#inner.stateJson();
    return value ? fromJson<T>(value) : undefined;
  }

  nodeState<T>(nodeId: string): T | undefined {
    const value = this.#inner.nodeStateJson(nodeId);
    return value ? fromJson<T>(value) : undefined;
  }

  document(nodeId: string, uri: string): VirtualDocumentState | undefined {
    const value = this.#inner.documentJson(nodeId, uri);
    return value ? fromJson<VirtualDocumentState>(value) : undefined;
  }

  openVirtualDocument(document: VirtualDocumentState): VirtualDocumentState {
    return fromJson(this.#inner.openVirtualDocumentJson(this.requireLeader(), toJson(document)));
  }

  changeVirtualDocument(uri: string, changes: VirtualChange[]): VirtualDocumentState {
    return fromJson(
      this.#inner.changeVirtualDocumentJson(this.requireLeader(), uri, toJson(changes)),
    );
  }

  closeVirtualDocument(uri: string): void {
    this.#inner.closeVirtualDocument(this.requireLeader(), uri);
  }

  private requireLeader(): string {
    const leaderId = this.leaderId();
    if (!leaderId) {
      throw new Error("raft leader has not been elected");
    }
    return leaderId;
  }
}

export {
  CorsaApiClient as TsgoApiClient,
  CorsaDistributedOrchestrator as TsgoDistributedOrchestrator,
  CorsaVirtualDocument as TsgoVirtualDocument,
};

export default binding;
export const version = binding.version;
export type * from "./types";
