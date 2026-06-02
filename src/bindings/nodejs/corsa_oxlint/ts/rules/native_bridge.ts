import { readFileSync } from "node:fs";

import { nativeLintRuleMetas, runNativeLintRule } from "@corsa-bind/napi";
import type {
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRange,
  NativeLintRuleMeta,
  NativeNodeMetadataDepth,
} from "@corsa-bind/napi";

import { createNativeRule } from "./rule_creator";
import { checkerFor, propertyNamesOfNode, typeAtNode, typeTextsAtNode } from "./type_utils";
import type {
  ContextWithParserOptions,
  CorsaNode,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypeCheckerShape,
} from "../types";

type RangedNode = {
  readonly type: string;
  readonly range: readonly [number, number];
};

type NativeRuleBridgeOptions = {
  readonly shouldRun?: (node: RangedNode, context: ContextWithParserOptions) => boolean;
  readonly includeTypeTexts?: NodeMetadataOption;
  readonly includePropertyNames?: NodeMetadataOption;
  readonly includeText?: NodeMetadataOption;
  readonly maxDepth?: number;
};

type NodeMetadataOption = boolean | ((node: RangedNode, depth: number) => boolean);

const MAX_NATIVE_NODE_DEPTH = 4;
const nativeRuleMetasByName = new Map(nativeLintRuleMetas().map((meta) => [meta.name, meta]));

export function createRustNativeRule(
  ruleName: string,
  metaOverrides: Record<string, unknown> = {},
  bridgeOptions: NativeRuleBridgeOptions = {},
) {
  const meta = nativeRuleMeta(ruleName);
  return createNativeRule(
    ruleName,
    {
      docs: {
        description: meta.docsDescription,
      },
      hasSuggestions: meta.hasSuggestions,
      messages: meta.messages,
      ...metaOverrides,
    },
    (context) =>
      Object.fromEntries(
        meta.listeners.map((listener) => [
          listener,
          (node: RangedNode) => {
            if (bridgeOptions.shouldRun?.(node, context) === false) {
              return;
            }
            const includeTypeTexts = includeTypeTextsOption(bridgeOptions, meta);
            const includeText = includeTextOption(bridgeOptions, meta);
            reportNativeDiagnostics(
              context,
              node,
              runNativeLintRule(
                ruleName,
                toNativeNode(
                  context,
                  node,
                  includeTypeTexts,
                  maxDepthOption(bridgeOptions, meta),
                  true,
                  includePropertyNamesOption(bridgeOptions, meta),
                  includeText,
                ),
              ),
            );
          },
        ]),
      ),
  );
}

export function toNativeNode(
  context: ContextWithParserOptions,
  node: RangedNode,
  includeTypeTexts: NodeMetadataOption = true,
  maxDepth = MAX_NATIVE_NODE_DEPTH,
  includeRuleOptions = true,
  includePropertyNames: NodeMetadataOption = includeTypeTexts,
  includeText: NodeMetadataOption = false,
  depth = 0,
): NativeLintNode {
  const fields: Record<string, unknown> = {};
  const children: Record<string, NativeLintNode> = {};
  const childLists: Record<string, NativeLintNode[]> = {};

  for (const [key, value] of Object.entries(node)) {
    if (isSkippedField(key)) {
      continue;
    }
    if (isNativeChildNode(value)) {
      if (maxDepth > 0) {
        children[key] = toNativeNode(
          context,
          value,
          includeTypeTexts,
          maxDepth - 1,
          false,
          includePropertyNames,
          includeText,
          depth + 1,
        );
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (maxDepth > 0 && value.every(isNativeChildNode)) {
        childLists[key] = value.map((child) =>
          toNativeNode(
            context,
            child,
            includeTypeTexts,
            maxDepth - 1,
            false,
            includePropertyNames,
            includeText,
            depth + 1,
          ),
        );
      } else if (value.every(isJsonPrimitive)) {
        fields[key] = value;
      }
      continue;
    }
    if (isPrimitiveRecord(value)) {
      fields[key] = value;
      continue;
    }
    if (isJsonPrimitive(value)) {
      fields[key] = value;
    }
  }

  const typeAnnotationText = sourceTypeAnnotationText(context, node);
  if (typeAnnotationText) {
    fields.__typeAnnotationText = typeAnnotationText;
  }

  const options = (context as { options?: unknown }).options;
  if (includeRuleOptions && Array.isArray(options) && options.length > 0 && isJsonValue(options)) {
    fields.__ruleOptions = options;
  }
  if (includeRuleOptions) {
    addHostFacts(context, node, fields);
  }

  const nativeNode: NativeLintNode = {
    kind: node.type,
    range: nativeRange(node.range),
  };
  if (includeMetadataForNode(includeText, node, depth)) {
    nativeNode.text = context.sourceCode.getText(node as never);
  }
  if (includeMetadataForNode(includeTypeTexts, node, depth)) {
    nativeNode.typeTexts = typeTextsAtNode(context, node);
  }
  if (includeMetadataForNode(includePropertyNames, node, depth)) {
    nativeNode.propertyNames = propertyNamesOfNode(context, node);
  }
  if (Object.keys(fields).length > 0) {
    nativeNode.fields = fields;
  }
  if (Object.keys(children).length > 0) {
    nativeNode.children = children;
  }
  if (Object.keys(childLists).length > 0) {
    nativeNode.childLists = childLists;
  }
  return nativeNode;
}

export function reportNativeDiagnostics(
  context: ContextWithParserOptions,
  node: RangedNode,
  diagnostics: readonly NativeLintDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    context.report({
      node: reportNodeForRange(node, diagnostic.range),
      messageId: diagnostic.messageId,
      ...(diagnostic.suggestions?.length
        ? {
            suggest: diagnostic.suggestions.map((suggestion) => ({
              messageId: suggestion.messageId,
              fix: (fixer: any) =>
                suggestion.fixes.map((fix) =>
                  fixer.replaceTextRange(oxlintRange(fix.range), fix.replacementText),
                ),
            })),
          }
        : {}),
    } as never);
  }
}

function reportNodeForRange(root: RangedNode, range: NativeLintRange): RangedNode {
  return findNodeByRange(root, range) ?? root;
}

function findNodeByRange(
  value: unknown,
  range: NativeLintRange,
  seen = new Set<object>(),
): RangedNode | undefined {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (isNativeChildNode(value) && sameRange(value.range, range)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findNodeByRange(item, range, seen);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isSkippedField(key)) {
      continue;
    }
    const match = findNodeByRange(child, range, seen);
    if (match) {
      return match;
    }
  }
  return undefined;
}

function nativeRuleMeta(ruleName: string): NativeLintRuleMeta {
  const meta = nativeRuleMetasByName.get(ruleName);
  if (!meta) {
    throw new Error(`corsa oxlint native Rust rule is not registered: ${ruleName}`);
  }
  return meta;
}

function includeTypeTextsOption(
  options: NativeRuleBridgeOptions,
  meta: NativeLintRuleMeta,
): NodeMetadataOption {
  return options.includeTypeTexts ?? nodeMetadataDepthOption(meta.bridge.typeTexts, false);
}

function includePropertyNamesOption(
  options: NativeRuleBridgeOptions,
  meta: NativeLintRuleMeta,
): NodeMetadataOption {
  return options.includePropertyNames ?? nodeMetadataDepthOption(meta.bridge.propertyNames, false);
}

function includeTextOption(
  options: NativeRuleBridgeOptions,
  meta: NativeLintRuleMeta,
): NodeMetadataOption {
  return options.includeText ?? nodeMetadataDepthOption(meta.bridge.text, false);
}

function maxDepthOption(options: NativeRuleBridgeOptions, meta: NativeLintRuleMeta): number {
  return options.maxDepth ?? meta.bridge.maxDepth ?? MAX_NATIVE_NODE_DEPTH;
}

function nodeMetadataDepthOption(
  metadata: NativeNodeMetadataDepth | undefined,
  fallback: NodeMetadataOption,
): NodeMetadataOption {
  if (!metadata) {
    return fallback;
  }
  return (_node, depth) => depth >= metadata.minDepth && depth <= metadata.maxDepth;
}

function includeMetadataForNode(
  option: NodeMetadataOption,
  node: RangedNode,
  depth: number,
): boolean {
  return typeof option === "function" ? option(node, depth) : option;
}

function sourceTypeAnnotationText(
  context: ContextWithParserOptions,
  node: RangedNode,
): string | undefined {
  const annotation = (node as any).typeAnnotation?.typeAnnotation ?? (node as any).typeAnnotation;
  if (!annotation) {
    return undefined;
  }
  const text = (context as any).sourceCode?.getText(annotation);
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function nativeRange(range: readonly [number, number]): NativeLintRange {
  return { start: range[0], end: range[1] };
}

function oxlintRange(range: NativeLintRange): [number, number] {
  return [range.start, range.end];
}

function sameRange(range: readonly [number, number], expected: NativeLintRange): boolean {
  return range[0] === expected.start && range[1] === expected.end;
}

function addHostFacts(
  context: ContextWithParserOptions,
  node: RangedNode,
  fields: Record<string, unknown>,
): void {
  const current = node as any;
  if (current.type === "ExpressionStatement") {
    fields.__nearestFunctionAsync = nearestFunctionAncestor(context, current)?.async === true;
  }
  if (current.type === "CallExpression" && isPromiseExecutorRejectCall(context, current)) {
    fields.__promiseExecutorRejectCall = true;
  }
  if (current.type === "CallExpression" || current.type === "NewExpression") {
    const expectedArgumentTypeTexts = expectedArgumentTypeTextsOfCall(context, current);
    if (expectedArgumentTypeTexts.length > 0) {
      fields.__expectedArgumentTypeTexts = expectedArgumentTypeTexts;
    }
    if (hasUnnecessaryExplicitTypeArguments(context, current)) {
      fields.__explicitTypeArgumentsRequired = false;
    }
  }
  if (current.parent?.type) {
    fields.__parentKind = current.parent.type;
  }
  if (
    (current.type === "Identifier" || current.type === "MemberExpression") &&
    isDeprecatedSymbolUse(context, current)
  ) {
    fields.__deprecated = true;
  }
  if (
    current.type === "TSTypeParameterDeclaration" &&
    hasSingleUseTypeParameter(context, current)
  ) {
    fields.__hasSingleUseTypeParameter = true;
  }
  if (current.type === "ReturnStatement") {
    const returnTypeTexts = returnTypeTextsOfNearestFunction(context, current);
    if (returnTypeTexts.length > 0) {
      fields.__returnTypeTexts = returnTypeTexts;
    }
    if (returnAwaitRequiresAwait(context, current)) {
      fields.__returnAwaitRequiresAwait = true;
    }
  }
  if (isFunctionLike(current)) {
    const returnTypeTexts = returnTypeTextsOfFunction(context, current);
    if (returnTypeTexts.length > 0) {
      fields.__returnTypeTexts = returnTypeTexts;
    }
    const nearestClass = nearestClassAncestor(context, current);
    const className = nearestClass?.id?.name;
    if (typeof className === "string" && className.length > 0) {
      fields.__nearestClassName = className;
    }
  }
  if (current.type === "ArrowFunctionExpression" && current.body?.type !== "BlockStatement") {
    const returnTypeTexts = returnTypeTextsOfFunction(context, current);
    if (returnTypeTexts.length > 0) {
      fields.__returnTypeTexts = returnTypeTexts;
    }
  }
}

function expectedArgumentTypeTextsOfCall(
  context: ContextWithParserOptions,
  node: any,
): readonly (readonly string[])[] {
  const callee = stripChainExpression(node.callee);
  if (!callee) {
    return [];
  }
  const calleeType = typeAtNode(context, callee);
  if (!calleeType) {
    return [];
  }
  const signature = signatureForCall(context, node, calleeType);
  const parameters = signatureParameters(signature);
  if (parameters.length === 0) {
    return [];
  }
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  return args.map((_arg: unknown, index: number) => {
    const parameterId = parameters[Math.min(index, parameters.length - 1)];
    return parameterId ? parameterTypeTexts(context, parameterId) : [];
  });
}

function hasUnnecessaryExplicitTypeArguments(
  context: ContextWithParserOptions,
  node: any,
): boolean {
  const explicitTypeArguments = typeArgumentNodes(node);
  if (explicitTypeArguments.length === 0) {
    return false;
  }
  const callee = stripChainExpression(node.callee);
  const calleeType = callee ? typeAtNode(context, callee) : undefined;
  const signature = calleeType ? signatureForCall(context, node, calleeType) : undefined;
  const defaultTypeArguments = signature
    ? defaultTypeArgumentTextsForSignature(context, signature)
    : [];
  if (defaultTypeArguments.length === 0) {
    return false;
  }
  return explicitTypeArguments.every((typeArgument, index) => {
    const defaultTypeArgument = defaultTypeArguments[index];
    if (!defaultTypeArgument) {
      return false;
    }
    const explicit = normalizeTypeText(context.sourceCode.getText(typeArgument));
    return normalizeTypeText(defaultTypeArgument) === explicit;
  });
}

function typeArgumentNodes(node: any): readonly any[] {
  const candidates = [
    node.typeArguments?.params,
    node.typeParameters?.params,
    node.typeParameterInstantiation?.params,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function signatureForCall(
  context: ContextWithParserOptions,
  node: any,
  calleeType: CorsaType,
): CorsaSignature | undefined {
  const checker = checkerFor(context);
  const signatures = checker.getSignaturesOfType(calleeType, node.type === "NewExpression" ? 1 : 0);
  if (signatures.length <= 1) {
    return signatures[0];
  }
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  return signatures
    .map((signature) => ({
      signature,
      score: scoreSignatureForArguments(context, signature, args),
    }))
    .sort((left, right) => right.score - left.score)[0]?.signature;
}

function scoreSignatureForArguments(
  context: ContextWithParserOptions,
  signature: CorsaSignature,
  args: readonly any[],
): number {
  const parameterTypes = signatureParameters(signature).map((parameterId) =>
    parameterTypeTexts(context, parameterId),
  );
  let score = -Math.abs(args.length - parameterTypes.length);
  for (const [index, arg] of args.entries()) {
    const expected = parameterTypes[Math.min(index, parameterTypes.length - 1)] ?? [];
    const actual = typeTextsAtNode(context, arg);
    if (expected.length === 0) {
      score -= 2;
    } else if (isPermissiveTypeTexts(expected)) {
      score += 1;
    } else if (typeTextsOverlap(actual, expected)) {
      score += 4;
    } else {
      score -= 1;
    }
  }
  return score;
}

function signatureParameters(signature: CorsaSignature | undefined): readonly string[] {
  return Array.isArray(signature?.parameters) ? signature.parameters : [];
}

function parameterTypeTexts(
  context: ContextWithParserOptions,
  parameterId: string,
): readonly string[] {
  const checker = checkerFor(context);
  const parameterSymbol = checker.getSymbol(parameterId);
  const declaration = parameterSymbol ? declarationForSymbol(checker, parameterSymbol) : undefined;
  const parameterType =
    (parameterSymbol && declaration
      ? checker.getTypeOfSymbolAtLocation(parameterSymbol, declaration)
      : undefined) ??
    (parameterSymbol ? checker.getTypeOfSymbol(parameterSymbol) : undefined) ??
    (parameterSymbol ? checker.getDeclaredTypeOfSymbol(parameterSymbol) : undefined) ??
    checker.getTypeOfSymbolById(parameterId) ??
    checker.getDeclaredTypeOfSymbolById(parameterId);
  return parameterType ? renderTypeTexts(context, parameterType) : [];
}

function declarationForSymbol(
  checker: CorsaTypeCheckerShape,
  symbol: CorsaSymbol,
): CorsaNode | undefined {
  const valueDeclaration = symbol.valueDeclaration;
  const firstDeclaration = symbol.declarations?.[0];
  return (
    (valueDeclaration ? checker.getNode(valueDeclaration) : undefined) ??
    (firstDeclaration ? checker.getNode(firstDeclaration) : undefined)
  );
}

function typeTextsOverlap(actual: readonly string[], expected: readonly string[]): boolean {
  const normalizedExpected = expected.map(normalizeTypeText);
  return actual.some((actualText) => {
    const normalizedActual = normalizeTypeText(actualText);
    return normalizedExpected.some(
      (expectedText) =>
        expectedText === normalizedActual ||
        expectedText.includes(normalizedActual) ||
        normalizedActual.includes(expectedText),
    );
  });
}

function defaultTypeArgumentTextsForSignature(
  context: ContextWithParserOptions,
  signature: CorsaSignature,
): readonly string[] {
  const declarationText = declarationTextForHandle(context, signature.declaration);
  if (!declarationText) {
    return [];
  }
  return typeParameterDefaultTexts(declarationText);
}

function declarationTextForHandle(
  context: ContextWithParserOptions,
  handleText: string | undefined,
): string | undefined {
  if (!handleText) {
    return undefined;
  }
  const handle = parseNodeHandle(handleText);
  if (!handle) {
    return undefined;
  }
  const sourceText = sourceTextForPath(context, handle.path);
  if (!sourceText || handle.pos < 0 || handle.end > sourceText.length || handle.pos >= handle.end) {
    return undefined;
  }
  return sourceText.slice(handle.pos, handle.end);
}

function typeParameterDefaultTexts(declarationText: string): readonly string[] {
  const parametersText = firstDelimitedText(declarationText, "<", ">");
  if (!parametersText) {
    return [];
  }
  return splitTopLevel(parametersText, ",").map((parameterText) => {
    const defaultStart = topLevelIndexOf(parameterText, "=");
    return defaultStart >= 0 ? parameterText.slice(defaultStart + 1).trim() : "";
  });
}

function firstDelimitedText(text: string, open: string, close: string): string | undefined {
  const start = text.indexOf(open);
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start + 1, index);
      }
    }
  }
  return undefined;
}

function splitTopLevel(text: string, delimiter: string): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (
      char === delimiter &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function topLevelIndexOf(text: string, needle: string): number {
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (
      char === needle &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }
  }
  return -1;
}

function isDeprecatedSymbolUse(context: ContextWithParserOptions, node: any): boolean {
  const target = node.type === "MemberExpression" ? node.property : node;
  if (target?.type !== "Identifier") {
    return false;
  }
  const symbol = checkerFor(context).getSymbolAtLocation(target);
  return (
    symbol?.declarations?.some((declaration) =>
      declarationHasDeprecatedJSDoc(context, declaration),
    ) === true
  );
}

function declarationHasDeprecatedJSDoc(
  context: ContextWithParserOptions,
  declaration: string,
): boolean {
  const handle = parseNodeHandle(declaration);
  if (!handle) {
    return false;
  }
  const sourceText = sourceTextForPath(context, handle.path);
  if (!sourceText) {
    return false;
  }
  const pos = handle.pos;
  if (!Number.isFinite(pos)) {
    return false;
  }
  return sourceText.slice(Math.max(0, pos - 500), pos).includes("@deprecated");
}

function parseNodeHandle(
  value: string,
): { readonly pos: number; readonly end: number; readonly path: string } | undefined {
  const [posText, endText, _kindText, ...pathParts] = value.split(".");
  const pos = Number(posText);
  const end = Number(endText);
  if (!Number.isFinite(pos) || !Number.isFinite(end)) {
    return undefined;
  }
  return { pos, end, path: pathParts.join(".") };
}

function sourceTextForPath(context: ContextWithParserOptions, path: string): string | undefined {
  if (!path || path === context.filename || context.filename.endsWith(path)) {
    return context.sourceCode.text;
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    try {
      return readFileSync(`${context.cwd}/${path}`, "utf8");
    } catch {
      return undefined;
    }
  }
}

function hasSingleUseTypeParameter(context: ContextWithParserOptions, node: any): boolean {
  const params = Array.isArray(node.params) ? node.params : [];
  if (params.length !== 1) {
    return false;
  }
  const name = typeParameterName(params[0]);
  if (!name) {
    return false;
  }
  const ownerText = node.parent
    ? context.sourceCode.getText(node.parent)
    : context.sourceCode.getText(node);
  const matches = ownerText.match(new RegExp(`\\b${escapeRegExp(name)}\\b`, "g")) ?? [];
  return matches.length <= 2;
}

function typeParameterName(node: any): string | undefined {
  if (typeof node?.name === "string") {
    return node.name;
  }
  if (typeof node?.name?.name === "string") {
    return node.name.name;
  }
  return undefined;
}

function normalizeTypeText(text: string): string {
  return text.replace(/\s+/g, "");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderTypeTexts(context: ContextWithParserOptions, type: CorsaType): readonly string[] {
  const texts = new Set<string>();
  const checker = checkerFor(context);
  for (const text of [...(type.texts ?? []), checker.typeToString(type)]) {
    if (text) {
      texts.add(text);
    }
  }
  return [...texts];
}

function isPromiseExecutorRejectCall(context: ContextWithParserOptions, node: any): boolean {
  const callee = stripChainExpression(node.callee);
  if (callee?.type !== "Identifier") {
    return false;
  }
  const nearestFunction = nearestFunctionAncestor(context, node);
  const rejectParam = nearestFunction?.params?.[1];
  if (!rejectParam || rejectParam.type !== "Identifier" || rejectParam.name !== callee.name) {
    return false;
  }
  const promiseConstructor = stripChainExpression(nearestFunction.parent?.parent);
  return (
    (nearestFunction.parent?.type === "NewExpression" &&
      isIdentifierNamed(nearestFunction.parent.callee, "Promise")) ||
    (promiseConstructor?.type === "NewExpression" &&
      isIdentifierNamed(promiseConstructor.callee, "Promise"))
  );
}

function returnAwaitRequiresAwait(context: ContextWithParserOptions, node: any): boolean {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return ancestors.some(
    (ancestor: any) =>
      ancestor.type === "TryStatement" &&
      (rangeContains(ancestor.block, node) ||
        rangeContains(ancestor.handler?.body, node) ||
        rangeContains(ancestor.finalizer, node)),
  );
}

function rangeContains(container: any, node: any): boolean {
  return (
    isRange(container?.range) &&
    isRange(node?.range) &&
    container.range[0] <= node.range[0] &&
    node.range[1] <= container.range[1]
  );
}

function nearestFunctionAncestor(context: ContextWithParserOptions, node: any): any {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return [...ancestors].reverse().find((ancestor: any) => ancestor.type?.includes("Function"));
}

function nearestClassAncestor(context: ContextWithParserOptions, node: any): any {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return [...ancestors]
    .reverse()
    .find(
      (ancestor: any) =>
        ancestor.type === "ClassDeclaration" || ancestor.type === "ClassExpression",
    );
}

function isFunctionLike(node: any): boolean {
  return typeof node?.type === "string" && node.type.includes("Function");
}

function returnTypeTextsOfNearestFunction(
  context: ContextWithParserOptions,
  node: any,
): readonly string[] {
  const owner = nearestFunctionAncestor(context, node);
  return owner ? returnTypeTextsOfFunction(context, owner) : [];
}

function returnTypeTextsOfFunction(
  context: ContextWithParserOptions,
  node: any,
): readonly string[] {
  const explicitAnnotation = node.returnType?.typeAnnotation ?? node.returnType;
  if (explicitAnnotation) {
    const text = context.sourceCode.getText(explicitAnnotation);
    if (text) {
      return [text];
    }
  }

  const checker = checkerFor(context);
  const type = typeAtNode(context, node);
  if (!type) {
    return [];
  }

  const texts = new Set<string>();
  for (const signature of checker.getSignaturesOfType(type, 0)) {
    const returnType = checker.getReturnTypeOfSignature(signature);
    if (!returnType) {
      continue;
    }
    for (const text of [...(returnType.texts ?? []), checker.typeToString(returnType)]) {
      if (text) {
        texts.add(text);
      }
    }
  }

  const resolved = [...texts];
  return resolved.every(isPermissiveTypeText) ? [] : resolved;
}

function isPermissiveTypeText(text: string): boolean {
  return text === "any" || text === "unknown" || text === "never";
}

function isPermissiveTypeTexts(texts: readonly string[]): boolean {
  return texts.some((text) => isPermissiveTypeText(normalizeTypeText(text)));
}

function stripChainExpression(node: any): any {
  let current = node;
  while (current?.type === "ChainExpression") {
    current = current.expression;
  }
  return current;
}

function isIdentifierNamed(node: any, name: string): boolean {
  const current = stripChainExpression(node);
  return current?.type === "Identifier" && current.name === name;
}

function isNativeChildNode(value: unknown): value is RangedNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    isRange((value as { range?: unknown }).range)
  );
}

function isRange(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

function isJsonPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

function isJsonValue(value: unknown): boolean {
  if (isJsonPrimitive(value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}

function isPrimitiveRecord(
  value: unknown,
): value is Record<string, string | number | boolean | null> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonPrimitive)
  );
}

function isSkippedField(key: string): boolean {
  return key === "type" || key === "range" || key === "loc" || key === "parent";
}
