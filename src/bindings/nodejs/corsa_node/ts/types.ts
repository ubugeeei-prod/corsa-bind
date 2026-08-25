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
