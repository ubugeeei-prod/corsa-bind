import type { Context, Node, SourceCode } from "@oxlint/plugins";
import type { ApiMode, ConfigResponse, ProjectResponse, TypeResponse } from "@corsa-bind/napi";

export interface CorsaRuntimeOptions {
  executable?: string;
  cwd?: string;
  mode?: ApiMode;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  outboundCapacity?: number;
  allowUnstableUpstreamCalls?: boolean;
  cacheLifetimeMs?: number;
}

export interface ProjectServiceOptions {
  allowDefaultProject?: string[];
  defaultProject?: string;
}

export interface TypeAwareParserOptions {
  project?: string | string[];
  projectService?: boolean | ProjectServiceOptions;
  tsconfigRootDir?: string;
  corsa?: CorsaRuntimeOptions;
}

export interface CorsaOxlintSettings extends TypeAwareParserOptions {
  parserOptions?: TypeAwareParserOptions;
}

export interface CorsaStylisticSettings {
  rules?: Record<string, readonly unknown[]>;
}

export interface ResolvedRuntimeOptions {
  executable: string;
  cwd: string;
  mode: ApiMode;
  cacheLifetimeMs: number;
}

export interface ResolvedProjectConfig {
  filename: string;
  rootDir: string;
  configPath: string;
  runtime: ResolvedRuntimeOptions;
}

export interface CorsaNode {
  readonly id?: string;
  readonly fileName: string;
  readonly pos: number;
  readonly end: number;
  readonly range: readonly [number, number];
}

export interface CorsaSymbol {
  readonly id: string;
  readonly name: string;
  readonly flags: number;
  readonly checkFlags: number;
  readonly declarations: readonly string[];
  readonly valueDeclaration?: string;
}

export interface CorsaSignature {
  readonly id: string;
  readonly flags: number;
  readonly declaration?: string;
  readonly typeParameters: readonly string[];
  readonly parameters: readonly string[];
  readonly parameterSymbols?: readonly CorsaSymbol[];
  readonly parameterTypeTexts?: readonly (readonly string[])[];
  readonly thisParameter?: string;
  readonly thisParameterSymbol?: CorsaSymbol;
  readonly thisParameterTypeTexts?: readonly string[];
  readonly target?: string;
  readonly typeParameterDefaultTexts?: readonly string[];
}

export interface CorsaCallSignatureFacts {
  readonly signature?: CorsaSignature;
  readonly expectedArgumentTypeTexts?: readonly (readonly string[])[];
  readonly explicitTypeArgumentsRequired?: boolean;
}

export enum SignatureKind {
  Call = 0,
  Construct = 1,
}

export interface CorsaTypePredicate {
  readonly kind: number;
  readonly parameterIndex: number;
  readonly parameterName?: string;
  readonly type?: CorsaType;
}

export interface CorsaType extends TypeResponse {
  readonly __corsaOxlintKind: "type";
}

export interface CorsaProgramShape {
  getCompilerOptions(): unknown;
  getCurrentDirectory(): string;
  getRootFileNames(): readonly string[];
  getSourceFile(fileName?: string): {
    readonly fileName: string;
    readonly text: string;
  };
  getTypeChecker(): CorsaTypeCheckerShape;
}

export interface CorsaTypeCheckerShape {
  getTypeAtLocation(node: Node | CorsaNode): CorsaType | undefined;
  getContextualType(node: Node | CorsaNode): CorsaType | undefined;
  getSymbolAtLocation(node: Node | CorsaNode): CorsaSymbol | undefined;
  getSymbol(symbol: string | CorsaSymbol): CorsaSymbol | undefined;
  getSymbolById(id: string): CorsaSymbol | undefined;
  getSymbolOfType(type: CorsaType): CorsaSymbol | undefined;
  getNode(node: string | CorsaNode): CorsaNode | undefined;
  getNodeById(id: string): CorsaNode | undefined;
  getTypeOfSymbol(symbol: CorsaSymbol): CorsaType | undefined;
  getTypeOfSymbolById(id: string): CorsaType | undefined;
  getDeclaredTypeOfSymbol(symbol: CorsaSymbol): CorsaType | undefined;
  getDeclaredTypeOfSymbolById(id: string): CorsaType | undefined;
  getTypeOfSymbolAtLocation(symbol: CorsaSymbol, node: Node | CorsaNode): CorsaType | undefined;
  typeToString(type: CorsaType, enclosingDeclaration?: Node | CorsaNode, flags?: number): string;
  getBaseTypeOfLiteralType(type: CorsaType): CorsaType | undefined;
  getPropertiesOfType(type: CorsaType): readonly CorsaSymbol[];
  getSignaturesOfType(type: CorsaType, kind: SignatureKind): readonly CorsaSignature[];
  getCallSignatureFacts(
    type: CorsaType,
    kind: SignatureKind,
    argumentTypeTexts: readonly (readonly string[])[],
    explicitTypeArgumentTexts: readonly string[],
  ): CorsaCallSignatureFacts;
  getReturnTypeOfSignature(signature: CorsaSignature): CorsaType | undefined;
  getTypePredicateOfSignature(signature: CorsaSignature): CorsaTypePredicate | undefined;
  getBaseTypes(type: CorsaType): readonly CorsaType[];
  getImplementedTypes(node: Node | CorsaNode): readonly CorsaType[];
  getImplementedTypesOfType(type: CorsaType): readonly CorsaType[];
  getTypeArguments(type: CorsaType): readonly CorsaType[];
  getTypesOfType(type: CorsaType): readonly CorsaType[];
  getTargetOfType(type: CorsaType): CorsaType | undefined;
  getTypeParametersOfType(type: CorsaType): readonly CorsaType[];
  getOuterTypeParametersOfType(type: CorsaType): readonly CorsaType[];
  getLocalTypeParametersOfType(type: CorsaType): readonly CorsaType[];
  getObjectTypeOfType(type: CorsaType): CorsaType | undefined;
  getIndexTypeOfType(type: CorsaType): CorsaType | undefined;
  getCheckTypeOfType(type: CorsaType): CorsaType | undefined;
  getExtendsTypeOfType(type: CorsaType): CorsaType | undefined;
  getBaseTypeOfType(type: CorsaType): CorsaType | undefined;
  getConstraintOfType(type: CorsaType): CorsaType | undefined;
  isUnionType(type: CorsaType): boolean;
  isIntersectionType(type: CorsaType): boolean;
}

export interface ParserServices {
  readonly program: CorsaProgramShape;
  readonly esTreeNodeToTSNodeMap: {
    get(node: Node): CorsaNode;
    has(node: Node): boolean;
  };
  readonly tsNodeToESTreeNodeMap: {
    get(node: CorsaNode): Node;
    has(node: CorsaNode): boolean;
  };
  readonly hasFullTypeInformation: boolean;
  getTypeAtLocation(node: Node): CorsaType | undefined;
  getSymbolAtLocation(node: Node): CorsaSymbol | undefined;
}

export type ParserServicesWithTypeInformation = ParserServices & {
  readonly hasFullTypeInformation: true;
};

export type ContextWithParserOptions = Context & {
  readonly filename: string;
  readonly cwd: string;
  readonly sourceCode: SourceCode;
  readonly parserOptions?: TypeAwareParserOptions;
  readonly languageOptions?: {
    readonly parserOptions?: TypeAwareParserOptions;
  };
  readonly settings?: {
    readonly corsaOxlint?: CorsaOxlintSettings;
    readonly corsaStylistic?: CorsaStylisticSettings;
    readonly [key: string]: unknown;
  };
  readonly parserServices?: ParserServices;
};

export interface SessionProjectState {
  readonly config: ConfigResponse;
  readonly project: ProjectResponse;
  readonly snapshot: string;
}

export type { ProjectResponse };
