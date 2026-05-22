export function isNodeOfType(
  node: { readonly type?: string } | null | undefined,
  type: string,
): boolean {
  return node?.type === type;
}

export function isNodeOfTypes(
  node: { readonly type?: string } | null | undefined,
  types: readonly string[],
): boolean {
  return node?.type !== undefined && types.includes(node.type);
}

export function isNodeOfTypeWithConditions(
  node: { readonly type?: string } | null | undefined,
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): boolean {
  return isNodeOfType(node, type) && matchesConditions(node, conditions);
}

export function isIdentifier(
  node: { readonly type?: string; readonly name?: string } | null | undefined,
  name?: string,
): boolean {
  return node?.type === "Identifier" && (name === undefined || node.name === name);
}

export function isTokenOfTypeWithConditions(
  token: { readonly type?: string } | null | undefined,
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): boolean {
  return isNodeOfType(token, type) && matchesConditions(token, conditions);
}

export function isNotTokenOfTypeWithConditions(
  token: { readonly type?: string } | null | undefined,
  type: string,
  conditions: Readonly<Record<string, unknown>>,
): boolean {
  return !isTokenOfTypeWithConditions(token, type, conditions);
}

export function isFunction(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, [
    "ArrowFunctionExpression",
    "FunctionDeclaration",
    "FunctionExpression",
  ]);
}

export function isFunctionType(node: { readonly type?: string } | null | undefined): boolean {
  return isNodeOfTypes(node, [
    "TSCallSignatureDeclaration",
    "TSConstructSignatureDeclaration",
    "TSConstructorType",
    "TSFunctionType",
  ]);
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
  return node?.type === "MethodDefinition" && node.kind === "set";
}

export const LINEBREAK_MATCHER = /\r\n|[\r\n\u2028\u2029]/u;

const PUNCTUATOR = "Punctuator";
const KEYWORD = "Keyword";

export const isArrowToken = tokenWithValue("=>");
export const isNotArrowToken = not(isArrowToken);
export const isAwaitKeyword = keywordWithValue("await");
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
export const isTypeKeyword = keywordWithValue("type");

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

function tokenWithValue(expected: string) {
  return (token: { readonly type?: string; readonly value?: string } | null | undefined): boolean =>
    token?.type === PUNCTUATOR && token.value === expected;
}

function keywordWithValue(expected: string) {
  return (token: { readonly type?: string; readonly value?: string } | null | undefined): boolean =>
    token?.type === KEYWORD && token.value === expected;
}

function not<T extends readonly unknown[]>(predicate: (...args: T) => boolean) {
  return (...args: T): boolean => !predicate(...args);
}
