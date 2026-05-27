import { CorsaApiClientBase } from "./api_client_base";
import { binding } from "./binding";
import { fromJson, toJson } from "./json";

import type { NativeApiClient } from "./binding";
import type { ApiClientOptions, SymbolResponse, TypeResponse } from "./types";

/** High-level JavaScript wrapper over the native Corsa stdio API client. */
export class CorsaApiClient extends CorsaApiClientBase {
  private constructor(inner: NativeApiClient) {
    super(inner);
  }

  /** Spawns a Corsa API process and returns a synchronous wrapper. */
  static spawn(options: ApiClientOptions): CorsaApiClient {
    return new CorsaApiClient(binding.CorsaApiClient.spawn(toJson(options)));
  }

  /** Spawns a Corsa API process without blocking the JavaScript thread. */
  static async spawnAsync(options: ApiClientOptions): Promise<CorsaApiClient> {
    return new CorsaApiClient(await binding.spawnCorsaApiClientAsync(toJson(options)));
  }

  /** Returns the built-in string type for a project snapshot. */
  getStringType(snapshot: string, project: string): TypeResponse {
    return fromJson(this.inner.getStringTypeJson(snapshot, project));
  }

  /** Returns the built-in string type asynchronously. */
  async getStringTypeAsync(snapshot: string, project: string): Promise<TypeResponse> {
    return fromJson(await this.inner.getStringTypeJsonAsync(snapshot, project));
  }

  /** Returns type information for the source position, if Corsa can resolve it. */
  getTypeAtPosition(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): TypeResponse | undefined {
    return (
      fromJson<TypeResponse | null>(
        this.inner.getTypeAtPositionJson(snapshot, project, file, position),
      ) ?? undefined
    );
  }

  /** Returns type information for the source position asynchronously. */
  async getTypeAtPositionAsync(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): Promise<TypeResponse | undefined> {
    return (
      fromJson<TypeResponse | null>(
        await this.inner.getTypeAtPositionJsonAsync(snapshot, project, file, position),
      ) ?? undefined
    );
  }

  /** Returns symbol information for the source position, if one exists. */
  getSymbolAtPosition(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): SymbolResponse | undefined {
    return (
      fromJson<SymbolResponse | null>(
        this.inner.getSymbolAtPositionJson(snapshot, project, file, position),
      ) ?? undefined
    );
  }

  /** Returns symbol information for the source position asynchronously. */
  async getSymbolAtPositionAsync(
    snapshot: string,
    project: string,
    file: string,
    position: number,
  ): Promise<SymbolResponse | undefined> {
    return (
      fromJson<SymbolResponse | null>(
        await this.inner.getSymbolAtPositionJsonAsync(snapshot, project, file, position),
      ) ?? undefined
    );
  }

  /** Returns type arguments for a generic object or alias type handle. */
  getTypeArguments(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags?: number,
  ): TypeResponse[] {
    return fromJson(this.inner.getTypeArgumentsJson(snapshot, project, typeHandle, objectFlags));
  }

  /** Returns type arguments asynchronously. */
  async getTypeArgumentsAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
    objectFlags?: number,
  ): Promise<TypeResponse[]> {
    return fromJson(
      await this.inner.getTypeArgumentsJsonAsync(snapshot, project, typeHandle, objectFlags),
    );
  }

  /** Returns the apparent type of a symbol handle, if Corsa can resolve it. */
  getTypeOfSymbol(snapshot: string, project: string, symbol: string): TypeResponse | undefined {
    return (
      fromJson<TypeResponse | null>(this.inner.getTypeOfSymbolJson(snapshot, project, symbol)) ??
      undefined
    );
  }

  /** Returns the apparent type of a symbol handle asynchronously. */
  async getTypeOfSymbolAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<TypeResponse | undefined> {
    return (
      fromJson<TypeResponse | null>(
        await this.inner.getTypeOfSymbolJsonAsync(snapshot, project, symbol),
      ) ?? undefined
    );
  }

  /** Returns the declared type of a symbol handle, if Corsa can resolve it. */
  getDeclaredTypeOfSymbol(
    snapshot: string,
    project: string,
    symbol: string,
  ): TypeResponse | undefined {
    return (
      fromJson<TypeResponse | null>(
        this.inner.getDeclaredTypeOfSymbolJson(snapshot, project, symbol),
      ) ?? undefined
    );
  }

  /** Returns the declared type of a symbol handle asynchronously. */
  async getDeclaredTypeOfSymbolAsync(
    snapshot: string,
    project: string,
    symbol: string,
  ): Promise<TypeResponse | undefined> {
    return (
      fromJson<TypeResponse | null>(
        await this.inner.getDeclaredTypeOfSymbolJsonAsync(snapshot, project, symbol),
      ) ?? undefined
    );
  }

  /** Formats a native type handle as TypeScript source text. */
  typeToString(
    snapshot: string,
    project: string,
    typeHandle: string,
    location?: string,
    flags?: number,
  ): string {
    return this.inner.typeToString(snapshot, project, typeHandle, location, flags);
  }

  /** Formats a native type handle as TypeScript source text asynchronously. */
  async typeToStringAsync(
    snapshot: string,
    project: string,
    typeHandle: string,
    location?: string,
    flags?: number,
  ): Promise<string> {
    return this.inner.typeToStringAsync(snapshot, project, typeHandle, location, flags);
  }
}
