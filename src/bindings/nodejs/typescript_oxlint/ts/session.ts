import { readFileSync, statSync } from "node:fs";

import { type ProjectResponse, TsgoApiClient } from "@corsa-bind/napi";

import type { TsgoSignature, TsgoSymbol, TsgoType, TsgoTypePredicate } from "./types";
import type { ResolvedProjectConfig, ResolvedRuntimeOptions } from "./types";

type FileCache = {
  mtimeMs: number;
  lintSourceText?: string;
  sourceText?: string;
  projectId: string;
  typeByPosition: Map<number, TsgoType | undefined>;
  symbolByPosition: Map<number, TsgoSymbol | undefined>;
};

type PreparedFileState = {
  mtimeMs: number;
  lintSourceText?: string;
  sourceText?: string;
};

export class TsgoProjectSession {
  #client?: TsgoApiClient;
  #config?: { options: unknown; fileNames: string[] };
  #snapshot?: string;
  #projects: ProjectResponse[] = [];
  #files = new Map<string, FileCache>();
  #lastRefreshMs = 0;
  #supportsOverlayChanges?: boolean;

  constructor(
    readonly project: ResolvedProjectConfig,
    readonly runtime: ResolvedRuntimeOptions,
  ) {}

  close(): void {
    if (this.#snapshot) {
      this.#client?.releaseHandle(this.#snapshot);
      this.#snapshot = undefined;
    }
    this.#client?.close();
    this.#client = undefined;
    this.#supportsOverlayChanges = undefined;
    this.#files.clear();
  }

  getCompilerOptions(): unknown {
    return this.config().options;
  }

  getRootFileNames(): readonly string[] {
    return this.config().fileNames;
  }

  getTypeAtPosition(fileName: string, position: number, sourceText?: string): TsgoType | undefined {
    const state = this.fileState(fileName, sourceText);
    if (!state.typeByPosition.has(position)) {
      state.typeByPosition.set(
        position,
        this.client().getTypeAtPosition(this.#snapshot!, state.projectId, fileName, position) as
          | TsgoType
          | undefined,
      );
    }
    return state.typeByPosition.get(position);
  }

  getSymbolAtPosition(
    fileName: string,
    position: number,
    sourceText?: string,
  ): TsgoSymbol | undefined {
    const state = this.fileState(fileName, sourceText);
    if (!state.symbolByPosition.has(position)) {
      state.symbolByPosition.set(
        position,
        this.client().getSymbolAtPosition(this.#snapshot!, state.projectId, fileName, position) as
          | TsgoSymbol
          | undefined,
      );
    }
    return state.symbolByPosition.get(position);
  }

  getTypeOfSymbol(symbol: TsgoSymbol): TsgoType | undefined {
    return this.client().getTypeOfSymbol(this.#snapshot!, this.projectId(), symbol.id) as
      | TsgoType
      | undefined;
  }

  getDeclaredTypeOfSymbol(symbol: TsgoSymbol): TsgoType | undefined {
    return this.client().getDeclaredTypeOfSymbol(this.#snapshot!, this.projectId(), symbol.id) as
      | TsgoType
      | undefined;
  }

  typeToString(type: TsgoType, flags?: number): string {
    return this.client().typeToString(this.#snapshot!, this.projectId(), type.id, undefined, flags);
  }

  getBaseTypeOfLiteralType(type: TsgoType): TsgoType | undefined {
    return this.client().callJson("getBaseTypeOfLiteralType", {
      snapshot: this.#snapshot,
      project: this.projectId(),
      type: type.id,
    });
  }

  getPropertiesOfType(type: TsgoType): readonly TsgoSymbol[] {
    return (
      this.client().callJson("getPropertiesOfType", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
      }) ?? []
    );
  }

  getSignaturesOfType(type: TsgoType, kind: number): readonly TsgoSignature[] {
    return this.client().callJson("getSignaturesOfType", {
      snapshot: this.#snapshot,
      project: this.projectId(),
      type: type.id,
      kind,
    });
  }

  getReturnTypeOfSignature(signature: TsgoSignature): TsgoType | undefined {
    return this.client().callJson("getReturnTypeOfSignature", {
      snapshot: this.#snapshot,
      project: this.projectId(),
      signature: signature.id,
    });
  }

  getTypePredicateOfSignature(signature: TsgoSignature): TsgoTypePredicate | undefined {
    return this.client().callJson("getTypePredicateOfSignature", {
      snapshot: this.#snapshot,
      project: this.projectId(),
      signature: signature.id,
    });
  }

  getBaseTypes(type: TsgoType): readonly TsgoType[] {
    return (
      this.client().callJson("getBaseTypes", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
      }) ?? []
    );
  }

  getTypeArguments(type: TsgoType): readonly TsgoType[] {
    return this.client().getTypeArguments(
      this.#snapshot!,
      this.projectId(),
      type.id,
      type.objectFlags,
    ) as unknown as readonly TsgoType[];
  }

  private client(): TsgoApiClient {
    if (!this.#client) {
      this.#client = TsgoApiClient.spawn({
        executable: this.runtime.executable,
        cwd: this.runtime.cwd,
        mode: this.runtime.mode,
      });
      this.#client.initialize();
    }
    return this.#client;
  }

  private config(): { options: unknown; fileNames: string[] } {
    if (!this.#config) {
      this.#config = this.client().parseConfigFile(this.project.configPath);
    }
    const config = this.#config;
    if (!config) {
      throw new Error(`corsa-oxlint could not parse a tsgo config for ${this.project.configPath}`);
    }
    return config;
  }

  private fileState(fileName: string, sourceText?: string): FileCache {
    const prepared = this.refreshIfNeeded(fileName, sourceText);
    const current = this.#files.get(fileName);
    if (current) {
      return current;
    }
    const project = this.client().callJson<ProjectResponse | null>("getDefaultProjectForFile", {
      snapshot: this.#snapshot,
      file: fileName,
    });
    const state: FileCache = {
      mtimeMs: prepared.mtimeMs,
      lintSourceText: prepared.lintSourceText,
      sourceText: prepared.sourceText,
      projectId: project?.id ?? this.projectId(),
      typeByPosition: new Map(),
      symbolByPosition: new Map(),
    };
    this.#files.set(fileName, state);
    return state;
  }

  private refreshIfNeeded(fileName: string, sourceText?: string): PreparedFileState {
    const now = Date.now();
    const expired = now - this.#lastRefreshMs > this.runtime.cacheLifetimeMs;
    const cached = this.#files.get(fileName);
    const mtimeMs = statMtimeMs(fileName);
    const overlayText = this.supportedOverlayText(fileName, sourceText, mtimeMs, cached);
    const textChanged = overlayText !== cached?.sourceText;
    const prepared = {
      mtimeMs,
      lintSourceText: sourceText,
      sourceText: overlayText,
    };
    const stale = !this.#snapshot || mtimeMs !== cached?.mtimeMs || textChanged || expired;
    if (!stale) {
      return prepared;
    }
    const previous = this.#snapshot;
    const overlayChanges = this.overlayChanges(fileName, overlayText, cached);
    const response = this.client().updateSnapshot({
      ...(previous
        ? { fileChanges: { changed: [fileName] } }
        : { openProject: this.project.configPath }),
      ...(overlayChanges === undefined ? {} : { overlayChanges }),
    });
    this.#snapshot = response.snapshot;
    this.#projects = response.projects;
    this.#lastRefreshMs = now;
    this.#files.clear();
    if (previous && previous !== this.#snapshot) {
      this.client().releaseHandle(previous);
    }
    return prepared;
  }

  private projectId(): string {
    const id = this.#projects[0]?.id;
    if (!id) {
      throw new Error(`corsa-oxlint could not resolve a tsgo project for ${this.project.filename}`);
    }
    return id;
  }

  private supportedOverlayText(
    fileName: string,
    sourceText: string | undefined,
    mtimeMs: number,
    cached?: FileCache,
  ): string | undefined {
    if (sourceText === undefined || !this.supportsOverlayChanges()) {
      return undefined;
    }
    if (cached?.lintSourceText === sourceText && cached.mtimeMs === mtimeMs) {
      return cached.sourceText;
    }
    return overlayTextFor(fileName, sourceText);
  }

  private overlayChanges(
    fileName: string,
    overlayText: string | undefined,
    cached?: FileCache,
  ):
    | {
        upsert?: { document: string; text: string; languageId: string }[];
        delete?: string[];
      }
    | undefined {
    if (!this.supportsOverlayChanges()) {
      return undefined;
    }
    if (overlayText !== undefined) {
      return {
        upsert: [
          {
            document: fileName,
            text: overlayText,
            languageId: languageIdFor(fileName),
          },
        ],
      };
    }
    if (cached?.sourceText !== undefined) {
      return { delete: [fileName] };
    }
    return undefined;
  }

  private supportsOverlayChanges(): boolean {
    if (this.#supportsOverlayChanges !== undefined) {
      return this.#supportsOverlayChanges;
    }
    try {
      const capabilities = this.client().callJson<{
        overlay?: { updateSnapshotOverlayChanges?: boolean };
      }>("describeCapabilities");
      this.#supportsOverlayChanges = capabilities?.overlay?.updateSnapshotOverlayChanges === true;
    } catch {
      this.#supportsOverlayChanges = false;
    }
    return this.#supportsOverlayChanges;
  }
}

function overlayTextFor(fileName: string, sourceText?: string): string | undefined {
  if (sourceText === undefined) {
    return undefined;
  }
  try {
    return readFileSync(fileName, "utf8") === sourceText ? undefined : sourceText;
  } catch {
    return sourceText;
  }
}

function statMtimeMs(fileName: string): number {
  try {
    return statSync(fileName).mtimeMs;
  } catch {
    return 0;
  }
}

function languageIdFor(fileName: string): string {
  if (fileName.endsWith(".tsx")) {
    return "typescriptreact";
  }
  if (fileName.endsWith(".jsx")) {
    return "javascriptreact";
  }
  if (fileName.endsWith(".js")) {
    return "javascript";
  }
  return "typescript";
}
