/**
 * Per-rule fact providers for the Rust native-rule bridge.
 *
 * Every Rust rule consumes a documented set of `__*` facts. The generic
 * bridge (`native_bridge.ts`) supplies the shared ones (type texts, property
 * names, ancestor/call facts); the providers in this module supply the
 * rule-specific facts that need extra AST inspection or checker queries.
 *
 * A provider receives the visited ESTree node and a fact sink and attaches
 * whatever facts it can resolve. Facts a provider cannot resolve are left
 * absent — the Rust rules degrade conservatively (they prefer silence over
 * false positives) when a fact is missing.
 *
 * Providers run after the generic facts, so `sink.fields` already carries
 * `__callFacts` and friends; deriving from them avoids duplicate checker
 * round trips.
 */

import { sessionForContext } from "../registry";
import { memberPropertyName, stripChainExpression } from "./ast";
import { checkerFor, typeAtNode, typeTextsAtNode } from "./type_utils";
import type { ContextWithParserOptions, CorsaType } from "../types";

/** Mutable sink the providers write resolved facts into. */
export interface FactSink {
  /** Scalar facts merged into the listener node's `fields`. */
  readonly fields: Record<string, unknown>;
}

export type FactProvider = (
  context: ContextWithParserOptions,
  node: any,
  sink: FactSink,
) => void;

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function compilerOption(context: ContextWithParserOptions, name: string): unknown {
  const options = sessionForContext(context).session.getCompilerOptions() as
    | Record<string, unknown>
    | undefined;
  return options?.[name];
}

/** `strictNullChecks` resolves through `strict` the way tsc computes it. */
function strictNullChecksEnabled(context: ContextWithParserOptions): boolean {
  const explicit = compilerOption(context, "strictNullChecks");
  if (typeof explicit === "boolean") {
    return explicit;
  }
  const strict = compilerOption(context, "strict");
  return typeof strict === "boolean" ? strict : false;
}

/** Renders the return-type texts of every call signature of `type`. */
function returnTypeTextsOfType(
  context: ContextWithParserOptions,
  type: CorsaType | undefined,
): string[] {
  if (!type) {
    return [];
  }
  const checker = checkerFor(context);
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
  return [...texts];
}

/**
 * Extracts the return-type text out of a rendered function type text
 * (`"(x: number) => void"` → `"void"`).
 */
export function returnTextOfFunctionTypeText(text: string): string | undefined {
  let depth = 0;
  for (let index = 0; index < text.length - 1; index += 1) {
    const ch = text[index];
    if (ch === "(" || ch === "<" || ch === "[" || ch === "{") {
      depth += 1;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
    } else if (ch === "=" && text[index + 1] === ">" && depth === 0) {
      const result = text.slice(index + 2).trim();
      return result.length > 0 ? result : undefined;
    }
  }
  return undefined;
}

const ARRAY_PREDICATE_METHODS = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
]);

function isArrayLikeTypeText(text: string): boolean {
  const current = text.trim();
  return (
    current.endsWith("[]") ||
    current.startsWith("Array<") ||
    current.startsWith("ReadonlyArray<") ||
    current.startsWith("readonly ") ||
    (current.startsWith("[") && current.endsWith("]"))
  );
}

function nearestFunctionNode(context: ContextWithParserOptions, node: any): any {
  const ancestors = (context.sourceCode as any)?.getAncestors?.(node) ?? [];
  return [...ancestors].reverse().find((ancestor: any) => ancestor.type?.includes("Function"));
}

// ---------------------------------------------------------------------------
// no-misused-promises
// ---------------------------------------------------------------------------

const misusedPromisesFacts: FactProvider = (context, node, sink) => {
  if (node.type === "MemberExpression") {
    // Array predicate positions: `values.filter(async (v) => ...)`.
    const parent = node.parent;
    if (
      parent?.type === "CallExpression" &&
      stripChainExpression(parent.callee) === node &&
      ARRAY_PREDICATE_METHODS.has(memberPropertyName(node) ?? "") &&
      typeTextsAtNode(context, node.object).some(isArrayLikeTypeText)
    ) {
      sink.fields.__arrayMethodCallWithPredicate = true;
      const firstArgument = parent.arguments?.[0];
      if (firstArgument && typeof firstArgument === "object") {
        // The Rust rule reads the predicate as a child node; annotating the
        // AST node lets the generic serializer pick it up.
        (node as any).__firstArgument = firstArgument;
      }
    }
    return;
  }

  if (node.type === "CallExpression" || node.type === "NewExpression") {
    // Per-argument expected return-type texts, derived from the call facts
    // the generic bridge already collected (no extra round trip).
    const callFacts = sink.fields.__callFacts as
      | { expectedArgumentTypeTexts?: readonly (readonly string[])[] }
      | undefined;
    const expected = callFacts?.expectedArgumentTypeTexts;
    if (!expected || expected.length === 0) {
      return;
    }
    const slots = expected.map((slotTexts) => {
      const returnTexts: string[] = [];
      for (const text of slotTexts) {
        const returnText = returnTextOfFunctionTypeText(text);
        if (returnText) {
          returnTexts.push(returnText);
        }
      }
      return returnTexts;
    });
    if (slots.some((slot) => slot.length > 0)) {
      sink.fields.__expectedArgumentReturnTypeTexts = slots;
    }
    return;
  }

  if (node.type === "VariableDeclarator") {
    // `const fn: () => void = async () => {}` — the annotated (contextual)
    // function type's return texts.
    if (node.id?.typeAnnotation) {
      const texts = returnTypeTextsOfType(context, typeAtNode(context, node.id));
      if (texts.length > 0) {
        sink.fields.__variableReturnTypeTexts = texts;
      }
    }
    return;
  }

  if (node.type === "AssignmentExpression" || node.type === "ReturnStatement") {
    const target =
      node.type === "AssignmentExpression" ? node.left : nearestFunctionNode(context, node);
    const texts = returnTypeTextsOfType(context, target ? typeAtNode(context, target) : undefined);
    if (texts.length > 0) {
      sink.fields.__contextualReturnTypeTexts = texts;
    }
    return;
  }

  if (node.type === "JSXAttribute") {
    // The attribute symbol's type renders as the expected handler type.
    const checker = checkerFor(context);
    const symbol = node.name ? checker.getSymbolAtLocation(node.name) : undefined;
    const attributeType = symbol ? checker.getTypeOfSymbol(symbol) : undefined;
    const texts = returnTypeTextsOfType(context, attributeType);
    if (texts.length > 0) {
      sink.fields.__contextualReturnTypeTexts = texts;
    }
    return;
  }

  if (
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression" ||
    node.type === "TSInterfaceDeclaration"
  ) {
    markVoidReturnInheritedMethods(context, node);
  }
};

/**
 * Marks class/interface members overriding a void-returning heritage member
 * with `__voidReturnInheritedMethod`, mirroring the checker-driven heritage
 * walk in the Go rule.
 */
function markVoidReturnInheritedMethods(context: ContextWithParserOptions, node: any): void {
  const heritage: any[] = [
    ...(Array.isArray(node.implements) ? node.implements : []),
    ...(node.superClass ? [node.superClass] : []),
    ...(Array.isArray(node.extends) ? node.extends : []),
  ];
  if (heritage.length === 0) {
    return;
  }
  const checker = checkerFor(context);
  const voidReturningMemberNames = new Set<string>();
  for (const clause of heritage) {
    const reference = clause?.expression ?? clause;
    const heritageType = typeAtNode(context, reference);
    if (!heritageType) {
      continue;
    }
    for (const property of checker.getPropertiesOfType(heritageType)) {
      const propertyType = checker.getTypeOfSymbol(property);
      const returnTexts = returnTypeTextsOfType(context, propertyType);
      if (
        returnTexts.length > 0 &&
        returnTexts.every((text) => text === "void" || text === "undefined")
      ) {
        voidReturningMemberNames.add(property.name);
      }
    }
  }
  if (voidReturningMemberNames.size === 0) {
    return;
  }
  for (const member of node.body?.body ?? []) {
    const name = member?.key?.name;
    if (typeof name === "string" && voidReturningMemberNames.has(name)) {
      member.__voidReturnInheritedMethod = true;
    }
  }
}

// ---------------------------------------------------------------------------
// no-unsafe-argument
// ---------------------------------------------------------------------------

const unsafeArgumentFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "CallExpression" && node.type !== "NewExpression") {
    return;
  }
  const callee = stripChainExpression(node.callee ?? node.tag);
  if (callee && typeTextsAtNode(context, callee).some((text) => text.trim() === "any")) {
    sink.fields.__calleeIsAnyType = true;
  }

  for (const argument of Array.isArray(node.arguments) ? node.arguments : []) {
    if (argument?.type !== "SpreadElement" || !argument.argument) {
      continue;
    }
    const spreadType = typeAtNode(context, argument.argument);
    if (!spreadType) {
      continue;
    }
    const text = (spreadType.texts ?? [])[0]?.trim() ?? "";
    const checker = checkerFor(context);
    if (text.startsWith("[") && text.endsWith("]")) {
      // Tuple spread: per-element texts take precedence over the array
      // classification, mirroring checker.IsTupleType.
      const elements = checker.getTypeArguments(spreadType);
      argument.__spreadTupleElementTypeTexts =
        elements.length > 0
          ? elements.map((element) => [...(element.texts ?? [])])
          : splitTupleText(text).map((part) => [part]);
      if (text.includes("...")) {
        argument.__spreadTupleHasRest = true;
      }
    } else if (isArrayLikeTypeText(text)) {
      const elements = checker.getTypeArguments(spreadType);
      if (elements.length > 0) {
        argument.__arrayElementTypeTexts = elements.flatMap((element) => [
          ...(element.texts ?? []),
        ]);
      }
    }
  }
};

function splitTupleText(text: string): string[] {
  const inner = text.slice(1, -1);
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const ch = inner[index];
    if (ch === "<" || ch === "[" || ch === "(" || ch === "{") {
      depth += 1;
    } else if (ch === ">" || ch === "]" || ch === ")" || ch === "}") {
      depth -= 1;
    } else if (ch === "," && depth === 0) {
      parts.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = inner.slice(start).trim();
  if (tail.length > 0) {
    parts.push(tail);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// compiler-option facts
// ---------------------------------------------------------------------------

/** Facts derived from compiler options, keyed by the fact name each rule reads. */
const configFactNames: Record<string, { readonly fact: string; readonly negated: boolean }> = {
  "no-unnecessary-boolean-literal-compare": { fact: "__strictNullChecks", negated: false },
  "no-useless-default-assignment": { fact: "__strictNullChecks", negated: false },
  "prefer-nullish-coalescing": { fact: "__isStrictNullChecks", negated: false },
  "strict-boolean-expressions": { fact: "__strictNullChecksDisabled", negated: true },
};

/** Attaches the strict-null-checks fact a rule expects, when it expects one. */
export function attachConfigFacts(
  ruleName: string,
  context: ContextWithParserOptions,
  sink: FactSink,
): void {
  const entry = configFactNames[ruleName];
  if (!entry) {
    return;
  }
  const enabled = strictNullChecksEnabled(context);
  sink.fields[entry.fact] = entry.negated ? !enabled : enabled;
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

export const ruleFactProviders: Record<string, readonly FactProvider[]> = {
  "no-misused-promises": [misusedPromisesFacts],
  "no-unsafe-argument": [unsafeArgumentFacts],
};
