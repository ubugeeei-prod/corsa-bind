import { readFileSync, statSync } from "node:fs";

import { type ProjectResponse, TsgoApiClient } from "@corsa-bind/napi";

import type { TsgoNode, TsgoSignature, TsgoSymbol, TsgoType, TsgoTypePredicate } from "./types";
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

type SourceSlice = {
  node: TsgoNode;
  text: string;
};

type TypeLookup = {
  fileName: string;
  position: number;
  sourceText?: string;
};

type ParameterInfo = {
  name: string;
  node: TsgoNode;
};

type TypeArgumentInfo = {
  pos: number;
};

const typeFlags = {
  object: 1 << 20,
  index: 1 << 21,
  templateLiteral: 1 << 22,
  stringMapping: 1 << 23,
  substitution: 1 << 24,
  indexedAccess: 1 << 25,
  conditional: 1 << 26,
  union: 1 << 27,
  intersection: 1 << 28,
} as const;

const objectFlags = {
  classOrInterface: (1 << 0) | (1 << 1),
  reference: 1 << 2,
  mapped: 1 << 5,
} as const;

export class TsgoProjectSession {
  #client?: TsgoApiClient;
  #config?: { options: unknown; fileNames: string[] };
  #snapshot?: string;
  #projects: ProjectResponse[] = [];
  #files = new Map<string, FileCache>();
  #symbolsById = new Map<string, TsgoSymbol>();
  #syntheticSymbolsById = new Map<string, TsgoSymbol>();
  #symbolTypeById = new Map<string, string>();
  #nodesById = new Map<string, TsgoNode>();
  #typeLookupById = new Map<string, TypeLookup>();
  #typeSourceById = new Map<string, SourceSlice>();
  #typeTextById = new Map<string, string>();
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
    this.clearHandleCaches();
    this.#typeTextById.clear();
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
    const type = this.rememberType(state.typeByPosition.get(position));
    if (type) {
      this.#typeLookupById.set(type.id, { fileName, position, sourceText });
    }
    return type;
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
    return this.rememberSymbol(state.symbolByPosition.get(position));
  }

  getSymbol(symbol: string | TsgoSymbol): TsgoSymbol | undefined {
    if (typeof symbol !== "string") {
      return this.rememberSymbol(symbol);
    }
    const synthetic = this.#syntheticSymbolsById.get(symbol);
    if (synthetic) {
      return synthetic;
    }
    const cached = this.#symbolsById.get(symbol);
    if (cached) {
      return cached;
    }
    const typeId = this.#symbolTypeById.get(symbol);
    if (!typeId || !this.#snapshot) {
      return undefined;
    }
    const resolved = this.client().callJson<TsgoSymbol | null>("getSymbolOfType", {
      snapshot: this.#snapshot,
      type: typeId,
    });
    return resolved?.id === symbol ? this.rememberSymbol(resolved) : undefined;
  }

  getNode(node: string | TsgoNode): TsgoNode | undefined {
    if (typeof node !== "string") {
      return node;
    }
    return this.#nodesById.get(node) ?? this.rememberNode(node);
  }

  getTypeOfSymbol(symbol: TsgoSymbol): TsgoType | undefined {
    const type = this.rememberType(this.tryGetSymbolType(symbol, "getTypeOfSymbol"));
    this.rememberTypeSource(type, symbol.valueDeclaration);
    return type;
  }

  getDeclaredTypeOfSymbol(symbol: TsgoSymbol): TsgoType | undefined {
    const type = this.rememberType(this.tryGetSymbolType(symbol, "getDeclaredTypeOfSymbol"));
    this.rememberTypeSource(type, symbol.valueDeclaration);
    return type;
  }

  typeToString(type: TsgoType, flags?: number): string {
    try {
      const text = this.client().typeToString(
        this.#snapshot!,
        this.projectId(),
        type.id,
        undefined,
        flags,
      );
      if (flags === undefined) {
        this.#typeTextById.set(type.id, text);
      }
      return text;
    } catch (error) {
      const cached = flags === undefined ? this.#typeTextById.get(type.id) : undefined;
      if (cached !== undefined) {
        return cached;
      }
      throw error;
    }
  }

  getBaseTypeOfLiteralType(type: TsgoType): TsgoType | undefined {
    return this.rememberType(
      this.client().callJson("getBaseTypeOfLiteralType", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
      }),
    );
  }

  getPropertiesOfType(type: TsgoType): readonly TsgoSymbol[] {
    return this.rememberSymbols(
      this.client().callJson("getPropertiesOfType", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
      }) ?? [],
    );
  }

  getSignaturesOfType(type: TsgoType, kind: number): readonly TsgoSignature[] {
    return this.rememberSignatures(
      this.client().callJson("getSignaturesOfType", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
        kind,
      }) ?? [],
    );
  }

  getReturnTypeOfSignature(signature: TsgoSignature): TsgoType | undefined {
    return this.rememberType(
      this.client().callJson("getReturnTypeOfSignature", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        signature: signature.id,
      }),
    );
  }

  getTypePredicateOfSignature(signature: TsgoSignature): TsgoTypePredicate | undefined {
    const predicate = this.client().callJson<TsgoTypePredicate | undefined>(
      "getTypePredicateOfSignature",
      {
        snapshot: this.#snapshot,
        project: this.projectId(),
        signature: signature.id,
      },
    );
    if (predicate?.type) {
      this.rememberType(predicate.type);
    }
    return predicate;
  }

  getBaseTypes(type: TsgoType): readonly TsgoType[] {
    if (isArrayOrTupleLikeType(this, type)) {
      return [];
    }
    return this.rememberTypes(
      this.client().callJson("getBaseTypes", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
      }) ?? [],
    );
  }

  getTypeArguments(type: TsgoType): readonly TsgoType[] {
    const argumentsFromApi = this.rememberTypes(
      this.client().getTypeArguments(
        this.#snapshot!,
        this.projectId(),
        type.id,
        type.objectFlags,
      ) as unknown as readonly TsgoType[],
    );
    return argumentsFromApi.length > 0 ? argumentsFromApi : this.fallbackTypeArguments(type);
  }

  getTypesOfType(type: TsgoType): readonly TsgoType[] {
    if (
      (type.flags & (typeFlags.union | typeFlags.intersection | typeFlags.templateLiteral)) ===
      0
    ) {
      return [];
    }
    return this.callTypeArray("getTypesOfType", type);
  }

  getTargetOfType(type: TsgoType): TsgoType | undefined {
    if (
      (type.flags & (typeFlags.index | typeFlags.stringMapping)) === 0 &&
      ((type.objectFlags ?? 0) & (objectFlags.reference | objectFlags.mapped)) === 0
    ) {
      return undefined;
    }
    const target = this.callType("getTargetOfType", type);
    this.cacheTypeText(target);
    return target;
  }

  getTypeParametersOfType(type: TsgoType): readonly TsgoType[] {
    const flags = type.objectFlags ?? 0;
    if ((type.flags & typeFlags.object) === 0 || (flags & objectFlags.classOrInterface) === 0) {
      return [];
    }
    return this.callTypeArray("getTypeParametersOfType", type);
  }

  getOuterTypeParametersOfType(type: TsgoType): readonly TsgoType[] {
    const flags = type.objectFlags ?? 0;
    if ((type.flags & typeFlags.object) === 0 || (flags & objectFlags.classOrInterface) === 0) {
      return [];
    }
    return this.callTypeArray("getOuterTypeParametersOfType", type);
  }

  getLocalTypeParametersOfType(type: TsgoType): readonly TsgoType[] {
    const flags = type.objectFlags ?? 0;
    if ((type.flags & typeFlags.object) === 0 || (flags & objectFlags.classOrInterface) === 0) {
      return [];
    }
    return this.callTypeArray("getLocalTypeParametersOfType", type);
  }

  getObjectTypeOfType(type: TsgoType): TsgoType | undefined {
    return (type.flags & typeFlags.indexedAccess) !== 0
      ? this.callType("getObjectTypeOfType", type)
      : undefined;
  }

  getIndexTypeOfType(type: TsgoType): TsgoType | undefined {
    return (type.flags & typeFlags.indexedAccess) !== 0
      ? this.callType("getIndexTypeOfType", type)
      : undefined;
  }

  getCheckTypeOfType(type: TsgoType): TsgoType | undefined {
    return (type.flags & typeFlags.conditional) !== 0
      ? this.callType("getCheckTypeOfType", type)
      : undefined;
  }

  getExtendsTypeOfType(type: TsgoType): TsgoType | undefined {
    return (type.flags & typeFlags.conditional) !== 0
      ? this.callType("getExtendsTypeOfType", type)
      : undefined;
  }

  getBaseTypeOfType(type: TsgoType): TsgoType | undefined {
    return (type.flags & typeFlags.substitution) !== 0
      ? this.callType("getBaseTypeOfType", type)
      : undefined;
  }

  getConstraintOfType(type: TsgoType): TsgoType | undefined {
    return (type.flags & typeFlags.substitution) !== 0
      ? this.callType("getConstraintOfType", type)
      : undefined;
  }

  private callType(method: string, type: TsgoType): TsgoType | undefined {
    return this.rememberType(
      this.client().callJson<TsgoType | null>(method, {
        snapshot: this.#snapshot,
        type: type.id,
      }) ?? undefined,
    );
  }

  private callTypeArray(method: string, type: TsgoType): readonly TsgoType[] {
    return this.rememberTypes(
      this.client().callJson<readonly TsgoType[] | null>(method, {
        snapshot: this.#snapshot,
        type: type.id,
      }) ?? [],
    );
  }

  private tryGetSymbolType(
    symbol: TsgoSymbol,
    method: "getTypeOfSymbol" | "getDeclaredTypeOfSymbol",
  ): TsgoType | undefined {
    try {
      return this.client()[method](this.#snapshot!, this.projectId(), symbol.id) as
        | TsgoType
        | undefined;
    } catch {
      return undefined;
    }
  }

  private fallbackTypeArguments(type: TsgoType): readonly TsgoType[] {
    const source = this.sourceSliceForType(type);
    if (!source) {
      return [];
    }
    return typeArgumentInfosForSource(source)
      .map((argument) => {
        const symbol = this.getSymbolAtPosition(
          source.node.fileName,
          argument.pos,
          this.sourceTextForPath(source.node.fileName),
        );
        return symbol
          ? (this.getDeclaredTypeOfSymbol(symbol) ?? this.getTypeOfSymbol(symbol))
          : undefined;
      })
      .filter((argument): argument is TsgoType => argument !== undefined);
  }

  private sourceSliceForType(type: TsgoType): SourceSlice | undefined {
    const cached = this.#typeSourceById.get(type.id);
    if (cached) {
      return cached;
    }
    const lookup = this.#typeLookupById.get(type.id);
    if (lookup) {
      const symbol = this.getSymbolAtPosition(lookup.fileName, lookup.position, lookup.sourceText);
      this.rememberTypeSource(type, symbol?.valueDeclaration);
      const fromLookup = this.#typeSourceById.get(type.id);
      if (fromLookup) {
        return fromLookup;
      }
    }
    if (type.symbol) {
      const symbol = this.getSymbol(type.symbol);
      this.rememberTypeSource(type, symbol?.valueDeclaration);
    }
    return this.#typeSourceById.get(type.id);
  }

  private rememberType<T extends TsgoType | undefined>(type: T): T {
    if (type?.symbol) {
      this.#symbolTypeById.set(type.symbol, type.id);
    }
    if (type?.texts?.[0]) {
      this.#typeTextById.set(type.id, type.texts[0]);
    }
    return type;
  }

  private rememberTypes<T extends readonly TsgoType[]>(types: T): T {
    for (const type of types) {
      this.rememberType(type);
    }
    return types;
  }

  private rememberTypeSource(type: TsgoType | undefined, handle: string | undefined): void {
    if (!type || !handle || this.#typeSourceById.has(type.id)) {
      return;
    }
    const source = this.sourceSliceForHandle(handle);
    if (source) {
      this.#typeSourceById.set(type.id, source);
    }
  }

  private cacheTypeText(type: TsgoType | undefined): void {
    if (!type || this.#typeTextById.has(type.id)) {
      return;
    }
    try {
      this.#typeTextById.set(
        type.id,
        this.client().typeToString(this.#snapshot!, this.projectId(), type.id),
      );
    } catch {
      // Some upstream handles are only renderable before a later relation query.
    }
  }

  private rememberSymbol<T extends TsgoSymbol | undefined>(symbol: T): T {
    if (!symbol) {
      return symbol;
    }
    const synthetic = this.#syntheticSymbolsById.get(symbol.id);
    if (synthetic) {
      return synthetic as T;
    }
    this.#symbolsById.set(symbol.id, symbol);
    for (const declaration of symbol.declarations ?? []) {
      this.rememberNode(declaration);
    }
    if (symbol.valueDeclaration) {
      this.rememberNode(symbol.valueDeclaration);
    }
    return symbol;
  }

  private rememberSymbols<T extends readonly TsgoSymbol[]>(symbols: T): T {
    for (const symbol of symbols) {
      this.rememberSymbol(symbol);
    }
    return symbols;
  }

  private rememberSignatures<T extends readonly TsgoSignature[]>(signatures: T): T {
    for (const signature of signatures) {
      this.rememberSignature(signature);
    }
    return signatures;
  }

  private rememberSignature(signature: TsgoSignature): TsgoSignature {
    if (signature.declaration) {
      this.rememberNode(signature.declaration);
    }
    const parameters = signature.declaration
      ? this.parameterInfosForDeclaration(signature.declaration)
      : [];
    const parameterIds = Array.isArray(signature.parameters) ? signature.parameters : [];
    parameterIds.forEach((id, index) => {
      this.rememberSyntheticSymbol(id, parameters[index]);
    });
    if (signature.thisParameter) {
      this.rememberSyntheticSymbol(signature.thisParameter, undefined, "this");
    }
    return signature;
  }

  private rememberSyntheticSymbol(
    id: string,
    parameter?: ParameterInfo,
    fallbackName = "",
  ): TsgoSymbol {
    const cached = this.#syntheticSymbolsById.get(id);
    if (cached && (cached.name || !parameter?.name)) {
      return cached;
    }
    const declaration = parameter?.node.id;
    const symbol: TsgoSymbol = {
      id,
      name: parameter?.name ?? fallbackName,
      flags: cached?.flags ?? 0,
      checkFlags: cached?.checkFlags ?? 0,
      declarations: declaration ? [declaration] : (cached?.declarations ?? []),
      valueDeclaration: declaration ?? cached?.valueDeclaration,
    };
    this.#syntheticSymbolsById.set(id, symbol);
    this.#symbolsById.set(id, symbol);
    if (declaration) {
      this.#nodesById.set(declaration, parameter.node);
    }
    return symbol;
  }

  private rememberNode(handle: string): TsgoNode | undefined {
    const parsed = parseNodeHandle(handle);
    if (!parsed) {
      return undefined;
    }
    this.#nodesById.set(handle, parsed);
    return parsed;
  }

  private clearHandleCaches(): void {
    this.#symbolsById.clear();
    this.#syntheticSymbolsById.clear();
    this.#symbolTypeById.clear();
    this.#nodesById.clear();
    this.#typeLookupById.clear();
    this.#typeSourceById.clear();
  }

  private parameterInfosForDeclaration(handle: string): readonly ParameterInfo[] {
    const source = this.sourceSliceForHandle(handle);
    if (!source) {
      return [];
    }
    const open = findConstructorParameterOpen(source.text);
    if (open < 0) {
      return [];
    }
    const close = matchingCloseParen(source.text, open);
    if (close < 0) {
      return [];
    }
    const parametersText = source.text.slice(open + 1, close);
    return splitTopLevelRanges(parametersText, ",")
      .map((range) => parameterInfoForText(source.node, parametersText, range, open + 1))
      .filter((parameter): parameter is ParameterInfo => parameter !== undefined);
  }

  private sourceSliceForHandle(handle: string): SourceSlice | undefined {
    const node = this.getNode(handle);
    if (!node) {
      return undefined;
    }
    const sourceText = this.sourceTextForPath(node.fileName);
    if (!sourceText || node.pos < 0 || node.end > sourceText.length || node.pos >= node.end) {
      return undefined;
    }
    return { node, text: sourceText.slice(node.pos, node.end) };
  }

  private sourceTextForPath(path: string): string | undefined {
    for (const [fileName, cached] of this.#files) {
      if (fileName === path || fileName.endsWith(path)) {
        return cached.lintSourceText ?? cached.sourceText ?? readFileOrUndefined(fileName);
      }
    }
    return readFileOrUndefined(path) ?? readFileOrUndefined(`${this.runtime.cwd}/${path}`);
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
      throw new Error(`corsa oxlint could not parse a Corsa config for ${this.project.configPath}`);
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
    this.clearHandleCaches();
    if (previous && previous !== this.#snapshot) {
      this.client().releaseHandle(previous);
    }
    return prepared;
  }

  private projectId(): string {
    const id = this.#projects[0]?.id;
    if (!id) {
      throw new Error(
        `corsa oxlint could not resolve a Corsa project for ${this.project.filename}`,
      );
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

function isArrayOrTupleLikeType(session: TsgoProjectSession, type: TsgoType): boolean {
  const texts =
    Array.isArray(type.texts) && type.texts.length > 0 ? type.texts : [session.typeToString(type)];
  return texts.some((text) => {
    const normalized = text.trimStart();
    return (
      normalized.startsWith("readonly [") || normalized.startsWith("[") || normalized.endsWith("[]")
    );
  });
}

function findConstructorParameterOpen(text: string): number {
  const constructorPattern = /\bconstructor\s*\(/g;
  let match: RegExpExecArray | null;
  let open = -1;
  while ((match = constructorPattern.exec(text)) !== null) {
    open = match.index + match[0].lastIndexOf("(");
  }
  if (open >= 0) {
    return open;
  }
  return text.indexOf("(");
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

function parseNodeHandle(value: string): TsgoNode | undefined {
  const [posText, endText, _kindText, ...pathParts] = value.split(".");
  const pos = Number(posText);
  const end = Number(endText);
  const fileName = pathParts.join(".");
  if (!Number.isFinite(pos) || !Number.isFinite(end) || !fileName) {
    return undefined;
  }
  return { id: value, fileName, pos, end, range: [pos, end] };
}

function parameterInfoForText(
  declarationNode: TsgoNode,
  parametersText: string,
  range: { readonly start: number; readonly end: number },
  parametersStart: number,
): ParameterInfo | undefined {
  const raw = parametersText.slice(range.start, range.end);
  const leading = raw.search(/\S/);
  if (leading < 0) {
    return undefined;
  }
  const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
  const text = raw.slice(leading, raw.length - trailing);
  const name = parameterNameForText(text);
  if (!name) {
    return undefined;
  }
  const pos = declarationNode.pos + parametersStart + range.start + leading;
  const end = declarationNode.pos + parametersStart + range.end - trailing;
  const id = `${pos}.${end}.0.${declarationNode.fileName}`;
  return {
    name,
    node: {
      id,
      fileName: declarationNode.fileName,
      pos,
      end,
      range: [pos, end],
    },
  };
}

function parameterNameForText(text: string): string | undefined {
  let candidate = text.trim().replace(/^\.\.\.\s*/, "");
  let changed = true;
  while (changed) {
    const previous = candidate;
    candidate = candidate.replace(
      /^(?:public|private|protected|readonly|override|static|abstract|declare)\s+/,
      "",
    );
    changed = candidate !== previous;
  }
  const separator = firstTopLevelIndexOfAny(candidate, [":", "="]);
  let left = (separator >= 0 ? candidate.slice(0, separator) : candidate).trim();
  if (left.endsWith("?")) {
    left = left.slice(0, -1).trim();
  }
  if (left.startsWith("{") || left.startsWith("[")) {
    return left;
  }
  return left.split(/\s+/).at(-1);
}

function typeArgumentInfosForSource(source: SourceSlice): readonly TypeArgumentInfo[] {
  const annotationMarker = firstTopLevelIndexOfAny(source.text, [":", "="]);
  const typeStart = annotationMarker >= 0 ? annotationMarker + 1 : 0;
  const openInType = firstTopLevelOpeningAngle(source.text.slice(typeStart));
  if (openInType < 0) {
    return [];
  }
  const open = typeStart + openInType;
  const close = matchingCloseAngle(source.text, open);
  if (close < 0) {
    return [];
  }
  const argumentsText = source.text.slice(open + 1, close);
  return splitTopLevelRanges(argumentsText, ",")
    .map((range) => {
      const raw = argumentsText.slice(range.start, range.end);
      const leading = raw.search(/\S/);
      if (leading < 0) {
        return undefined;
      }
      return {
        pos: source.node.pos + open + 1 + range.start + leading,
      };
    })
    .filter((argument): argument is TypeArgumentInfo => argument !== undefined);
}

function matchingCloseParen(text: string, open: number): number {
  let depth = 0;
  const scanner = createScanner();
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (scanner.inQuote(char)) {
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function matchingCloseAngle(text: string, open: number): number {
  let depth = 0;
  const scanner = createScanner();
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (scanner.inQuote(char)) {
      continue;
    }
    if (char === "<") {
      depth += 1;
    } else if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function splitTopLevelRanges(
  text: string,
  delimiter: string,
): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const scanner = createScanner();
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (scanner.inQuote(char)) {
      continue;
    }
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (
      char === delimiter &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function firstTopLevelIndexOfAny(text: string, needles: readonly string[]): number {
  const scanner = createScanner();
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (scanner.inQuote(char)) {
      continue;
    }
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (
      needles.includes(char) &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }
  }
  return -1;
}

function firstTopLevelOpeningAngle(text: string): number {
  const scanner = createScanner();
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (scanner.inQuote(char)) {
      continue;
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "<" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index;
    }
  }
  return -1;
}

function createScanner(): {
  inQuote(char: string): boolean;
} {
  let quote: string | undefined;
  let escaped = false;
  return {
    inQuote(char) {
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        return true;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        return true;
      }
      return false;
    },
  };
}

function readFileOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
