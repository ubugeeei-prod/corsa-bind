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
  /**
   * Raw `tsconfig` object as Corsa read it, when the runtime reports one.
   * Top-level settings that are not compiler options — `contentMappers` among
   * them — only exist here.
   */
  raw?: unknown;
}

/** A content mapper as declared in a `tsconfig.json` `contentMappers` entry. */
export interface ContentMapperDefinition {
  /** npm package that implements the mapper. */
  package: string;
  /** Otherwise unsupported file extensions the mapper registers. */
  extensions: string[];
  /** Mapper-specific options forwarded verbatim to the mapper process. */
  options?: unknown;
}

/** `0` verbatim, `1` atom, `2` alias. */
export type SpanMapKind = 0 | 1 | 2;

/** `0` exact, `1` atom, `2` approximate, `3` none. */
export type SpanMapFidelity = 0 | 1 | 2 | 3;

/** `0` ignore, `1` expect. */
export type DiagnosticDirectivePolicy = 0 | 1;

/** Half-open range of UTF-16 code unit offsets. */
export interface TextRange {
  pos: number;
  end: number;
}

/** One half-open virtual range mapped onto one half-open original range. */
export interface SpanMapSegment {
  virtualStart: number;
  virtualEnd: number;
  originalStart: number;
  originalEnd: number;
  kind: SpanMapKind;
  /** `SpanMap.Feature` bitmask; every feature when the mapper set no limit. */
  features: number;
}

/** One projection of a position, with how faithful it is. */
export interface MappedPosition {
  position: number;
  fidelity: SpanMapFidelity;
}

/** One projection of a range, with how faithful it is. */
export interface MappedRange {
  range: TextRange;
  fidelity: SpanMapFidelity;
}

/** A directive controlling TypeScript diagnostics inside a mapped range. */
export interface MappedDiagnosticDirective {
  originalRange: TextRange;
  virtualRange: TextRange;
  policy: DiagnosticDirectivePolicy;
  unusedCode: number;
}

/** Content mapper state attached to one source file. */
export interface ContentMapping {
  /** `name@version` identity of the mapper that produced the file. */
  contentMapper: string;
  /** Filename whose extension decided how the virtual text was parsed. */
  virtualFileName: string;
  /** Mapping between virtual and original positions, in UTF-16 code units. */
  spanMap: SpanMapSegment[];
  /** Directives that control diagnostics inside mapped ranges. */
  diagnosticDirectives: MappedDiagnosticDirective[];
  /** Compiler-assigned filenames of supplemental outputs for this file. */
  supplementalSourceFileNames: string[];
  /** Canonical file this output supplements, when it is a supplemental one. */
  canonicalSourceFileName?: string;
}

/** Source-file fields decoded from a `getSourceFile` payload. */
export interface EncodedSourceFile {
  protocolVersion: number;
  fileName: string;
  path: string;
  /** Text the checker parsed. For a mapped file this is the virtual text. */
  text: string;
  /** Text on disk. Equal to `text` for files no mapper touched. */
  originalText: string;
  languageVariant: number;
  scriptKind: number;
  /** Present only when a content mapper produced this file. */
  contentMapping?: ContentMapping;
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
