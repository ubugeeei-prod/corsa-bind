export type ApiMode = "jsonrpc" | "msgpack";

export interface ApiClientOptions {
  executable: string;
  cwd?: string;
  mode?: ApiMode;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  outboundCapacity?: number;
  allowUnstableUpstreamCalls?: boolean;
  /** Allows trusted projects to execute configured TypeScript content mapper processes. */
  runExternalCode?: boolean;
}

export interface InitializeResponse {
  useCaseSensitiveFileNames: boolean;
  currentDirectory: string;
}

export interface ConfigResponse {
  options: unknown;
  fileNames: string[];
}

export interface ProjectResponse {
  id: string;
  configFileName: string;
  compilerOptions: unknown;
  rootFiles: string[];
}

export type DocumentIdentifier = string | { uri: string };

export interface FileChangeSummary {
  changed?: string[];
  created?: string[];
  deleted?: string[];
}

export type FileChanges =
  | FileChangeSummary
  | {
      invalidateAll: boolean;
    };

export interface UpdateSnapshotParams {
  openProject?: string;
  fileChanges?: FileChanges;
  overlayChanges?: OverlayChanges;
}

export interface UpdateSnapshotResponse {
  snapshot: string;
  projects: ProjectResponse[];
  changes?: unknown;
}

export interface TypeResponse {
  id: string;
  flags: number;
  objectFlags?: number;
  value?: unknown;
  symbol?: string;
  texts: string[];
}

export interface SymbolResponse {
  id: string;
  name: string;
  flags: number;
  checkFlags: number;
  declarations: string[];
  valueDeclaration?: string;
}

export interface CheckerBatchRequest<Params = unknown> {
  method: string;
  params?: Params;
}

export interface CheckerBatchResponse<Result = unknown> {
  method: string;
  result?: Result;
  error?: string;
}

export interface CheckerBatchScope {
  snapshot: string;
  project: string;
}

export type CheckerBatchQuery =
  | {
      key: string;
      kind: "typeAtPosition";
      file: string;
      position: number;
    }
  | {
      key: string;
      kind: "typesAtPositions";
      file: string;
      positions: readonly number[];
    }
  | {
      key: string;
      kind: "symbolAtPosition";
      file: string;
      position: number;
    }
  | {
      key: string;
      kind: "symbolsAtPositions";
      file: string;
      positions: readonly number[];
    }
  | {
      key: string;
      kind: "typeOfSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "typesOfSymbols";
      symbols: readonly string[];
    }
  | {
      key: string;
      kind: "symbolOfType";
      type: string;
    }
  | {
      key: string;
      kind: "declaredTypeOfSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "aliasedSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "immediateAliasedSymbol";
      symbol: string;
    }
  | {
      key: string;
      kind: "exportsOfModule";
      symbol: string;
    }
  | {
      key: string;
      kind: "propertyOfType";
      type: string;
      name: string;
    }
  | {
      key: string;
      kind: "typeArguments";
      type: string;
      objectFlags?: number;
    }
  | {
      key: string;
      kind: "constraintOfType";
      type: string;
    }
  | {
      key: string;
      kind: "isTypeAssignableTo";
      source: string;
      target: string;
    }
  | {
      key: string;
      kind: "typeToString";
      type: string;
      location?: string;
      flags?: number;
    };

export type CheckerBatchResult =
  | TypeResponse
  | Array<TypeResponse | null>
  | SymbolResponse
  | Array<SymbolResponse | null>
  | boolean
  | string
  | null;

export type ResolvedCheckerBatchItem =
  | {
      key: string;
      kind: CheckerBatchQuery["kind"];
      result: CheckerBatchResult;
      error?: never;
    }
  | {
      key: string;
      kind: CheckerBatchQuery["kind"];
      result?: never;
      error: string;
    };

export interface OverlayUpdate {
  document: DocumentIdentifier;
  text: string;
  version?: number;
  languageId?: string;
}

export interface OverlayChanges {
  upsert?: OverlayUpdate[];
  delete?: DocumentIdentifier[];
}

export interface RuntimeCapabilities {
  kind?: string;
  executable?: string;
  transport?: string;
  capabilityEndpoint: boolean;
}

export interface OverlayCapabilities {
  updateSnapshotOverlayChanges: boolean;
}

export interface DiagnosticsCapabilities {
  snapshot: boolean;
  project: boolean;
  file: boolean;
}

export interface EditorCapabilities {
  hover: boolean;
  definition: boolean;
  references: boolean;
  rename: boolean;
  completion: boolean;
}

export interface LspCapabilities {
  available: boolean;
  editor: EditorCapabilities;
}

export interface CapabilitiesResponse {
  runtime: RuntimeCapabilities;
  overlay: OverlayCapabilities;
  diagnostics: DiagnosticsCapabilities;
  /** Editor features available through the active API transport. */
  editor: EditorCapabilities;
  /** Features available by starting the executable as a separate LSP server. */
  lsp: LspCapabilities;
}

export interface FileDiagnosticsResponse {
  file: DocumentIdentifier;
  syntactic: unknown[];
  semantic: unknown[];
  suggestion: unknown[];
}

export interface ProjectDiagnosticsResponse {
  project: string;
  files: FileDiagnosticsResponse[];
}

export interface SnapshotDiagnosticsResponse {
  snapshot: string;
  projects: ProjectDiagnosticsResponse[];
}

export interface UnsafeTypeFlowInput {
  sourceTypeTexts: readonly string[];
  targetTypeTexts?: readonly string[];
}

export interface NativeLintRange {
  start: number;
  end: number;
}

export interface NativeLintNode {
  kind: string;
  range: NativeLintRange;
  text?: string;
  typeTexts?: readonly string[];
  propertyNames?: readonly string[];
  fields?: Record<string, unknown>;
  children?: Record<string, NativeLintNode>;
  childLists?: Record<string, readonly NativeLintNode[]>;
}

export interface NativeLintFix {
  range: NativeLintRange;
  replacementText: string;
}

export interface NativeLintSuggestion {
  messageId: string;
  message: string;
  fixes: readonly NativeLintFix[];
}

export interface NativeLintDiagnostic {
  ruleName: string;
  messageId: string;
  message: string;
  range: NativeLintRange;
  suggestions?: readonly NativeLintSuggestion[];
}

export interface NativeNodeMetadataDepth {
  minDepth: number;
  maxDepth: number;
}

export interface NativeRuleBridgeRequirements {
  maxDepth: number;
  typeTexts?: NativeNodeMetadataDepth;
  propertyNames?: NativeNodeMetadataDepth;
  text?: NativeNodeMetadataDepth;
  /** Whether the host should resolve checker symbol facts (e.g. deprecation). */
  symbolFacts?: boolean;
}

export interface NativeLintRuleMeta {
  name: string;
  docsDescription: string;
  messages: Record<string, string>;
  hasSuggestions: boolean;
  listeners: readonly string[];
  requiresTypeTexts: boolean;
  bridge: NativeRuleBridgeRequirements;
}

export type TypeTextKind =
  | "any"
  | "bigint"
  | "boolean"
  | "nullish"
  | "number"
  | "regexp"
  | "string"
  | "unknown"
  | "other";

export interface VirtualChange {
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  rangeLength?: number;
  text: string;
}

export interface VirtualDocumentState {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}
