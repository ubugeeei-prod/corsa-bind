type TypedValue = { readonly type?: string };
type ValueToken = { readonly type?: string; readonly value?: string };
type Predicate<T> = (value: T | null | undefined) => boolean;
type AstNode = Record<string, unknown> & { readonly type?: string };
type StaticValue = { readonly value: unknown } | null;

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

export const findVariable = unsupportedAstUtilsFunction("findVariable");
export const getFunctionHeadLocation = unsupportedAstUtilsFunction("getFunctionHeadLocation");
export const getFunctionNameWithKind = unsupportedAstUtilsFunction("getFunctionNameWithKind");
export const getInnermostScope = unsupportedAstUtilsFunction("getInnermostScope");

export function getPropertyName(node: AstNode | null | undefined): string | null {
  const property = propertyNodeOf(node);
  if (!property) {
    return null;
  }
  if (!isComputedProperty(node) && property.type === "Identifier") {
    return stringField(property, "name");
  }
  if (!isComputedProperty(node) && property.type === "PrivateIdentifier") {
    const name = stringField(property, "name");
    return name == null ? null : `#${name}`;
  }
  const staticValue = getStaticValue(property);
  return staticValue == null ? null : String(staticValue.value);
}

export function getStaticValue(node: AstNode | null | undefined): StaticValue {
  if (!node) {
    return null;
  }
  switch (node.type) {
    case "Literal":
      return { value: (node as { readonly value?: unknown }).value };
    case "TemplateLiteral":
      return staticTemplateValue(node);
    case "UnaryExpression":
      return staticUnaryValue(node);
    case "BinaryExpression":
      return staticBinaryValue(node);
    case "LogicalExpression":
      return staticLogicalValue(node);
    case "ConditionalExpression":
      return staticConditionalValue(node);
    case "ArrayExpression":
      return staticArrayValue(node);
    case "ObjectExpression":
      return staticObjectValue(node);
    default:
      return null;
  }
}

export function getStringIfConstant(node: AstNode | null | undefined): string | null {
  const staticValue = getStaticValue(node);
  return staticValue == null ? null : String(staticValue.value);
}

export function hasSideEffect(node: AstNode | null | undefined): boolean {
  return hasSideEffectNode(node, new WeakSet<object>());
}

function hasSideEffectNode(
  node: AstNode | null | undefined,
  seen: WeakSet<object>,
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
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") {
      continue;
    }
    if (isAstNode(value) && hasSideEffectNode(value, seen)) {
      return true;
    }
    if (
      Array.isArray(value) &&
      value.some((item) => isAstNode(item) && hasSideEffectNode(item, seen))
    ) {
      return true;
    }
  }
  return false;
}

export class PatternMatcher {
  constructor(..._args: unknown[]) {
    throw unsupportedAstUtilsError("PatternMatcher");
  }

  execAll(..._args: unknown[]): never {
    throw unsupportedAstUtilsError("PatternMatcher.execAll");
  }

  test(..._args: unknown[]): never {
    throw unsupportedAstUtilsError("PatternMatcher.test");
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
  return [
    "AssignmentExpression",
    "AwaitExpression",
    "CallExpression",
    "NewExpression",
    "TaggedTemplateExpression",
    "UpdateExpression",
    "YieldExpression",
  ].includes(node.type ?? "");
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
