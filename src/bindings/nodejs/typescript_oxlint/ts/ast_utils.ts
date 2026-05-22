type TypedValue = { readonly type?: string };
type ValueToken = { readonly type?: string; readonly value?: string };
type Predicate<T> = (value: T | null | undefined) => boolean;

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
  token?.type === "Block" || token?.type === "Line";
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

export const ASTUtils = Object.freeze({
  LINEBREAK_MATCHER,
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
