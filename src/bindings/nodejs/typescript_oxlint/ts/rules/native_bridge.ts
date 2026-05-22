import { nativeLintRuleMetas, runNativeLintRule } from "@corsa-bind/napi";
import type {
  NativeLintDiagnostic,
  NativeLintNode,
  NativeLintRange,
  NativeLintRuleMeta,
} from "@corsa-bind/napi";

import { createNativeRule } from "./rule_creator";
import { checkerFor, propertyNamesOfNode, typeAtNode, typeTextsAtNode } from "./type_utils";
import type { ContextWithParserOptions } from "../types";

type RangedNode = {
  readonly type: string;
  readonly range: readonly [number, number];
};

type NativeRuleBridgeOptions = {
  readonly shouldRun?: (node: RangedNode, context: ContextWithParserOptions) => boolean;
  readonly includeTypeTexts?: NodeMetadataOption;
  readonly includePropertyNames?: NodeMetadataOption;
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
            reportNativeDiagnostics(
              context,
              node,
              runNativeLintRule(
                ruleName,
                toNativeNode(
                  context,
                  node,
                  includeTypeTexts,
                  bridgeOptions.maxDepth ?? MAX_NATIVE_NODE_DEPTH,
                  true,
                  includePropertyNamesOption(bridgeOptions, includeTypeTexts),
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
    throw new Error(`corsa-oxlint native Rust rule is not registered: ${ruleName}`);
  }
  return meta;
}

function includeTypeTextsOption(
  options: NativeRuleBridgeOptions,
  meta: NativeLintRuleMeta,
): NodeMetadataOption {
  return options.includeTypeTexts ?? meta.requiresTypeTexts;
}

function includePropertyNamesOption(
  options: NativeRuleBridgeOptions,
  includeTypeTexts: NodeMetadataOption,
): NodeMetadataOption {
  return options.includePropertyNames ?? includeTypeTexts;
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
  if (current.type === "TemplateLiteral") {
    fields.__taggedTemplate = current.parent?.type === "TaggedTemplateExpression";
  }
  if (current.type === "CallExpression" && isPromiseExecutorRejectCall(context, current)) {
    fields.__promiseExecutorRejectCall = true;
  }
  if (current.type === "ReturnStatement") {
    const returnTypeTexts = returnTypeTextsOfNearestFunction(context, current);
    if (returnTypeTexts.length > 0) {
      fields.__returnTypeTexts = returnTypeTexts;
    }
  }
  if (current.type === "ArrowFunctionExpression" && current.body?.type !== "BlockStatement") {
    const returnTypeTexts = returnTypeTextsOfFunction(context, current);
    if (returnTypeTexts.length > 0) {
      fields.__returnTypeTexts = returnTypeTexts;
    }
  }
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

function nearestFunctionAncestor(context: ContextWithParserOptions, node: any): any {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return [...ancestors].reverse().find((ancestor: any) => ancestor.type?.includes("Function"));
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
