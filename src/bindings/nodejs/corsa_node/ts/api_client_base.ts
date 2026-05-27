import { fromJson, toJson } from "./json";

import type { NativeApiClient } from "./binding";
import type {
  ConfigResponse,
  InitializeResponse,
  UpdateSnapshotParams,
  UpdateSnapshotResponse,
} from "./types";

/** Shared lifecycle and transport operations for the public Corsa API client. */
export abstract class CorsaApiClientBase {
  protected readonly inner: NativeApiClient;

  /** Wraps a native client handle. Construction is restricted to subclasses. */
  protected constructor(inner: NativeApiClient) {
    this.inner = inner;
  }

  /** Performs the synchronous Corsa API initialize handshake. */
  initialize(): InitializeResponse {
    return fromJson(this.inner.initializeJson());
  }

  /** Performs the asynchronous Corsa API initialize handshake. */
  async initializeAsync(): Promise<InitializeResponse> {
    return fromJson(await this.inner.initializeJsonAsync());
  }

  /** Parses a Corsa config file and returns the native config response. */
  parseConfigFile(file: string): ConfigResponse {
    return fromJson(this.inner.parseConfigFileJson(file));
  }

  /** Parses a Corsa config file without blocking the JavaScript thread. */
  async parseConfigFileAsync(file: string): Promise<ConfigResponse> {
    return fromJson(await this.inner.parseConfigFileJsonAsync(file));
  }

  /** Updates the upstream Corsa project snapshot with optional changed files. */
  updateSnapshot(params?: UpdateSnapshotParams): UpdateSnapshotResponse {
    return fromJson(this.inner.updateSnapshotJson(params ? toJson(params) : undefined));
  }

  /** Updates the upstream Corsa project snapshot asynchronously. */
  async updateSnapshotAsync(params?: UpdateSnapshotParams): Promise<UpdateSnapshotResponse> {
    return fromJson(await this.inner.updateSnapshotJsonAsync(params ? toJson(params) : undefined));
  }

  /** Reads a source file from a snapshot as bytes, or `null` if it is unavailable. */
  getSourceFile(snapshot: string, project: string, file: string): Uint8Array | null {
    return this.inner.getSourceFile(snapshot, project, file) ?? null;
  }

  /** Reads a source file from a snapshot asynchronously. */
  async getSourceFileAsync(
    snapshot: string,
    project: string,
    file: string,
  ): Promise<Uint8Array | null> {
    return (await this.inner.getSourceFileAsync(snapshot, project, file)) ?? null;
  }

  /** Calls an arbitrary JSON-RPC method and parses the JSON response. */
  callJson<T>(method: string, params?: unknown): T {
    return fromJson(this.inner.callJson(method, params ? toJson(params) : undefined));
  }

  /** Calls an arbitrary JSON-RPC method asynchronously and parses the response. */
  async callJsonAsync<T>(method: string, params?: unknown): Promise<T> {
    return fromJson(await this.inner.callJsonAsync(method, params ? toJson(params) : undefined));
  }

  /** Calls a binary endpoint and returns raw bytes, or `null` for empty responses. */
  callBinary(method: string, params?: unknown): Uint8Array | null {
    return this.inner.callBinary(method, params ? toJson(params) : undefined) ?? null;
  }

  /** Calls a binary endpoint asynchronously. */
  async callBinaryAsync(method: string, params?: unknown): Promise<Uint8Array | null> {
    return (await this.inner.callBinaryAsync(method, params ? toJson(params) : undefined)) ?? null;
  }

  /** Releases a native type, symbol, or snapshot handle when callers are done with it. */
  releaseHandle(handle: string): void {
    this.inner.releaseHandle(handle);
  }

  /** Releases a native handle asynchronously. */
  async releaseHandleAsync(handle: string): Promise<void> {
    await this.inner.releaseHandleAsync(handle);
  }

  /** Closes the underlying Corsa process and transport. */
  close(): void {
    this.inner.close();
  }

  /** Closes the underlying Corsa process asynchronously. */
  async closeAsync(): Promise<void> {
    await this.inner.closeAsync();
  }
}
