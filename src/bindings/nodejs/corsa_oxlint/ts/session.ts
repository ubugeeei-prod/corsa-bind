import { readFileSync, statSync } from "node:fs";

import { type ProjectResponse, CorsaApiClient } from "@corsa-bind/napi";

import type {
  CorsaCallSignatureFacts,
  CorsaNode,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypePredicate,
} from "./types";
import type { ResolvedProjectConfig, ResolvedRuntimeOptions } from "./types";

type FileCache = {
  mtimeMs: number;
  lintSourceText?: string;
  sourceText?: string;
  projectId: string;
  typeByPosition: Map<number, CorsaType | undefined>;
  typeBySourceRange: Map<string, CorsaType | undefined>;
  symbolByPosition: Map<number, CorsaSymbol | undefined>;
};

type PreparedFileState = {
  mtimeMs: number;
  lintSourceText?: string;
  sourceText?: string;
};

type SourceSlice = {
  node: CorsaNode;
  text: string;
};

type TypeLookup = {
  fileName: string;
  position: number;
  sourceText?: string;
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

export class CorsaProjectSession {
  #client?: CorsaApiClient;
  #config?: { options: unknown; fileNames: string[] };
  #snapshot?: string;
  #projects: ProjectResponse[] = [];
  #files = new Map<string, FileCache>();
  #symbolsById = new Map<string, CorsaSymbol>();
  #symbolsByTypeId = new Map<string, CorsaSymbol | null>();
  #symbolTypeById = new Map<string, string>();
  #nodesById = new Map<string, CorsaNode>();
  #baseTypesById = new Map<string, readonly CorsaType[]>();
  #implementedTypesById = new Map<string, readonly CorsaType[]>();
  #ownImplementedTypesById = new Map<string, readonly CorsaType[]>();
  #typeLookupById = new Map<string, TypeLookup>();
  #typeSourceById = new Map<string, SourceSlice>();
  #sourceLengthByPath = new Map<string, number>();
  #typeTextById = new Map<string, string>();
  #lastRefreshMs = 0;
  #snapshotHasIssuedHandles = false;
  #supportsOverlayChanges?: boolean;
  #fatalTransportError?: Error;

  constructor(
    readonly project: ResolvedProjectConfig,
    readonly runtime: ResolvedRuntimeOptions,
  ) {}

  close(): void {
    if (this.#snapshot) {
      this.tryReleaseHandle(this.#snapshot);
      this.#snapshot = undefined;
    }
    this.tryCloseClient();
    this.#client = undefined;
    this.#supportsOverlayChanges = undefined;
    this.#files.clear();
    this.clearHandleCaches();
    this.#typeTextById.clear();
  }

  getCompilerOptions(): unknown {
    return this.withTransportRecovery(() => this.config().options, "reading compiler options");
  }

  getRootFileNames(): readonly string[] {
    return this.withTransportRecovery(() => this.config().fileNames, "reading root file names");
  }

  getTypeAtPosition(
    fileName: string,
    position: number,
    sourceText?: string,
  ): CorsaType | undefined {
    return this.withTransportRecovery(
      () => this.getTypeAtPositionUnchecked(fileName, position, sourceText),
      "looking up a type",
    );
  }

  private getTypeAtPositionUnchecked(
    fileName: string,
    position: number,
    sourceText?: string,
  ): CorsaType | undefined {
    const state = this.fileState(fileName, sourceText);
    if (!state.typeByPosition.has(position)) {
      state.typeByPosition.set(
        position,
        this.client().getTypeAtPosition(this.#snapshot!, state.projectId, fileName, position) as
          | CorsaType
          | undefined,
      );
    }
    const type = this.rememberType(state.typeByPosition.get(position));
    if (type) {
      this.#typeLookupById.set(type.id, { fileName, position, sourceText });
    }
    return type;
  }

  getTypeAtSourceRange(
    fileName: string,
    start: number,
    end: number,
    sourceText: string | undefined,
    kind: string | undefined,
  ): CorsaType | undefined {
    return this.withTransportRecovery(
      () => this.getTypeAtSourceRangeUnchecked(fileName, start, end, sourceText, kind),
      "looking up a type",
    );
  }

  private getTypeAtSourceRangeUnchecked(
    fileName: string,
    start: number,
    end: number,
    sourceText: string | undefined,
    kind: string | undefined,
  ): CorsaType | undefined {
    if (!sourceText || end <= start) {
      return this.getTypeAtPositionUnchecked(fileName, start, sourceText);
    }
    const state = this.fileState(fileName, sourceText);
    const key = `${start}:${end}:${kind ?? ""}`;
    if (!state.typeBySourceRange.has(key)) {
      state.typeBySourceRange.set(
        key,
        this.client().getTypeAtSourceRange(
          this.#snapshot!,
          state.projectId,
          fileName,
          start,
          end,
          sourceText,
          kind,
        ) as CorsaType | undefined,
      );
    }
    const type = this.rememberType(state.typeBySourceRange.get(key));
    if (type) {
      this.#typeLookupById.set(type.id, { fileName, position: start, sourceText });
      if (kind !== "Identifier") {
        this.rememberTypeSourceRange(type, fileName, start, end, sourceText);
      }
    }
    return type;
  }

  getSymbolAtPosition(
    fileName: string,
    position: number,
    sourceText?: string,
  ): CorsaSymbol | undefined {
    return this.withTransportRecovery(
      () => this.getSymbolAtPositionUnchecked(fileName, position, sourceText),
      "looking up a symbol",
    );
  }

  private getSymbolAtPositionUnchecked(
    fileName: string,
    position: number,
    sourceText?: string,
  ): CorsaSymbol | undefined {
    const state = this.fileState(fileName, sourceText);
    if (!state.symbolByPosition.has(position)) {
      state.symbolByPosition.set(
        position,
        this.client().getSymbolAtPosition(this.#snapshot!, state.projectId, fileName, position) as
          | CorsaSymbol
          | undefined,
      );
    }
    return this.rememberSymbol(state.symbolByPosition.get(position));
  }

  getSymbol(symbol: string | CorsaSymbol): CorsaSymbol | undefined {
    return this.withTransportRecovery(() => this.getSymbolUnchecked(symbol), "looking up a symbol");
  }

  private getSymbolUnchecked(symbol: string | CorsaSymbol): CorsaSymbol | undefined {
    if (typeof symbol !== "string") {
      return this.rememberSymbol(symbol);
    }
    const cached = this.#symbolsById.get(symbol);
    if (cached) {
      return cached;
    }
    const typeId = this.#symbolTypeById.get(symbol);
    if (!typeId || !this.#snapshot) {
      return undefined;
    }
    const resolved = this.getSymbolOfTypeById(typeId);
    return resolved?.id === symbol ? resolved : undefined;
  }

  getSymbolOfType(type: CorsaType): CorsaSymbol | undefined {
    return this.withTransportRecovery(
      () => this.getSymbolOfTypeUnchecked(type),
      "looking up a symbol",
    );
  }

  private getSymbolOfTypeUnchecked(type: CorsaType): CorsaSymbol | undefined {
    const cached = this.#symbolsByTypeId.get(type.id);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    if (type.symbol) {
      const symbol = this.getSymbol(type.symbol);
      if (isUsableSymbol(symbol)) {
        this.#symbolsByTypeId.set(type.id, symbol);
        return symbol;
      }
    }
    const lookupSymbol = this.getSymbolOfTypeAtLookup(type);
    if (lookupSymbol) {
      this.#symbolsByTypeId.set(type.id, lookupSymbol);
      return lookupSymbol;
    }
    const symbol = this.getSymbolOfTypeById(type.id);
    if (symbol) {
      this.#symbolsByTypeId.set(type.id, symbol);
      return symbol;
    }
    this.#symbolsByTypeId.set(type.id, null);
    return undefined;
  }

  private getSymbolOfTypeAtLookup(type: CorsaType): CorsaSymbol | undefined {
    const lookup = this.#typeLookupById.get(type.id);
    if (!lookup) {
      return undefined;
    }
    const symbol = this.getSymbolAtPosition(lookup.fileName, lookup.position, lookup.sourceText);
    const texts = [...this.typeTexts(type)];
    if (isUsableSymbol(symbol)) {
      if (texts.some((text) => text.trim() === symbol.name)) {
        return symbol;
      }
    }
    const sourceText = lookup.sourceText ?? this.sourceTextForPath(lookup.fileName);
    let typeSymbolName = typeSymbolNameFromTexts(texts);
    if (isUsableSymbol(symbol) && sourceText && typeSymbolName) {
      const typeSymbol = this.getNearbyTypeSymbol(lookup, sourceText, typeSymbolName);
      if (typeSymbol) {
        return typeSymbol;
      }
    }
    if (isUsableSymbol(symbol)) {
      try {
        const rendered = this.typeToString(type);
        if (!texts.includes(rendered)) {
          texts.unshift(rendered);
        }
      } catch {
        // A stale handle may still have cached texts or a usable lookup symbol.
      }
      if (texts.some((text) => text.trim() === symbol.name)) {
        return symbol;
      }
      typeSymbolName = typeSymbolNameFromTexts(texts);
    }
    if (isUsableSymbol(symbol) && sourceText && typeSymbolName) {
      return this.getNearbyTypeSymbol(lookup, sourceText, typeSymbolName);
    }
    return undefined;
  }

  private getNearbyTypeSymbol(
    lookup: TypeLookup,
    sourceText: string,
    typeSymbolName: string,
  ): CorsaSymbol | undefined {
    const typePosition = findIdentifierPosition(
      sourceText,
      typeSymbolName,
      lookup.position,
      lookup.position + 512,
    );
    if (typePosition === undefined || typePosition === lookup.position) {
      return undefined;
    }
    const typeSymbol = this.getSymbolAtPosition(lookup.fileName, typePosition, lookup.sourceText);
    return isUsableSymbol(typeSymbol) && typeSymbol.name === typeSymbolName
      ? typeSymbol
      : undefined;
  }

  private getSymbolOfTypeById(typeId: string): CorsaSymbol | undefined {
    if (!this.#snapshot || typeId.trim().length === 0) {
      return undefined;
    }
    try {
      return this.rememberUsableSymbol(
        this.client().getSymbolOfType(this.#snapshot, typeId) as CorsaSymbol | null,
      );
    } catch (error) {
      if (isMissingTypeHandleError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  getNode(node: string | CorsaNode): CorsaNode | undefined {
    if (typeof node !== "string") {
      return node;
    }
    return this.#nodesById.get(node) ?? this.rememberNode(node);
  }

  getSourceTextForPath(path: string): string | undefined {
    return this.sourceTextForPath(path);
  }

  getTypeOfSymbol(symbol: CorsaSymbol): CorsaType | undefined {
    const type = this.rememberType(this.tryGetSymbolType(symbol, "getTypeOfSymbol"));
    this.rememberTypeSource(type, symbol.valueDeclaration);
    return type;
  }

  getTypeOfSymbolById(id: string): CorsaType | undefined {
    return this.rememberType(this.tryGetSymbolTypeId(id, "getTypeOfSymbol"));
  }

  getDeclaredTypeOfSymbol(symbol: CorsaSymbol): CorsaType | undefined {
    const type = this.rememberType(this.tryGetSymbolType(symbol, "getDeclaredTypeOfSymbol"));
    this.rememberTypeSource(type, symbol.valueDeclaration);
    return type;
  }

  getDeclaredTypeOfSymbolById(id: string): CorsaType | undefined {
    return this.rememberType(this.tryGetSymbolTypeId(id, "getDeclaredTypeOfSymbol"));
  }

  typeToString(type: CorsaType, flags?: number): string {
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

  getBaseTypeOfLiteralType(type: CorsaType): CorsaType | undefined {
    return this.withMissingTypeHandleFallback<CorsaType | undefined>(type, undefined, () =>
      this.rememberType(
        this.client().callJson("getBaseTypeOfLiteralType", {
          snapshot: this.#snapshot,
          project: this.projectId(),
          type: type.id,
        }),
      ),
    );
  }

  getPropertiesOfType(type: CorsaType): readonly CorsaSymbol[] {
    return this.withMissingTypeHandleFallback<readonly CorsaSymbol[]>(type, [], () =>
      this.rememberSymbols(
        this.client().callJson("getPropertiesOfType", {
          snapshot: this.#snapshot,
          project: this.projectId(),
          type: type.id,
        }) ?? [],
      ),
    );
  }

  getSignaturesOfType(type: CorsaType, kind: number): readonly CorsaSignature[] {
    return this.withMissingTypeHandleFallback<readonly CorsaSignature[]>(type, [], () => {
      const source = this.sourceContextForType(type);
      return this.rememberSignatures(
        this.client().callJson("getSignaturesOfType", {
          snapshot: this.#snapshot,
          project: this.projectId(),
          type: type.id,
          kind,
          ...source,
        }) ?? [],
      );
    });
  }

  private withMissingTypeHandleFallback<T>(type: CorsaType, fallback: T, operation: () => T): T {
    if (type.id.trim().length === 0) {
      return fallback;
    }
    try {
      return operation();
    } catch (error) {
      if (isMissingTypeHandleError(error)) {
        return fallback;
      }
      throw error;
    }
  }

  getCallSignatureFacts(
    type: CorsaType,
    kind: number,
    argumentTypeTexts: readonly (readonly string[])[],
    explicitTypeArgumentTexts: readonly string[],
  ): CorsaCallSignatureFacts {
    return this.withMissingTypeHandleFallback<CorsaCallSignatureFacts>(type, {}, () => {
      const source = this.sourceContextForType(type);
      const facts = this.client().callJson<CorsaCallSignatureFacts>("getCallSignatureFacts", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        type: type.id,
        kind,
        ...source,
        argumentTypeTexts,
        explicitTypeArgumentTexts,
      });
      if (facts?.signature) {
        this.rememberSignature(facts.signature);
      }
      return facts ?? {};
    });
  }

  getReturnTypeOfSignature(signature: CorsaSignature): CorsaType | undefined {
    return this.rememberType(
      this.client().callJson("getReturnTypeOfSignature", {
        snapshot: this.#snapshot,
        project: this.projectId(),
        signature: signature.id,
      }),
    );
  }

  getTypePredicateOfSignature(signature: CorsaSignature): CorsaTypePredicate | undefined {
    const predicate = this.client().callJson<CorsaTypePredicate | undefined>(
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

  getBaseTypes(type: CorsaType): readonly CorsaType[] {
    return this.withMissingTypeHandleFallback<readonly CorsaType[]>(type, [], () => {
      if (isSyntheticTypeHandle(type.id) || isArrayOrTupleLikeType(this, type)) {
        return [];
      }
      const cached = this.#baseTypesById.get(type.id);
      if (cached) {
        return cached;
      }
      const baseTypes = this.rememberTypes(
        this.client().callJson<readonly CorsaType[]>("getBaseTypes", {
          snapshot: this.#snapshot,
          project: this.projectId(),
          type: type.id,
          texts: this.typeTexts(type),
        }) ?? [],
      );
      this.#baseTypesById.set(type.id, baseTypes);
      return baseTypes;
    });
  }

  getCachedImplementedTypes(typeId: string): readonly CorsaType[] | undefined {
    return this.#implementedTypesById.get(typeId);
  }

  cacheImplementedTypes(typeId: string, types: readonly CorsaType[]): readonly CorsaType[] {
    this.#implementedTypesById.set(typeId, types);
    return types;
  }

  getCachedOwnImplementedTypes(typeId: string): readonly CorsaType[] | undefined {
    return this.#ownImplementedTypesById.get(typeId);
  }

  cacheOwnImplementedTypes(typeId: string, types: readonly CorsaType[]): readonly CorsaType[] {
    this.#ownImplementedTypesById.set(typeId, types);
    return types;
  }

  getTypeArguments(type: CorsaType): readonly CorsaType[] {
    return this.withMissingTypeHandleFallback<readonly CorsaType[]>(type, [], () => {
      const source = this.sourceSliceForType(type);
      return this.rememberTypes(
        source
          ? (this.client().getTypeArgumentsAtSourceRange(
              this.#snapshot!,
              this.projectId(),
              type.id,
              type.objectFlags,
              source.node.fileName,
              source.node.pos,
              source.node.end,
              this.sourceTextForPath(source.node.fileName) ?? "",
            ) as unknown as readonly CorsaType[])
          : (this.client().getTypeArguments(
              this.#snapshot!,
              this.projectId(),
              type.id,
              type.objectFlags,
            ) as unknown as readonly CorsaType[]),
      );
    });
  }

  getTypesOfType(type: CorsaType): readonly CorsaType[] {
    if (
      (type.flags & (typeFlags.union | typeFlags.intersection | typeFlags.templateLiteral)) ===
      0
    ) {
      return [];
    }
    return this.callTypeArray("getTypesOfType", type);
  }

  getTargetOfType(type: CorsaType): CorsaType | undefined {
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

  getTypeParametersOfType(type: CorsaType): readonly CorsaType[] {
    const flags = type.objectFlags ?? 0;
    if ((type.flags & typeFlags.object) === 0 || (flags & objectFlags.classOrInterface) === 0) {
      return [];
    }
    return this.callTypeArray("getTypeParametersOfType", type);
  }

  getOuterTypeParametersOfType(type: CorsaType): readonly CorsaType[] {
    const flags = type.objectFlags ?? 0;
    if ((type.flags & typeFlags.object) === 0 || (flags & objectFlags.classOrInterface) === 0) {
      return [];
    }
    return this.callTypeArray("getOuterTypeParametersOfType", type);
  }

  getLocalTypeParametersOfType(type: CorsaType): readonly CorsaType[] {
    const flags = type.objectFlags ?? 0;
    if ((type.flags & typeFlags.object) === 0 || (flags & objectFlags.classOrInterface) === 0) {
      return [];
    }
    return this.callTypeArray("getLocalTypeParametersOfType", type);
  }

  getObjectTypeOfType(type: CorsaType): CorsaType | undefined {
    return (type.flags & typeFlags.indexedAccess) !== 0
      ? this.callType("getObjectTypeOfType", type)
      : undefined;
  }

  getIndexTypeOfType(type: CorsaType): CorsaType | undefined {
    return (type.flags & typeFlags.indexedAccess) !== 0
      ? this.callType("getIndexTypeOfType", type)
      : undefined;
  }

  getCheckTypeOfType(type: CorsaType): CorsaType | undefined {
    return (type.flags & typeFlags.conditional) !== 0
      ? this.callType("getCheckTypeOfType", type)
      : undefined;
  }

  getExtendsTypeOfType(type: CorsaType): CorsaType | undefined {
    return (type.flags & typeFlags.conditional) !== 0
      ? this.callType("getExtendsTypeOfType", type)
      : undefined;
  }

  getBaseTypeOfType(type: CorsaType): CorsaType | undefined {
    return (type.flags & typeFlags.substitution) !== 0
      ? this.callType("getBaseTypeOfType", type)
      : undefined;
  }

  getConstraintOfType(type: CorsaType): CorsaType | undefined {
    return this.withMissingTypeHandleFallback<CorsaType | undefined>(type, undefined, () =>
      this.rememberType(
        this.client().getConstraintOfType(this.#snapshot!, this.projectId(), type.id) as
          | CorsaType
          | undefined,
      ),
    );
  }

  private callType(method: string, type: CorsaType): CorsaType | undefined {
    return this.withMissingTypeHandleFallback<CorsaType | undefined>(type, undefined, () =>
      this.rememberType(
        this.client().callJson<CorsaType | null>(method, {
          snapshot: this.#snapshot,
          type: type.id,
        }) ?? undefined,
      ),
    );
  }

  private callTypeArray(method: string, type: CorsaType): readonly CorsaType[] {
    return this.withMissingTypeHandleFallback<readonly CorsaType[]>(type, [], () =>
      this.rememberTypes(
        this.client().callJson<readonly CorsaType[] | null>(method, {
          snapshot: this.#snapshot,
          type: type.id,
        }) ?? [],
      ),
    );
  }

  private tryGetSymbolType(
    symbol: CorsaSymbol,
    method: "getTypeOfSymbol" | "getDeclaredTypeOfSymbol",
  ): CorsaType | undefined {
    return this.tryGetSymbolTypeId(symbol.id, method);
  }

  private tryGetSymbolTypeId(
    id: string,
    method: "getTypeOfSymbol" | "getDeclaredTypeOfSymbol",
  ): CorsaType | undefined {
    try {
      return this.client()[method](this.#snapshot!, this.projectId(), id) as CorsaType | undefined;
    } catch {
      return undefined;
    }
  }

  private sourceSliceForType(type: CorsaType): SourceSlice | undefined {
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

  private rememberType<T extends CorsaType | undefined>(type: T): T {
    if (type) {
      normalizeType(type);
      this.#snapshotHasIssuedHandles = true;
    }
    if (type?.symbol) {
      this.#symbolTypeById.set(type.symbol, type.id);
    }
    if (type?.texts?.[0]) {
      this.#typeTextById.set(type.id, type.texts[0]);
    }
    return type;
  }

  private rememberTypes<T extends readonly CorsaType[]>(types: T): T {
    for (const type of types) {
      this.rememberType(type);
    }
    return types;
  }

  private rememberTypeSource(type: CorsaType | undefined, handle: string | undefined): void {
    if (!type || !handle || this.#typeSourceById.has(type.id)) {
      return;
    }
    const source = this.sourceSliceForHandle(handle);
    if (source) {
      this.#typeSourceById.set(type.id, source);
    }
  }

  private rememberTypeSourceRange(
    type: CorsaType,
    fileName: string,
    start: number,
    end: number,
    sourceText: string | undefined,
  ): void {
    if (
      this.#typeSourceById.has(type.id) ||
      !sourceText ||
      start < 0 ||
      end > sourceText.length ||
      start >= end
    ) {
      return;
    }
    const node = {
      fileName,
      pos: start,
      end,
      range: [start, end] as const,
    };
    this.#typeSourceById.set(type.id, {
      node,
      text: sourceText.slice(start, end),
    });
  }

  private cacheTypeText(type: CorsaType | undefined): void {
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

  private typeTexts(type: CorsaType): readonly string[] {
    if (Array.isArray(type.texts) && type.texts.length > 0) {
      return type.texts;
    }
    const cached = this.#typeTextById.get(type.id);
    return cached === undefined ? [] : [cached];
  }

  private sourceContextForType(type: CorsaType): { file?: string; sourceText?: string } {
    const lookup = this.#typeLookupById.get(type.id);
    if (lookup) {
      const sourceText = lookup.sourceText ?? this.sourceTextForPath(lookup.fileName);
      return sourceText ? { file: lookup.fileName, sourceText } : {};
    }
    const source = this.#typeSourceById.get(type.id);
    if (source) {
      const sourceText = this.sourceTextForPath(source.node.fileName);
      return sourceText ? { file: source.node.fileName, sourceText } : {};
    }
    return {};
  }

  private rememberSymbol<T extends CorsaSymbol | undefined>(symbol: T): T {
    if (!symbol) {
      return symbol;
    }
    normalizeSymbol(symbol);
    this.#snapshotHasIssuedHandles = true;
    this.#symbolsById.set(symbol.id, symbol);
    for (const declaration of symbol.declarations ?? []) {
      this.rememberNode(declaration);
    }
    if (symbol.valueDeclaration) {
      this.rememberNode(symbol.valueDeclaration);
    }
    return symbol;
  }

  private rememberUsableSymbol(symbol: CorsaSymbol | null | undefined): CorsaSymbol | undefined {
    return isUsableSymbol(symbol) ? this.rememberSymbol(symbol) : undefined;
  }

  private rememberSymbols<T extends readonly CorsaSymbol[]>(symbols: T): T {
    for (const symbol of symbols) {
      this.rememberSymbol(symbol);
    }
    return symbols;
  }

  private rememberSignatures<T extends readonly CorsaSignature[]>(signatures: T): T {
    for (const signature of signatures) {
      this.rememberSignature(signature);
    }
    return signatures;
  }

  private rememberSignature(signature: CorsaSignature): CorsaSignature {
    normalizeSignature(signature);
    if (signature.declaration) {
      this.rememberNode(signature.declaration);
    }
    for (const symbol of signature.parameterSymbols ?? []) {
      this.rememberSymbol(symbol);
    }
    if (signature.thisParameterSymbol) {
      this.rememberSymbol(signature.thisParameterSymbol);
    }
    return signature;
  }

  private rememberNode(handle: string): CorsaNode | undefined {
    const parsed = parseNodeHandle(handle, (fileName) => this.sourceLengthForPath(fileName));
    if (!parsed) {
      return undefined;
    }
    this.#nodesById.set(handle, parsed);
    return parsed;
  }

  private clearHandleCaches(): void {
    this.#symbolsById.clear();
    this.#symbolsByTypeId.clear();
    this.#symbolTypeById.clear();
    this.#nodesById.clear();
    this.#baseTypesById.clear();
    this.#implementedTypesById.clear();
    this.#ownImplementedTypesById.clear();
    this.#typeLookupById.clear();
    this.#typeSourceById.clear();
    this.#sourceLengthByPath.clear();
    this.#snapshotHasIssuedHandles = false;
  }

  private sourceLengthForPath(path: string): number | undefined {
    const cached = this.#sourceLengthByPath.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const length = this.sourceTextForPath(path)?.length;
    if (length !== undefined) {
      this.#sourceLengthByPath.set(path, length);
    }
    return length;
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
    return {
      node,
      text: sourceText.slice(node.pos, node.end),
    };
  }

  private sourceTextForPath(path: string): string | undefined {
    for (const [fileName, cached] of this.#files) {
      if (pathsReferToSameFile(fileName, path)) {
        return cached.lintSourceText ?? cached.sourceText ?? readFileOrUndefined(fileName);
      }
    }
    return readFileOrUndefined(path) ?? readFileOrUndefined(`${this.runtime.cwd}/${path}`);
  }

  private withTransportRecovery<T>(operation: () => T, action: string): T {
    if (this.#fatalTransportError) {
      throw this.#fatalTransportError;
    }
    try {
      return operation();
    } catch (error) {
      if (!isRecoverableTransportError(error)) {
        throw error;
      }
      this.resetClientAfterTransportFailure();
      try {
        return operation();
      } catch (retryError) {
        if (!isRecoverableTransportError(retryError)) {
          throw retryError;
        }
        const fatal = new Error(
          `corsa type-aware backend exited while ${action}; restarted the session, but the retry failed`,
        );
        (fatal as Error & { cause?: unknown }).cause = retryError;
        this.#fatalTransportError = fatal;
        throw fatal;
      }
    }
  }

  private resetClientAfterTransportFailure(): void {
    this.tryCloseClient();
    this.#client = undefined;
    this.#config = undefined;
    this.#snapshot = undefined;
    this.#projects = [];
    this.#files.clear();
    this.clearHandleCaches();
    this.#typeTextById.clear();
    this.#lastRefreshMs = 0;
    this.#supportsOverlayChanges = undefined;
    this.#fatalTransportError = undefined;
  }

  private tryReleaseHandle(handle: string): void {
    try {
      this.#client?.releaseHandle(handle);
    } catch (error) {
      if (!isRecoverableTransportError(error)) {
        throw error;
      }
    }
  }

  private tryCloseClient(): void {
    try {
      this.#client?.close();
    } catch (error) {
      if (!isRecoverableTransportError(error)) {
        throw error;
      }
    }
  }

  private client(): CorsaApiClient {
    if (!this.#client) {
      this.#client = CorsaApiClient.spawn({
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
      typeBySourceRange: new Map(),
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
    const mtimeChanged = cached !== undefined && mtimeMs !== cached.mtimeMs;
    const textChanged = overlayText !== cached?.sourceText;
    const prepared = {
      mtimeMs,
      lintSourceText: sourceText,
      sourceText: overlayText,
    };
    const stale =
      !this.#snapshot ||
      mtimeChanged ||
      textChanged ||
      (expired && !this.#snapshotHasIssuedHandles);
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
      this.tryReleaseHandle(previous);
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

function isArrayOrTupleLikeType(session: CorsaProjectSession, type: CorsaType): boolean {
  const texts =
    Array.isArray(type.texts) && type.texts.length > 0 ? type.texts : [session.typeToString(type)];
  return texts.some((text) => {
    const normalized = text.trimStart();
    return (
      normalized.startsWith("readonly [") || normalized.startsWith("[") || normalized.endsWith("[]")
    );
  });
}

function isUsableSymbol(symbol: CorsaSymbol | null | undefined): symbol is CorsaSymbol {
  return symbol != null && !symbol.name.includes("\ufffd");
}

function isSyntheticTypeHandle(handle: string): boolean {
  return handle.startsWith("synthetic-");
}

function typeSymbolNameFromTexts(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const match =
      /^(?:typeof\s+)?(?:[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*\.)*([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)(?:\s*<|$)/u.exec(
        text.trim(),
      );
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function findIdentifierPosition(
  sourceText: string,
  identifier: string,
  start: number,
  end: number,
): number | undefined {
  const boundedEnd = Math.min(sourceText.length, end);
  let position = sourceText.indexOf(identifier, Math.max(0, start));
  while (position >= 0 && position < boundedEnd) {
    const before = position > 0 ? sourceText[position - 1] : undefined;
    const after = sourceText[position + identifier.length];
    if (!isIdentifierPart(before) && !isIdentifierPart(after)) {
      return position;
    }
    position = sourceText.indexOf(identifier, position + identifier.length);
  }
  return undefined;
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && /[$_\u200c\u200d\p{ID_Continue}]/u.test(char);
}

function pathsReferToSameFile(left: string, right: string): boolean {
  const normalizedLeft = left.replaceAll("\\", "/").toLowerCase();
  const normalizedRight = right.replaceAll("\\", "/").toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function normalizeType(type: CorsaType): void {
  const mutable = type as {
    id: string;
    symbol?: string;
  };
  mutable.id = handleString((type as { id: unknown }).id);
  const symbol = (type as { symbol?: unknown }).symbol;
  if (symbol != null) {
    mutable.symbol = handleString(symbol);
  }
}

function normalizeSymbol(symbol: CorsaSymbol): void {
  const mutable = symbol as unknown as {
    id: string;
    declarations?: string[];
    valueDeclaration?: string;
  };
  mutable.id = handleString((symbol as { id: unknown }).id);
  const declarations = (symbol as { declarations?: readonly unknown[] }).declarations;
  if (Array.isArray(declarations)) {
    mutable.declarations = declarations.map(handleString);
  }
  const valueDeclaration = (symbol as { valueDeclaration?: unknown }).valueDeclaration;
  if (valueDeclaration != null) {
    mutable.valueDeclaration = handleString(valueDeclaration);
  }
}

function normalizeSignature(signature: CorsaSignature): void {
  const mutable = signature as unknown as {
    id: string;
    declaration?: string;
    typeParameters?: string[];
    parameters?: string[];
    thisParameter?: string;
    target?: string;
  };
  mutable.id = handleString((signature as { id: unknown }).id);
  const declaration = (signature as { declaration?: unknown }).declaration;
  if (declaration != null) {
    mutable.declaration = handleString(declaration);
  }
  const typeParameters = (signature as { typeParameters?: readonly unknown[] }).typeParameters;
  if (Array.isArray(typeParameters)) {
    mutable.typeParameters = typeParameters.map(handleString);
  }
  const parameters = (signature as { parameters?: readonly unknown[] }).parameters;
  if (Array.isArray(parameters)) {
    mutable.parameters = parameters.map(handleString);
  }
  const thisParameter = (signature as { thisParameter?: unknown }).thisParameter;
  if (thisParameter != null) {
    mutable.thisParameter = handleString(thisParameter);
  }
  const target = (signature as { target?: unknown }).target;
  if (target != null) {
    mutable.target = handleString(target);
  }
}

function handleString(value: unknown): string {
  return typeof value === "string" ? value : String(value);
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

function parseNodeHandle(
  value: string,
  sourceLengthForPath: (fileName: string) => number | undefined,
): CorsaNode | undefined {
  const [posText, secondText, thirdText, ...remainingParts] = value.split(".");
  const pos = Number(posText);
  const second = Number(secondText);
  const third = Number(thirdText);
  if (!Number.isFinite(pos) || !Number.isFinite(second)) {
    return undefined;
  }
  const hasEndPosition = Number.isFinite(third);
  const fileName = (hasEndPosition ? remainingParts : [thirdText, ...remainingParts]).join(".");
  if (!fileName) {
    return undefined;
  }
  const end = hasEndPosition ? second : (sourceLengthForPath(fileName) ?? pos + 1);
  if (end < pos) {
    return undefined;
  }
  return { id: value, fileName, pos, end, range: [pos, end] };
}

function isRecoverableTransportError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("process is closed:") ||
    message.includes("Broken pipe") ||
    message.includes("EPIPE") ||
    message.includes("failed to fill whole buffer") ||
    message.includes("msgpack worker") ||
    message.includes("msgpack stdin") ||
    message.includes("msgpack stdout") ||
    message.includes("jsonrpc reader") ||
    message.includes("jsonrpc writer") ||
    message.includes("jsonrpc connection")
  );
}

function isMissingTypeHandleError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    message.includes("not found in snapshot registry") || message.includes("empty type handle")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readFileOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}
