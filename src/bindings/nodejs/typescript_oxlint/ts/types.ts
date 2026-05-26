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

export type TsgoRuntimeOptions = CorsaRuntimeOptions;

export interface ProjectServiceOptions {
  allowDefaultProject?: string[];
  defaultProject?: string;
}

export interface TypeAwareParserOptions {
  project?: string | string[];
  projectService?: boolean | ProjectServiceOptions;
  tsconfigRootDir?: string;
  corsa?: CorsaRuntimeOptions;
  tsgo?: TsgoRuntimeOptions;
}

export interface TypescriptOxlintSettings extends TypeAwareParserOptions {
  parserOptions?: TypeAwareParserOptions;
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

export interface TsgoNode {
  readonly id?: string;
  readonly fileName: string;
  readonly pos: number;
  readonly end: number;
  readonly range: readonly [number, number];
}

export interface TsgoSymbol {
  readonly id: string;
  readonly name: string;
  readonly flags: number;
  readonly checkFlags: number;
  readonly declarations: readonly string[];
  readonly valueDeclaration?: string;
}

export interface TsgoSignature {
  readonly id: string;
  readonly flags: number;
  readonly declaration?: string;
  readonly typeParameters: readonly string[];
  readonly parameters: readonly string[];
  readonly thisParameter?: string;
  readonly target?: string;
}

export interface TsgoTypePredicate {
  readonly kind: number;
  readonly parameterIndex: number;
  readonly parameterName?: string;
  readonly type?: TsgoType;
}

export interface TsgoType extends TypeResponse {
  readonly __typescriptOxlintKind: "type";
}

export interface TsgoProgramShape {
  getCompilerOptions(): unknown;
  getCurrentDirectory(): string;
  getRootFileNames(): readonly string[];
  getSourceFile(fileName?: string): {
    readonly fileName: string;
    readonly text: string;
  };
  getTypeChecker(): TsgoTypeCheckerShape;
}

export interface TsgoTypeCheckerShape {
  getTypeAtLocation(node: Node | TsgoNode): TsgoType | undefined;
  getContextualType(node: Node | TsgoNode): TsgoType | undefined;
  getSymbolAtLocation(node: Node | TsgoNode): TsgoSymbol | undefined;
  getSymbol(symbol: string | TsgoSymbol): TsgoSymbol | undefined;
  getSymbolById(id: string): TsgoSymbol | undefined;
  getNode(node: string | TsgoNode): TsgoNode | undefined;
  getNodeById(id: string): TsgoNode | undefined;
  getTypeOfSymbol(symbol: TsgoSymbol): TsgoType | undefined;
  getDeclaredTypeOfSymbol(symbol: TsgoSymbol): TsgoType | undefined;
  getTypeOfSymbolAtLocation(symbol: TsgoSymbol, node: Node | TsgoNode): TsgoType | undefined;
  typeToString(type: TsgoType, enclosingDeclaration?: Node | TsgoNode, flags?: number): string;
  getBaseTypeOfLiteralType(type: TsgoType): TsgoType | undefined;
  getPropertiesOfType(type: TsgoType): readonly TsgoSymbol[];
  getSignaturesOfType(type: TsgoType, kind: number): readonly TsgoSignature[];
  getReturnTypeOfSignature(signature: TsgoSignature): TsgoType | undefined;
  getTypePredicateOfSignature(signature: TsgoSignature): TsgoTypePredicate | undefined;
  getBaseTypes(type: TsgoType): readonly TsgoType[];
  getImplementedTypes(node: Node | TsgoNode): readonly TsgoType[];
  getTypeArguments(type: TsgoType): readonly TsgoType[];
  getTypesOfType(type: TsgoType): readonly TsgoType[];
  getTargetOfType(type: TsgoType): TsgoType | undefined;
  getTypeParametersOfType(type: TsgoType): readonly TsgoType[];
  getOuterTypeParametersOfType(type: TsgoType): readonly TsgoType[];
  getLocalTypeParametersOfType(type: TsgoType): readonly TsgoType[];
  getObjectTypeOfType(type: TsgoType): TsgoType | undefined;
  getIndexTypeOfType(type: TsgoType): TsgoType | undefined;
  getCheckTypeOfType(type: TsgoType): TsgoType | undefined;
  getExtendsTypeOfType(type: TsgoType): TsgoType | undefined;
  getBaseTypeOfType(type: TsgoType): TsgoType | undefined;
  getConstraintOfType(type: TsgoType): TsgoType | undefined;
  isUnionType(type: TsgoType): boolean;
  isIntersectionType(type: TsgoType): boolean;
}

export interface ParserServices {
  readonly program: TsgoProgramShape;
  readonly esTreeNodeToTSNodeMap: {
    get(node: Node): TsgoNode;
    has(node: Node): boolean;
  };
  readonly tsNodeToESTreeNodeMap: {
    get(node: TsgoNode): Node;
    has(node: TsgoNode): boolean;
  };
  readonly hasFullTypeInformation: boolean;
  getTypeAtLocation(node: Node): TsgoType | undefined;
  getSymbolAtLocation(node: Node): TsgoSymbol | undefined;
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
    readonly typescriptOxlint?: TypescriptOxlintSettings;
    readonly [key: string]: unknown;
  };
  readonly parserServices?: ParserServices;
};

export interface SessionProjectState {
  readonly config: ConfigResponse;
  readonly project: ProjectResponse;
  readonly snapshot: string;
}

export type CorsaNode = TsgoNode;
export type CorsaProgramShape = TsgoProgramShape;
export type CorsaRuntimeShape = CorsaRuntimeOptions;
export type CorsaSignature = TsgoSignature;
export type CorsaSymbol = TsgoSymbol;
export type CorsaType = TsgoType;
export type CorsaTypeCheckerShape = TsgoTypeCheckerShape;
export type CorsaTypePredicate = TsgoTypePredicate;

export type { ProjectResponse };
