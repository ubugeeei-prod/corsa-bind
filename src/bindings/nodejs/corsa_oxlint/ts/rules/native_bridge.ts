import { nativeLintRuleMetas, runNativeLintRule } from "@corsa-bind/napi";
import type {
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRange,
  NativeLintRuleMeta,
  NativeNodeMetadataDepth,
} from "@corsa-bind/napi";

import { attachConfigFacts, ruleFactProviders } from "./fact_providers";
import { createNativeRule } from "./rule_creator";
import { checkerFor, propertyNamesOfNode, typeAtNode, typeTextsAtNode } from "./type_utils";
import type { ContextWithParserOptions, CorsaCallSignatureFacts } from "../types";

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
                  meta.bridge.symbolFacts === true,
                  0,
                  ruleName,
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
  includeSymbolFacts = false,
  depth = 0,
  ruleName?: string,
): NativeLintNode {
  const fields: Record<string, unknown> = {};
  const children: Record<string, NativeLintNode> = {};
  const childLists: Record<string, NativeLintNode[]> = {};

  const typeAnnotationText = sourceTypeAnnotationText(context, node);
  if (typeAnnotationText) {
    fields.__typeAnnotationText = typeAnnotationText;
  }

  const options = (context as { options?: unknown }).options;
  if (includeRuleOptions && Array.isArray(options) && options.length > 0 && isJsonValue(options)) {
    fields.__ruleOptions = options;
  }
  if (includeRuleOptions) {
    // Host facts run BEFORE child serialization: fact providers may annotate
    // descendant AST nodes, and those annotations must be visible when the
    // subtree is serialized below.
    addHostInputs(context, node, fields, includeSymbolFacts, ruleName);
  }

  for (const [key, value] of Object.entries(node)) {
    if (isSkippedField(key) || key in fields) {
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
          includeSymbolFacts,
          depth + 1,
        );
      }
      continue;
    }
    if (Array.isArray(value)) {
      if (key.startsWith("__") && isJsonValue(value)) {
        // Rule-specific facts may be nested JSON (e.g. per-slot text lists).
        fields[key] = value;
        continue;
      }
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
            includeSymbolFacts,
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

function addHostInputs(
  context: ContextWithParserOptions,
  node: RangedNode,
  fields: Record<string, unknown>,
  includeSymbolFacts: boolean,
  ruleName?: string,
): void {
  const current = node as any;
  const ancestors = ancestorFacts(context, current);
  if (ancestors.length > 0) {
    fields.__ancestorFacts = ancestors;
  }
  if (current.type === "CallExpression" || current.type === "NewExpression") {
    const callFacts = callFactsOfNode(context, current);
    if (Object.keys(callFacts).length > 0) {
      fields.__callFacts = callFacts;
    }
  }
  if (current.parent?.type) {
    fields.__parentKind = current.parent.type;
  }
  if (includeSymbolFacts) {
    const symbolFacts = symbolFactsOfNode(context, current);
    if (Object.keys(symbolFacts).length > 0) {
      fields.__symbolFacts = symbolFacts;
    }
  }
  const typeParameterFacts = typeParameterFactsOfNode(context, current);
  if (Object.keys(typeParameterFacts).length > 0) {
    fields.__typeParameterFacts = typeParameterFacts;
  }
  const returnTypeFacts = returnTypeFactsOfNode(context, current);
  if (Object.keys(returnTypeFacts).length > 0) {
    fields.__returnTypeFacts = returnTypeFacts;
  }
  if (ruleName) {
    const sink = { fields };
    attachConfigFacts(ruleName, context, sink);
    for (const provider of ruleFactProviders[ruleName] ?? []) {
      provider(context, current, sink);
    }
  }
}

function callFactsOfNode(context: ContextWithParserOptions, node: any): Record<string, unknown> {
  const facts: Record<string, unknown> = {};
  const calleeName = identifierName(stripChainExpression(node.callee));
  if (calleeName) {
    facts.calleeName = calleeName;
  }
  const signatureFacts = callSignatureFactsOfNode(context, node);
  if (signatureFacts.expectedArgumentTypeTexts?.length) {
    facts.expectedArgumentTypeTexts = signatureFacts.expectedArgumentTypeTexts;
  }
  if (signatureFacts.explicitTypeArgumentsRequired !== undefined) {
    facts.explicitTypeArgumentsRequired = signatureFacts.explicitTypeArgumentsRequired;
  }
  const typeArgumentFacts = typeArgumentFactsOfCall(context, node, signatureFacts);
  for (const [key, value] of Object.entries(typeArgumentFacts)) {
    facts[key] = value;
  }
  return facts;
}

function symbolFactsOfNode(context: ContextWithParserOptions, node: any): Record<string, unknown> {
  if (node.type !== "Identifier" && node.type !== "MemberExpression") {
    return {};
  }
  const target = node.type === "MemberExpression" ? node.property : node;
  if (target?.type !== "Identifier") {
    return {};
  }
  const checker = checkerFor(context);
  const symbol = checker.getSymbolAtLocation(target);
  if (!symbol) {
    return {};
  }
  const deprecatedTag = checker.getJsDocTags(symbol).find((tag) => tag.name === "deprecated");
  if (!deprecatedTag) {
    return {};
  }
  const reason = deprecatedTag.text?.trim();
  return reason ? { deprecated: true, deprecationReason: reason } : { deprecated: true };
}

function typeParameterFactsOfNode(
  context: ContextWithParserOptions,
  node: any,
): Record<string, unknown> {
  if (node.type !== "TSTypeParameterDeclaration") {
    return {};
  }
  const params = Array.isArray(node.params) ? node.params : [];
  if (params.length !== 1) {
    return {};
  }
  const name = typeParameterName(params[0]);
  if (!name) {
    return {};
  }
  return {
    name,
    ownerText: node.parent
      ? context.sourceCode.getText(node.parent)
      : context.sourceCode.getText(node),
  };
}

function returnTypeFactsOfNode(
  context: ContextWithParserOptions,
  node: any,
): Record<string, unknown> {
  const returnTypeTexts =
    node.type === "ReturnStatement"
      ? returnTypeTextsOfNearestFunction(context, node)
      : isFunctionLike(node) || node.type === "ArrowFunctionExpression"
        ? returnTypeTextsOfFunction(context, node)
        : [];
  return returnTypeTexts.length > 0 ? { texts: returnTypeTexts } : {};
}

function ancestorFacts(
  context: ContextWithParserOptions,
  node: any,
): readonly Record<string, unknown>[] {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return ancestors
    .filter((ancestor: any) => typeof ancestor?.type === "string")
    .map((ancestor: any) => {
      const fact: Record<string, unknown> = { kind: ancestor.type };
      if (isRange(ancestor.range)) {
        fact.start = ancestor.range[0];
        fact.end = ancestor.range[1];
      }
      if (typeof ancestor.async === "boolean") {
        fact.async = ancestor.async;
      }
      if (ancestor.type === "CatchClause" && ancestor.param?.type === "Identifier") {
        fact.catchParamName = ancestor.param.name;
      }
      const className = ancestor.id?.name;
      if (
        (ancestor.type === "ClassDeclaration" || ancestor.type === "ClassExpression") &&
        typeof className === "string" &&
        className.length > 0
      ) {
        fact.className = className;
      }
      if (isFunctionLike(ancestor)) {
        const paramNames = Array.isArray(ancestor.params)
          ? ancestor.params
              .map(identifierName)
              .filter((name: string | undefined): name is string => name !== undefined)
          : [];
        if (paramNames.length > 0) {
          fact.paramNames = paramNames;
        }
        if (ancestor.parent?.type) {
          fact.parentKind = ancestor.parent.type;
        }
        const parentCalleeName = identifierName(stripChainExpression(ancestor.parent?.callee));
        if (parentCalleeName) {
          fact.parentCalleeName = parentCalleeName;
        }
        const parentCallee = stripChainExpression(ancestor.parent?.callee);
        if (
          parentCallee?.type === "MemberExpression" &&
          parentCallee.property?.type === "Identifier"
        ) {
          fact.parentCalleePropertyName = parentCallee.property.name;
        }
        const parentArguments = ancestor.parent?.arguments;
        if (Array.isArray(parentArguments)) {
          const index = parentArguments.indexOf(ancestor);
          if (index >= 0) {
            fact.parentArgumentIndex = index;
            if (
              parentArguments
                .slice(0, index)
                .some((argument: any) => argument?.type === "SpreadElement")
            ) {
              fact.parentLeadingSpreadArgument = true;
            }
          }
        }
        if (ancestor.parent?.parent?.type) {
          fact.parentParentKind = ancestor.parent.parent.type;
        }
        const parentParentCalleeName = identifierName(
          stripChainExpression(ancestor.parent?.parent?.callee),
        );
        if (parentParentCalleeName) {
          fact.parentParentCalleeName = parentParentCalleeName;
        }
      }
      return fact;
    });
}

function callSignatureFactsOfNode(
  context: ContextWithParserOptions,
  node: any,
): CorsaCallSignatureFacts {
  const callee = stripChainExpression(node.callee);
  if (!callee) {
    return {};
  }
  const calleeType = typeAtNode(context, callee);
  if (!calleeType) {
    return {};
  }
  const args = Array.isArray(node.arguments) ? node.arguments : [];
  const explicitTypeArguments = typeArgumentNodes(node)
    .map((typeArgument) => context.sourceCode.getText(typeArgument))
    .filter((text: string): text is string => text.length > 0);
  return checkerFor(context).getCallSignatureFacts(
    calleeType,
    node.type === "NewExpression" ? 1 : 0,
    args.map((arg: unknown) => typeTextsAtNode(context, arg as never)),
    explicitTypeArguments,
  );
}

function typeArgumentNodes(node: any): readonly any[] {
  const candidates = [
    node.typeArguments?.params,
    node.typeParameters?.params,
    node.typeParameterInstantiation?.params,
  ];
  return candidates.find(Array.isArray) ?? [];
}

/**
 * Returns the defaults declared on the type parameters of the callee, when the
 * callee is declared in the file being linted.
 *
 * Each entry is the rendered default text, or an empty string for a type
 * parameter without one, so the result aligns with the type parameter list.
 * Returns `undefined` when the declaration is not visible here, which keeps a
 * caller from mistaking "no defaults" for "not found".
 */
function declaredTypeParameterDefaults(
  context: ContextWithParserOptions,
  node: any,
): readonly string[] | undefined {
  const name = identifierName(stripChainExpression(node.callee));
  if (!name) {
    return undefined;
  }
  const declaration = findTypeParameterOwner((context.sourceCode as any)?.ast, name);
  const params = declaration?.typeParameters?.params;
  if (!Array.isArray(params)) {
    return undefined;
  }
  return params.map((param: any) =>
    param?.default ? context.sourceCode.getText(param.default).trim() : "",
  );
}

/**
 * Finds the declaration of `name` that carries a type parameter list.
 *
 * Walks the whole tree rather than a scope chain because the oxlint context
 * does not expose scope analysis.
 */
function findTypeParameterOwner(root: any, name: string): any {
  if (!root || typeof root !== "object") {
    return undefined;
  }
  const stack: any[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current.id?.name === name && current.typeParameters?.params) {
      return current;
    }
    for (const key of Object.keys(current)) {
      if (key === "parent") {
        continue;
      }
      const value = current[key];
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return undefined;
}

function typeArgumentFactsOfCall(
  context: ContextWithParserOptions,
  node: any,
  signatureFacts: CorsaCallSignatureFacts,
): Record<string, unknown> {
  const typeArguments = typeArgumentNodes(node);
  if (typeArguments.length === 0) {
    return {};
  }
  const facts: Record<string, unknown> = {
    typeArgumentRanges: typeArguments
      .map((typeArgument) => rangeObject(typeArgument.range))
      .filter((range): range is { start: number; end: number } => range !== undefined),
  };
  const listRange = typeArgumentListRange(node, typeArguments);
  if (listRange) {
    facts.typeArgumentListRange = listRange;
  }
  const declaredDefaults = declaredTypeParameterDefaults(context, node);
  const parameterCount =
    signatureFacts.signature?.typeParameters?.length ??
    declaredDefaults?.length ??
    signatureFacts.signature?.typeParameterDefaultTexts?.length ??
    0;
  if (parameterCount > 0) {
    facts.typeParameterCount = parameterCount;
  }
  // Upstream exposes no endpoint for a type parameter's default, and a stable
  // TypeScript 7 declaration handle carries no source range to read it from.
  // The declaration is in the AST being linted whenever it is in this file, so
  // read it from there and only fall back to the signature's rendered texts.
  const defaultTexts =
    declaredDefaults ?? signatureFacts.signature?.typeParameterDefaultTexts ?? [];
  const lastIndex = typeArguments.length - 1;
  const lastDefaultText = defaultTexts[lastIndex];
  if (lastDefaultText !== undefined) {
    const hasDefault = lastDefaultText.trim().length > 0;
    facts.lastTypeParameterHasDefault = hasDefault;
    if (hasDefault) {
      const identical =
        declaredDefaults !== undefined
          ? typeNodesResolveToSameType(
              context,
              typeArguments[lastIndex],
              declaredDefaultNode(context, node, lastIndex),
            )
          : signatureFacts.explicitTypeArgumentsRequired === false;
      if (identical) {
        facts.lastTypeArgumentEqualsDefault = true;
        facts.lastTypeArgumentSameTypeFlagsAsDefault = true;
        facts.lastTypeArgumentIdenticalToDefault = true;
      }
    }
  }
  return facts;
}

/**
 * Returns the AST node of the default declared on the callee's type parameter
 * at `index`, when the callee is declared in the file being linted.
 */
function declaredDefaultNode(context: ContextWithParserOptions, node: any, index: number): any {
  const name = identifierName(stripChainExpression(node.callee));
  if (!name) {
    return undefined;
  }
  const declaration = findTypeParameterOwner((context.sourceCode as any)?.ast, name);
  return declaration?.typeParameters?.params?.[index]?.default;
}

/**
 * Reports whether two type nodes denote the same checker type.
 *
 * Comparing the checker's own type identity keeps this from depending on how
 * either type happens to be spelled.
 */
function typeNodesResolveToSameType(
  context: ContextWithParserOptions,
  left: any,
  right: any,
): boolean {
  if (!left || !right) {
    return false;
  }
  const checker = checkerFor(context);
  const leftType = checker.getTypeAtLocation(left);
  const rightType = checker.getTypeAtLocation(right);
  return leftType !== undefined && rightType !== undefined && leftType.id === rightType.id;
}

function typeArgumentListRange(
  node: any,
  typeArguments: readonly any[],
): { start: number; end: number } | undefined {
  const candidates = [node.typeArguments, node.typeParameters, node.typeParameterInstantiation];
  const list = candidates.find((candidate) => Array.isArray(candidate?.params));
  const fromList = rangeObject(list?.range);
  if (fromList) {
    return fromList;
  }
  const first = rangeObject(typeArguments[0]?.range);
  const last = rangeObject(typeArguments[typeArguments.length - 1]?.range);
  if (!first || !last || first.start <= 0) {
    return undefined;
  }
  return { start: first.start - 1, end: last.end + 1 };
}

function rangeObject(range: unknown): { start: number; end: number } | undefined {
  return isRange(range) ? { start: range[0], end: range[1] } : undefined;
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

function nearestFunctionAncestor(context: ContextWithParserOptions, node: any): any {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return [...ancestors].reverse().find((ancestor: any) => ancestor.type?.includes("Function"));
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

function stripChainExpression(node: any): any {
  let current = node;
  while (current?.type === "ChainExpression") {
    current = current.expression;
  }
  return current;
}

function identifierName(node: any): string | undefined {
  const current = stripChainExpression(node);
  return current?.type === "Identifier" && typeof current.name === "string"
    ? current.name
    : undefined;
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
