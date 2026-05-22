type TypedValue = { readonly type?: string };
type ValueToken = { readonly type?: string; readonly value?: string };
type Predicate<T> = (value: T | null | undefined) => boolean;
type AstNode = Record<string, unknown> & { readonly type?: string };
type StaticValue = { readonly value: unknown } | null;
type Position = { readonly line: number; readonly column: number };
type SourceLocation = { readonly start: Position; readonly end: Position };
type TokenLike = { readonly type?: string; readonly value?: string; readonly loc?: SourceLocation };
type SourceCodeLike = {
  readonly visitorKeys?: Readonly<Record<string, readonly string[]>>;
  getFirstToken?: (node: unknown, predicate?: (token: TokenLike) => boolean) => TokenLike | null;
  getText?: (node: unknown) => string;
  getTokenAfter?: (node: unknown, predicate?: (token: TokenLike) => boolean) => TokenLike | null;
  getTokenBefore?: (node: unknown, predicate?: (token: TokenLike) => boolean) => TokenLike | null;
};
type ScopeLike = {
  readonly block?: { readonly range?: readonly [number, number] };
  readonly childScopes?: readonly ScopeLike[];
  readonly set?: ReadonlyMap<string, unknown>;
  readonly upper?: ScopeLike | null;
};
type HasSideEffectOptions = {
  readonly considerGetters?: boolean;
  readonly considerImplicitTypeConversion?: boolean;
};

export function isNodeOfType(type: string): Predicate<TypedValue>;
export function isNodeOfType(node: TypedValue | null | undefined, type: string): boolean;
export function isNodeOfType(
  nodeOrType: TypedValue | string | null | undefined,
  maybeType?: string,
): boolean | Predicate<TypedValue> {
  if (typeof nodeOrType === "string" && maybeType === undefined) {
    return (node) => node?.type === nodeOrType;
  }
  return (nodeOrType as TypedValue | null | undefined)?.type === maybeType;
}

export function isNodeOfTypes(types: readonly string[]): Predicate<TypedValue>;
export function isNodeOfTypes(
  node: TypedValue | null | undefined,
  types: readonly string[],
): boolean;
export function isNodeOfTypes(
  nodeOrTypes: TypedValue | readonly string[] | null | undefined,
  maybeTypes?: readonly string[],
): boolean | Predicate<TypedValue> {
  if (Array.isArray(nodeOrTypes) && maybeTypes === undefined) {
    return (node) => node?.type !== undefined && nodeOrTypes.includes(node.type);
  }
  const nodeType = (nodeOrTypes as TypedValue | null | undefined)?.type;
  return nodeType !== undefined && maybeTypes?.includes(nodeType) === true;
}

export function isNodeOfTypeWithConditions(
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): Predicate<TypedValue>;
export function isNodeOfTypeWithConditions(
  node: TypedValue | null | undefined,
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): boolean;
export function isNodeOfTypeWithConditions(
  nodeOrType: TypedValue | string | null | undefined,
  typeOrConditions: string | Readonly<Record<string, unknown>>,
  maybeConditions?: Readonly<Record<string, unknown>>,
): boolean | Predicate<TypedValue> {
  if (typeof nodeOrType === "string") {
    const type = nodeOrType;
    const conditions = typeOrConditions as Readonly<Record<string, unknown>>;
    return (node) => node?.type === type && matchesConditions(node, conditions);
  }
  return (
    nodeOrType?.type === typeOrConditions && matchesConditions(nodeOrType, maybeConditions ?? {})
  );
}

export function isIdentifier(
  node: { readonly type?: string; readonly name?: string } | null | undefined,
  name?: string,
): boolean {
  return node?.type === "Identifier" && (name === undefined || node.name === name);
}

export function isTokenOfTypeWithConditions(
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): Predicate<ValueToken>;
export function isTokenOfTypeWithConditions(
  token: ValueToken | null | undefined,
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): boolean;
export function isTokenOfTypeWithConditions(
  tokenOrType: ValueToken | string | null | undefined,
  typeOrConditions: string | Readonly<Record<string, unknown>>,
  maybeConditions?: Readonly<Record<string, unknown>>,
): boolean | Predicate<ValueToken> {
  if (typeof tokenOrType === "string") {
    const type = tokenOrType;
    const conditions = typeOrConditions as Readonly<Record<string, unknown>>;
    return (token) => token?.type === type && matchesConditions(token, conditions);
  }
  return (
    tokenOrType?.type === typeOrConditions && matchesConditions(tokenOrType, maybeConditions ?? {})
  );
}

export function isNotTokenOfTypeWithConditions(
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): Predicate<ValueToken>;
export function isNotTokenOfTypeWithConditions(
  token: ValueToken | null | undefined,
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): boolean;
export function isNotTokenOfTypeWithConditions(
  tokenOrType: ValueToken | string | null | undefined,
  typeOrConditions: string | Readonly<Record<string, unknown>>,
  maybeConditions?: Readonly<Record<string, unknown>>,
): boolean | Predicate<ValueToken> {
  if (typeof tokenOrType === "string") {
    const predicate = isTokenOfTypeWithConditions(tokenOrType, typeOrConditions as never);
    return (token) => !predicate(token);
  }
  return !isTokenOfTypeWithConditions(
    tokenOrType,
    typeOrConditions as string,
    maybeConditions ?? {},
  );
}

export function isFunction(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, [
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "FunctionExpression",
  ]);
}

export function isFunctionType(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, functionTypeTypes);
}

export function isFunctionOrFunctionType(
  node: { readonly type?: string } | null | undefined,
): boolean {
  return isFunction(node) || isFunctionType(node);
}

export function isTSFunctionType(node: { readonly type?: string } | null | undefined): boolean {
  return node?.type === "TSFunctionType";
}

export function isTSConstructorType(node: { readonly type?: string } | null | undefined): boolean {
  return node?.type === "TSConstructorType";
}

export function isAwaitExpression(node: { readonly type?: string } | null | undefined): boolean {
  return node?.type === "AwaitExpression";
}

export function isVariableDeclarator(node: { readonly type?: string } | null | undefined): boolean {
  return node?.type === "VariableDeclarator";
}

export function isLoop(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, [
    "DoWhileStatement",
    "ForInStatement",
    "ForOfStatement",
    "ForStatement",
    "WhileStatement",
  ]);
}

export function isTypeAssertion(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, ["TSAsExpression", "TSTypeAssertion"]);
}

export function isClassOrTypeElement(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, [
    "PropertyDefinition",
    "FunctionExpression",
    "MethodDefinition",
    "TSAbstractPropertyDefinition",
    "TSAbstractMethodDefinition",
    "TSEmptyBodyFunctionExpression",
    "TSIndexSignature",
    "TSCallSignatureDeclaration",
    "TSConstructSignatureDeclaration",
    "TSMethodSignature",
    "TSPropertySignature",
  ]);
}

export function isOptionalCallExpression(
  node: { readonly type?: string; readonly optional?: boolean } | null | undefined,
): boolean {
  return node?.type === "CallExpression" && node.optional === true;
}

export function isConstructor(
  node: { readonly type?: string; readonly kind?: string } | null | undefined,
): boolean {
  return node?.type === "MethodDefinition" && node.kind === "constructor";
}

export function isSetter(
  node: { readonly type?: string; readonly kind?: string } | null | undefined,
): boolean {
  return (node?.type === "MethodDefinition" || node?.type === "Property") && node.kind === "set";
}

export const LINEBREAK_MATCHER = /\r\n|[\r\n\u2028\u2029]/u;

const IDENTIFIER = "Identifier";
const PUNCTUATOR = "Punctuator";
const KEYWORD = "Keyword";
const functionTypeTypes = [
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSConstructorType",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSFunctionType",
  "TSMethodSignature",
] as const;

export const isArrowToken = tokenWithValue("=>");
export const isNotArrowToken = not(isArrowToken);
export const isAwaitKeyword = tokenWithValue("await", IDENTIFIER);
export const isClosingBraceToken = tokenWithValue("}");
export const isNotClosingBraceToken = not(isClosingBraceToken);
export const isClosingBracketToken = tokenWithValue("]");
export const isNotClosingBracketToken = not(isClosingBracketToken);
export const isClosingParenToken = tokenWithValue(")");
export const isNotClosingParenToken = not(isClosingParenToken);
export const isColonToken = tokenWithValue(":");
export const isNotColonToken = not(isColonToken);
export const isCommaToken = tokenWithValue(",");
export const isNotCommaToken = not(isCommaToken);
export const isCommentToken = (token: { readonly type?: string } | null | undefined): boolean =>
  token?.type === "Block" || token?.type === "Line" || token?.type === "Shebang";
export const isNotCommentToken = not(isCommentToken);
export const isImportKeyword = keywordWithValue("import");
export const isLogicalOrOperator = tokenWithValue("||");
export const isNonNullAssertionPunctuator = tokenWithValue("!");
export const isNotNonNullAssertionPunctuator = not(isNonNullAssertionPunctuator);
export const isOpeningBraceToken = tokenWithValue("{");
export const isNotOpeningBraceToken = not(isOpeningBraceToken);
export const isOpeningBracketToken = tokenWithValue("[");
export const isNotOpeningBracketToken = not(isOpeningBracketToken);
export const isOpeningParenToken = tokenWithValue("(");
export const isNotOpeningParenToken = not(isOpeningParenToken);
export const isOptionalChainPunctuator = tokenWithValue("?.");
export const isNotOptionalChainPunctuator = not(isOptionalChainPunctuator);
export const isSemicolonToken = tokenWithValue(";");
export const isNotSemicolonToken = not(isSemicolonToken);
export const isTypeKeyword = tokenWithValue("type", IDENTIFIER);

export function isTokenOnSameLine(
  left: { readonly loc?: { readonly end?: { readonly line?: number } } },
  right: { readonly loc?: { readonly start?: { readonly line?: number } } },
): boolean {
  return left.loc?.end?.line === right.loc?.start?.line;
}

export function isParenthesized(
  node: { readonly range?: readonly [number, number] },
  sourceCode?: {
    getTokenBefore?: (node: unknown) => { readonly value?: string } | null;
    getTokenAfter?: (node: unknown) => { readonly value?: string } | null;
  },
): boolean {
  if (!node.range || !sourceCode?.getTokenBefore || !sourceCode.getTokenAfter) {
    return false;
  }
  return (
    sourceCode.getTokenBefore(node)?.value === "(" && sourceCode.getTokenAfter(node)?.value === ")"
  );
}

export function getInnermostScope(
  initialScope: ScopeLike | null | undefined,
  node: { readonly range?: readonly [number, number] } | null | undefined,
): ScopeLike | null {
  if (!initialScope) {
    return null;
  }
  if (!node?.range) {
    return initialScope;
  }

  const location = node.range[0];
  let scope = initialScope;
  let found = false;
  do {
    found = false;
    for (const childScope of scope.childScopes ?? []) {
      const range = childScope.block?.range;
      if (range && range[0] <= location && location < range[1]) {
        scope = childScope;
        found = true;
        break;
      }
    }
  } while (found);

  return scope;
}

export function findVariable(
  initialScope: ScopeLike | null | undefined,
  nameOrNode: string | ({ readonly name?: string } & { readonly range?: readonly [number, number] }),
): unknown | null {
  if (!initialScope) {
    return null;
  }

  const name = typeof nameOrNode === "string" ? nameOrNode : nameOrNode.name;
  if (!name) {
    return null;
  }

  let scope: ScopeLike | null = typeof nameOrNode === "string"
    ? initialScope
    : getInnermostScope(initialScope, nameOrNode);
  while (scope) {
    const variable = scope.set?.get(name);
    if (variable != null) {
      return variable;
    }
    scope = scope.upper ?? null;
  }

  return null;
}

export function getFunctionHeadLocation(
  node: AstNode | null | undefined,
  sourceCode?: SourceCodeLike,
): SourceLocation | null {
  if (!node || !sourceCode) {
    return null;
  }

  const parent = parentNodeOf(node);
  let start: Position | undefined;
  let end: Position | undefined;

  if (node.type === "ArrowFunctionExpression") {
    const body = childNode(node, "body");
    const arrowToken = body ? sourceCode.getTokenBefore?.(body, isArrowToken) : null;
    start = arrowToken?.loc?.start;
    end = arrowToken?.loc?.end;
  } else if (
    parent &&
    (parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition")
  ) {
    start = locationOf(parent)?.start;
    end = getOpeningParenOfParams(node, sourceCode)?.loc?.start;
  } else {
    start = locationOf(node)?.start;
    end = getOpeningParenOfParams(node, sourceCode)?.loc?.start;
  }

  return start && end ? { start: { ...start }, end: { ...end } } : null;
}

export function getFunctionNameWithKind(
  node: AstNode | null | undefined,
  sourceCode?: SourceCodeLike,
): string {
  const parent = node ? parentNodeOf(node) : undefined;
  if (!node || !parent) {
    return "";
  }

  const tokens: string[] = [];
  const isObjectMethod = parent.type === "Property" && parent.value === node;
  const isClassMethod = parent.type === "MethodDefinition" && parent.value === node;
  const isClassFieldMethod = parent.type === "PropertyDefinition" && parent.value === node;
  const key = childNode(parent, "key");

  if (isClassMethod || isClassFieldMethod) {
    if (parent.static === true) {
      tokens.push("static");
    }
    if (key?.type === "PrivateIdentifier") {
      tokens.push("private");
    }
  }
  if (node.async === true) {
    tokens.push("async");
  }
  if (node.generator === true) {
    tokens.push("generator");
  }

  if (isObjectMethod || isClassMethod) {
    if (parent.kind === "constructor") {
      return "constructor";
    }
    if (parent.kind === "get") {
      tokens.push("getter");
    } else if (parent.kind === "set") {
      tokens.push("setter");
    } else {
      tokens.push("method");
    }
  } else if (isClassFieldMethod) {
    tokens.push("method");
  } else {
    if (node.type === "ArrowFunctionExpression") {
      tokens.push("arrow");
    }
    tokens.push("function");
  }

  if (isObjectMethod || isClassMethod || isClassFieldMethod) {
    if (key?.type === "PrivateIdentifier") {
      const name = stringField(key, "name");
      if (name) {
        tokens.push(`#${name}`);
      }
    } else {
      const name = getPropertyName(parent);
      if (name) {
        tokens.push(`'${name}'`);
      } else if (sourceCode && key) {
        const keyText = sourceCode.getText?.(key);
        if (keyText && !keyText.includes("\n")) {
          tokens.push(`[${keyText}]`);
        }
      }
    }
  } else {
    const id = childNode(node, "id");
    const variableId = childNode(parent, "id");
    const assignmentLeft = childNode(parent, "left");
    if (id) {
      const name = stringField(id, "name");
      if (name) {
        tokens.push(`'${name}'`);
      }
    } else if (parent.type === "VariableDeclarator" && variableId?.type === "Identifier") {
      const name = stringField(variableId, "name");
      if (name) {
        tokens.push(`'${name}'`);
      }
    } else if (
      (parent.type === "AssignmentExpression" || parent.type === "AssignmentPattern") &&
      assignmentLeft?.type === "Identifier"
    ) {
      const name = stringField(assignmentLeft, "name");
      if (name) {
        tokens.push(`'${name}'`);
      }
    } else if (parent.type === "ExportDefaultDeclaration" && parent.declaration === node) {
      tokens.push("'default'");
    }
  }

  return tokens.join(" ");
}

export function getPropertyName(node: AstNode | null | undefined): string | null {
  if (!node) {
    return null;
  }

  switch (node.type) {
    case "MemberExpression": {
      const property = childNode(node, "property");
      if (!property) {
        return null;
      }
      if (isComputedProperty(node)) {
        return getStringIfConstant(property);
      }
      return property.type === "PrivateIdentifier" ? null : stringField(property, "name");
    }
    case "MethodDefinition":
    case "Property":
    case "PropertyDefinition": {
      const key = childNode(node, "key");
      if (!key) {
        return null;
      }
      if (isComputedProperty(node)) {
        return getStringIfConstant(key);
      }
      if (key.type === "Literal") {
        return String((key as { readonly value?: unknown }).value);
      }
      return key.type === "PrivateIdentifier" ? null : stringField(key, "name");
    }
    default: {
      const property = propertyNodeOf(node);
      if (!property) {
        return null;
      }
      if (!isComputedProperty(node) && property.type === "Identifier") {
        return stringField(property, "name");
      }
      if (!isComputedProperty(node) && property.type === "PrivateIdentifier") {
        return null;
      }
      const staticValue = getStaticValue(property);
      return staticValue == null ? null : String(staticValue.value);
    }
  }
}

export function getStaticValue(node: AstNode | null | undefined): StaticValue {
  if (!node) {
    return null;
  }
  try {
    switch (node.type) {
      case "ArrayExpression":
        return staticArrayValue(node);
      case "BinaryExpression":
        return staticBinaryValue(node);
      case "ChainExpression":
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSTypeAssertion":
        return getStaticValue(childNode(node, "expression"));
      case "ConditionalExpression":
        return staticConditionalValue(node);
      case "Identifier":
        return staticIdentifierValue(node);
      case "Literal":
        return { value: (node as { readonly value?: unknown }).value };
      case "LogicalExpression":
        return staticLogicalValue(node);
      case "ObjectExpression":
        return staticObjectValue(node);
      case "SequenceExpression":
        return staticSequenceValue(node);
      case "TemplateLiteral":
        return staticTemplateValue(node);
      case "UnaryExpression":
        return staticUnaryValue(node);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function getStringIfConstant(node: AstNode | null | undefined): string | null {
  if (node?.type === "Literal" && (node as { readonly value?: unknown }).value === null) {
    const regex = (node as { readonly regex?: { readonly pattern?: string; readonly flags?: string } })
      .regex;
    if (regex?.pattern != null && regex.flags != null) {
      return `/${regex.pattern}/${regex.flags}`;
    }
    const bigint = (node as { readonly bigint?: unknown }).bigint;
    if (typeof bigint === "string") {
      return bigint;
    }
  }
  const staticValue = getStaticValue(node);
  if (staticValue == null) {
    return null;
  }
  try {
    return String(staticValue.value);
  } catch {
    return null;
  }
}

export function hasSideEffect(
  node: AstNode | null | undefined,
  sourceCode?: SourceCodeLike,
  options: HasSideEffectOptions = {},
): boolean {
  return hasSideEffectNode(node, new WeakSet<object>(), sourceCode?.visitorKeys, {
    considerGetters: options.considerGetters === true,
    considerImplicitTypeConversion: options.considerImplicitTypeConversion === true,
  });
}

function hasSideEffectNode(
  node: AstNode | null | undefined,
  seen: WeakSet<object>,
  visitorKeys: Readonly<Record<string, readonly string[]>> | undefined,
  options: Required<HasSideEffectOptions>,
): boolean {
  if (!node) {
    return false;
  }
  if (seen.has(node)) {
    return false;
  }
  seen.add(node);
  if (isSideEffectNode(node)) {
    return true;
  }
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    return false;
  }
  if (isImplicitTypeConversionSideEffectNode(node, options)) {
    return true;
  }
  if (options.considerGetters && node.type === "MemberExpression") {
    return true;
  }
  for (const key of astChildKeys(node, visitorKeys)) {
    const value = node[key];
    if (isAstNode(value) && hasSideEffectNode(value, seen, visitorKeys, options)) {
      return true;
    }
    if (
      Array.isArray(value) &&
      value.some((item) => isAstNode(item) && hasSideEffectNode(item, seen, visitorKeys, options))
    ) {
      return true;
    }
  }
  return false;
}

export class PatternMatcher {
  constructor(pattern: RegExp, options: { readonly escaped?: boolean } = {}) {
    if (!(pattern instanceof RegExp)) {
      throw new TypeError("'pattern' should be a RegExp instance.");
    }
    if (!pattern.flags.includes("g")) {
      throw new Error("'pattern' should contains 'g' flag.");
    }

    patternMatcherInternal.set(this, {
      escaped: options.escaped === true,
      pattern: new RegExp(pattern.source, pattern.flags),
    });
  }

  *execAll(str: string): IterableIterator<RegExpExecArray> {
    const state = patternMatcherInternal.get(this);
    if (!state) {
      return;
    }

    let match: RegExpExecArray | null = null;
    let lastIndex = 0;
    state.pattern.lastIndex = 0;
    while ((match = state.pattern.exec(str)) != null) {
      if (state.escaped || !isEscaped(str, match.index)) {
        lastIndex = state.pattern.lastIndex;
        yield match;
        state.pattern.lastIndex = lastIndex;
      }
    }
  }

  test(str: string): boolean {
    return this.execAll(str).next().done !== true;
  }

  [Symbol.replace](
    str: string,
    replacer: string | ((substring: string, ...args: unknown[]) => string),
  ): string {
    return typeof replacer === "function"
      ? replacePatternWithFunction(this, String(str), replacer)
      : replacePatternWithString(this, String(str), String(replacer));
  }
}

export class ReferenceTracker {
  static readonly READ = Symbol("read");
  static readonly CALL = Symbol("call");
  static readonly CONSTRUCT = Symbol("construct");
  static readonly ESM = Symbol("esm");

  constructor(..._args: unknown[]) {
    throw unsupportedAstUtilsError("ReferenceTracker");
  }

  iterateGlobalReferences(..._args: unknown[]): never {
    throw unsupportedAstUtilsError("ReferenceTracker.iterateGlobalReferences");
  }

  iterateCjsReferences(..._args: unknown[]): never {
    throw unsupportedAstUtilsError("ReferenceTracker.iterateCjsReferences");
  }

  iterateEsmReferences(..._args: unknown[]): never {
    throw unsupportedAstUtilsError("ReferenceTracker.iterateEsmReferences");
  }

  iteratePropertyReferences(..._args: unknown[]): never {
    throw unsupportedAstUtilsError("ReferenceTracker.iteratePropertyReferences");
  }
}

export const ASTUtils = Object.freeze({
  LINEBREAK_MATCHER,
  PatternMatcher,
  ReferenceTracker,
  findVariable,
  getFunctionHeadLocation,
  getFunctionNameWithKind,
  getInnermostScope,
  getPropertyName,
  getStaticValue,
  getStringIfConstant,
  hasSideEffect,
  isIdentifier,
  isArrowToken,
  isAwaitExpression,
  isAwaitKeyword,
  isClosingBraceToken,
  isClosingBracketToken,
  isClosingParenToken,
  isClassOrTypeElement,
  isColonToken,
  isCommaToken,
  isCommentToken,
  isConstructor,
  isFunction,
  isFunctionOrFunctionType,
  isFunctionType,
  isImportKeyword,
  isLogicalOrOperator,
  isLoop,
  isNodeOfType,
  isNodeOfTypes,
  isNodeOfTypeWithConditions,
  isNonNullAssertionPunctuator,
  isNotArrowToken,
  isNotClosingBraceToken,
  isNotClosingBracketToken,
  isNotClosingParenToken,
  isNotColonToken,
  isNotCommaToken,
  isNotCommentToken,
  isNotNonNullAssertionPunctuator,
  isNotOpeningBraceToken,
  isNotOpeningBracketToken,
  isNotOpeningParenToken,
  isNotOptionalChainPunctuator,
  isNotSemicolonToken,
  isNotTokenOfTypeWithConditions,
  isOpeningBraceToken,
  isOpeningBracketToken,
  isOpeningParenToken,
  isOptionalCallExpression,
  isOptionalChainPunctuator,
  isParenthesized,
  isSemicolonToken,
  isSetter,
  isTokenOfTypeWithConditions,
  isTokenOnSameLine,
  isTSConstructorType,
  isTSFunctionType,
  isTypeAssertion,
  isTypeKeyword,
  isVariableDeclarator,
});

function matchesConditions(
  value: { readonly [key: string]: unknown } | null | undefined,
  conditions: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(conditions).every(([key, expected]) => value?.[key] === expected);
}

function propertyNodeOf(node: AstNode | null | undefined): AstNode | undefined {
  if (!node) {
    return undefined;
  }
  const property = node.property ?? node.key;
  return isAstNode(property) ? property : undefined;
}

function isComputedProperty(node: AstNode | null | undefined): boolean {
  return (node as { readonly computed?: boolean } | null | undefined)?.computed === true;
}

function parentNodeOf(node: AstNode): AstNode | undefined {
  const parent = node.parent;
  return isAstNode(parent) ? parent : undefined;
}

function locationOf(node: AstNode): SourceLocation | undefined {
  const loc = node.loc;
  return isSourceLocation(loc) ? loc : undefined;
}

function isSourceLocation(value: unknown): value is SourceLocation {
  return (
    isRecord(value) &&
    isPosition(value.start) &&
    isPosition(value.end)
  );
}

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    typeof value.column === "number"
  );
}

function getOpeningParenOfParams(node: AstNode, sourceCode: SourceCodeLike): TokenLike | null {
  const id = childNode(node, "id");
  return id
    ? sourceCode.getTokenAfter?.(id, isOpeningParenToken) ?? null
    : sourceCode.getFirstToken?.(node, isOpeningParenToken) ?? null;
}

function staticTemplateValue(node: AstNode): StaticValue {
  const quasis = arrayField<AstNode>(node, "quasis");
  const expressions = arrayField<AstNode>(node, "expressions");
  let value = "";
  for (let index = 0; index < quasis.length; index += 1) {
    value += cookedTemplateText(quasis[index]);
    if (index < expressions.length) {
      const expression = getStaticValue(expressions[index]);
      if (expression == null) {
        return null;
      }
      value += String(expression.value);
    }
  }
  return { value };
}

function staticUnaryValue(node: AstNode): StaticValue {
  const argument = getStaticValue(childNode(node, "argument"));
  if (argument == null) {
    return null;
  }
  switch (stringField(node, "operator")) {
    case "-":
      return { value: -(argument.value as number) };
    case "+":
      return { value: +(argument.value as number) };
    case "!":
      return { value: !argument.value };
    case "~":
      return { value: ~(argument.value as number) };
    case "typeof":
      return { value: typeof argument.value };
    case "void":
      return { value: undefined };
    default:
      return null;
  }
}

function staticBinaryValue(node: AstNode): StaticValue {
  const left = getStaticValue(childNode(node, "left"));
  const right = getStaticValue(childNode(node, "right"));
  if (left == null || right == null) {
    return null;
  }
  switch (stringField(node, "operator")) {
    case "==":
      return { value: left.value == right.value };
    case "!=":
      return { value: left.value != right.value };
    case "===":
      return { value: left.value === right.value };
    case "!==":
      return { value: left.value !== right.value };
    case "<":
      return { value: (left.value as number) < (right.value as number) };
    case "<=":
      return { value: (left.value as number) <= (right.value as number) };
    case ">":
      return { value: (left.value as number) > (right.value as number) };
    case ">=":
      return { value: (left.value as number) >= (right.value as number) };
    case "<<":
      return { value: (left.value as number) << (right.value as number) };
    case ">>":
      return { value: (left.value as number) >> (right.value as number) };
    case ">>>":
      return { value: (left.value as number) >>> (right.value as number) };
    case "+":
      return { value: (left.value as any) + (right.value as any) };
    case "-":
      return { value: (left.value as number) - (right.value as number) };
    case "*":
      return { value: (left.value as number) * (right.value as number) };
    case "/":
      return { value: (left.value as number) / (right.value as number) };
    case "%":
      return { value: (left.value as number) % (right.value as number) };
    case "**":
      return { value: (left.value as number) ** (right.value as number) };
    case "|":
      return { value: (left.value as number) | (right.value as number) };
    case "&":
      return { value: (left.value as number) & (right.value as number) };
    case "^":
      return { value: (left.value as number) ^ (right.value as number) };
    default:
      return null;
  }
}

function staticLogicalValue(node: AstNode): StaticValue {
  const left = getStaticValue(childNode(node, "left"));
  if (left == null) {
    return null;
  }
  const operator = stringField(node, "operator");
  if (operator === "&&" && !left.value) {
    return left;
  }
  if (operator === "||" && left.value) {
    return left;
  }
  if (operator === "??" && left.value != null) {
    return left;
  }
  return getStaticValue(childNode(node, "right"));
}

function staticConditionalValue(node: AstNode): StaticValue {
  const test = getStaticValue(childNode(node, "test"));
  if (test == null) {
    return null;
  }
  return getStaticValue(childNode(node, test.value ? "consequent" : "alternate"));
}

function staticArrayValue(node: AstNode): StaticValue {
  const values = [];
  for (const element of arrayField<AstNode | null>(node, "elements")) {
    if (element == null) {
      values.push(undefined);
      continue;
    }
    if (element.type === "SpreadElement") {
      return null;
    }
    const item = getStaticValue(element);
    if (item == null) {
      return null;
    }
    values.push(item.value);
  }
  return { value: values };
}

function staticObjectValue(node: AstNode): StaticValue {
  const value: Record<string, unknown> = {};
  for (const property of arrayField<AstNode>(node, "properties")) {
    if (property.type === "SpreadElement") {
      const argument = getStaticValue(childNode(property, "argument"));
      if (argument == null || !isRecord(argument.value)) {
        return null;
      }
      Object.assign(value, argument.value);
      continue;
    }
    if (property.kind != null && property.kind !== "init") {
      return null;
    }
    const name = getPropertyName(property);
    const propertyValue = getStaticValue(childNode(property, "value"));
    if (name == null || propertyValue == null) {
      return null;
    }
    value[name] = propertyValue.value;
  }
  return { value };
}

function staticSequenceValue(node: AstNode): StaticValue {
  const expressions = arrayField<AstNode>(node, "expressions");
  const last = expressions.at(-1);
  return last ? getStaticValue(last) : null;
}

function staticIdentifierValue(node: AstNode): StaticValue {
  switch (stringField(node, "name")) {
    case "Infinity":
      return { value: Infinity };
    case "NaN":
      return { value: NaN };
    case "undefined":
      return { value: undefined };
    default:
      return null;
  }
}

function cookedTemplateText(node: AstNode | undefined): string {
  const value = node?.value;
  if (isRecord(value) && typeof value.cooked === "string") {
    return value.cooked;
  }
  return "";
}

function childNode(node: AstNode, key: string): AstNode | undefined {
  const value = node[key];
  return isAstNode(value) ? value : undefined;
}

function arrayField<T>(node: AstNode, key: string): T[] {
  const value = node[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

function stringField(node: AstNode, key: string): string | null {
  const value = node[key];
  return typeof value === "string" ? value : null;
}

function isAstNode(value: unknown): value is AstNode {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSideEffectNode(node: AstNode): boolean {
  if (
    node.type === "AssignmentExpression" ||
    node.type === "AwaitExpression" ||
    node.type === "CallExpression" ||
    node.type === "ImportExpression" ||
    node.type === "NewExpression" ||
    node.type === "UpdateExpression" ||
    node.type === "YieldExpression"
  ) {
    return true;
  }
  return node.type === "UnaryExpression" && stringField(node, "operator") === "delete";
}

const typeConversionBinaryOps = new Set([
  "==",
  "!=",
  "<",
  "<=",
  ">",
  ">=",
  "<<",
  ">>",
  ">>>",
  "+",
  "-",
  "*",
  "/",
  "%",
  "|",
  "^",
  "&",
  "in",
]);
const typeConversionUnaryOps = new Set(["-", "+", "!", "~"]);
const skippedAstChildKeys = new Set([
  "comments",
  "loc",
  "parent",
  "range",
  "tokens",
]);

function isImplicitTypeConversionSideEffectNode(
  node: AstNode,
  options: Required<HasSideEffectOptions>,
): boolean {
  if (!options.considerImplicitTypeConversion) {
    return false;
  }

  if (
    node.type === "BinaryExpression" &&
    typeConversionBinaryOps.has(stringField(node, "operator") ?? "")
  ) {
    return childNode(node, "left")?.type !== "Literal" || childNode(node, "right")?.type !== "Literal";
  }

  if (
    (node.type === "MemberExpression" ||
      node.type === "MethodDefinition" ||
      node.type === "Property" ||
      node.type === "PropertyDefinition") &&
    isComputedProperty(node)
  ) {
    return childNode(node, node.type === "MemberExpression" ? "property" : "key")?.type !== "Literal";
  }

  return (
    node.type === "UnaryExpression" &&
    typeConversionUnaryOps.has(stringField(node, "operator") ?? "") &&
    childNode(node, "argument")?.type !== "Literal"
  );
}

function astChildKeys(
  node: AstNode,
  visitorKeys: Readonly<Record<string, readonly string[]>> | undefined,
): readonly string[] {
  const configured = node.type ? visitorKeys?.[node.type] : undefined;
  if (configured) {
    return configured;
  }
  return Object.keys(node).filter((key) => !skippedAstChildKeys.has(key));
}

const patternMatcherInternal = new WeakMap<
  PatternMatcher,
  { readonly escaped: boolean; readonly pattern: RegExp }
>();
const replacementPlaceholder = /\$(?:[$&`']|[1-9][0-9]?)/gu;

function isEscaped(str: string, index: number): boolean {
  let escaped = false;
  for (let cursor = index - 1; cursor >= 0 && str.charCodeAt(cursor) === 0x5c; cursor -= 1) {
    escaped = !escaped;
  }
  return escaped;
}

function replacePatternWithString(
  matcher: PatternMatcher,
  str: string,
  replacement: string,
): string {
  const chunks: string[] = [];
  let index = 0;

  for (const match of matcher.execAll(str)) {
    chunks.push(str.slice(index, match.index));
    chunks.push(
      replacement.replace(replacementPlaceholder, (key) =>
        replacementForPlaceholder(key, str, match),
      ),
    );
    index = match.index + match[0].length;
  }
  chunks.push(str.slice(index));

  return chunks.join("");
}

function replacementForPlaceholder(key: string, str: string, match: RegExpExecArray): string {
  switch (key) {
    case "$$":
      return "$";
    case "$&":
      return match[0];
    case "$`":
      return str.slice(0, match.index);
    case "$'":
      return str.slice(match.index + match[0].length);
    default: {
      const index = Number(key.slice(1));
      const capture = Number.isNaN(index) ? undefined : match[index];
      return capture ?? key;
    }
  }
}

function replacePatternWithFunction(
  matcher: PatternMatcher,
  str: string,
  replace: (substring: string, ...args: unknown[]) => string,
): string {
  const chunks: string[] = [];
  let index = 0;

  for (const match of matcher.execAll(str)) {
    chunks.push(str.slice(index, match.index));
    chunks.push(String(replace(...match, match.index, match.input)));
    index = match.index + match[0].length;
  }
  chunks.push(str.slice(index));

  return chunks.join("");
}

function tokenWithValue(expected: string, type = PUNCTUATOR) {
  return (token: { readonly type?: string; readonly value?: string } | null | undefined): boolean =>
    token?.type === type && token.value === expected;
}

function keywordWithValue(expected: string) {
  return (token: { readonly type?: string; readonly value?: string } | null | undefined): boolean =>
    token?.type === KEYWORD && token.value === expected;
}

function not<T extends readonly unknown[]>(predicate: (...args: T) => boolean) {
  return (...args: T): boolean => !predicate(...args);
}

function unsupportedAstUtilsFunction(name: string): (...args: unknown[]) => never {
  return (..._args: unknown[]): never => {
    throw unsupportedAstUtilsError(name);
  };
}

function unsupportedAstUtilsError(name: string): Error {
  return new Error(
    `ASTUtils.${name} is not supported by corsa-oxlint because it depends on ESLint SourceCode or scope internals.`,
  );
}
