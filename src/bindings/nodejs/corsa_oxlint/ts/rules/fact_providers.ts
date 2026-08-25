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
// no-unsafe-enum-comparison
// ---------------------------------------------------------------------------

// TypeScript 7's native checker renumbered TypeFlags relative to Strada;
// these mirror ref/corsa-upstream/tsc/internal/checker/types.go.
const TYPE_FLAG_ANY = 1 << 0;
const TYPE_FLAG_UNKNOWN = 1 << 1;
const TYPE_FLAG_STRING = 1 << 5;
const TYPE_FLAG_NUMBER = 1 << 6;
const TYPE_FLAG_BIGINT = 1 << 7;
const TYPE_FLAG_BOOLEAN = 1 << 8;
const TYPE_FLAG_STRING_LITERAL = 1 << 10;
const TYPE_FLAG_NUMBER_LITERAL = 1 << 11;
const TYPE_FLAG_BIGINT_LITERAL = 1 << 12;
const TYPE_FLAG_BOOLEAN_LITERAL = 1 << 13;
const TYPE_FLAG_ENUM_LITERAL = 1 << 15;
const TYPE_FLAG_ENUM = 1 << 16;
const TYPE_FLAG_NEVER = 1 << 18;
const TYPE_FLAG_TEMPLATE_LITERAL = 1 << 22;
const TYPE_FLAG_STRING_MAPPING = 1 << 23;
const TYPE_FLAG_UNION = 1 << 27;
const TYPE_FLAG_STRING_LIKE =
  TYPE_FLAG_STRING | TYPE_FLAG_STRING_LITERAL | TYPE_FLAG_TEMPLATE_LITERAL | TYPE_FLAG_STRING_MAPPING;
const TYPE_FLAG_NUMBER_LIKE = TYPE_FLAG_NUMBER | TYPE_FLAG_NUMBER_LITERAL | TYPE_FLAG_ENUM;

const ENUM_COMPARISON_OPERATORS = new Set(["<", "<=", ">", ">=", "==", "===", "!=", "!=="]);

/** Splits a type into its union constituents (the type itself when scalar). */
function unionPartsOfType(
  context: ContextWithParserOptions,
  type: CorsaType,
): readonly CorsaType[] {
  if ((type.flags & TYPE_FLAG_UNION) === 0) {
    return [type];
  }
  const parts = checkerFor(context).getTypesOfType(type);
  return parts.length > 0 ? parts : [type];
}

function renderedTypeText(context: ContextWithParserOptions, type: CorsaType): string {
  return type.texts?.[0] ?? checkerFor(context).typeToString(type);
}

/** The declaring enum's rendered name for an enum(-literal) type part. */
function enumIdOfPart(context: ContextWithParserOptions, part: CorsaType): string | undefined {
  if ((part.flags & (TYPE_FLAG_ENUM | TYPE_FLAG_ENUM_LITERAL)) === 0) {
    return undefined;
  }
  const text = renderedTypeText(context, part);
  const dot = text.lastIndexOf(".");
  return dot > 0 ? text.slice(0, dot) : text;
}

function annotateEnumComparisonOperand(context: ContextWithParserOptions, operand: any): void {
  if (!operand || typeof operand !== "object" || operand.__unionPartTypeIds) {
    return;
  }
  const type = typeAtNode(context, operand);
  if (!type) {
    return;
  }
  const parts = unionPartsOfType(context, type);
  operand.__unionPartTypeIds = parts.map((part) => part.id);
  const enumIds = new Set<string>();
  const enumValueKinds: string[] = [];
  let numberLike = false;
  let stringLike = false;
  for (const part of parts) {
    const enumId = enumIdOfPart(context, part);
    if (enumId !== undefined) {
      enumIds.add(enumId);
      if (part.flags & TYPE_FLAG_NUMBER_LITERAL) {
        enumValueKinds.push("number");
      } else if (part.flags & TYPE_FLAG_STRING_LITERAL) {
        enumValueKinds.push("string");
      }
    }
    if (part.flags & TYPE_FLAG_NUMBER_LIKE) {
      numberLike = true;
    }
    if (part.flags & TYPE_FLAG_STRING_LIKE) {
      stringLike = true;
    }
  }
  operand.__enumTypeIds = [...enumIds];
  operand.__unionPartEnumValueKinds = enumValueKinds;
  if (numberLike) {
    operand.__isNumberLike = true;
  }
  if (stringLike) {
    operand.__isStringLike = true;
  }
}

const unsafeEnumComparisonFacts: FactProvider = (context, node, _sink) => {
  void _sink;
  if (node.type === "BinaryExpression") {
    if (!ENUM_COMPARISON_OPERATORS.has(node.operator)) {
      return;
    }
    annotateEnumComparisonOperand(context, node.left);
    annotateEnumComparisonOperand(context, node.right);
    return;
  }
  if (node.type === "SwitchCase") {
    if (!node.test) {
      return;
    }
    const discriminant = node.parent?.discriminant;
    if (!discriminant) {
      return;
    }
    annotateEnumComparisonOperand(context, node.test);
    annotateEnumComparisonOperand(context, discriminant);
    (node as any).__switchDiscriminant = discriminant;
  }
};

// ---------------------------------------------------------------------------
// no-redundant-type-constituents
// ---------------------------------------------------------------------------

const TYPE_PART_FLAG_LABELS: readonly (readonly [number, string])[] = [
  [TYPE_FLAG_ANY, "any"],
  [TYPE_FLAG_UNKNOWN, "unknown"],
  [TYPE_FLAG_NEVER, "never"],
  [TYPE_FLAG_STRING, "string"],
  [TYPE_FLAG_NUMBER, "number"],
  [TYPE_FLAG_BIGINT, "bigint"],
  [TYPE_FLAG_BOOLEAN, "boolean"],
  [TYPE_FLAG_STRING_LITERAL, "stringLiteral"],
  [TYPE_FLAG_NUMBER_LITERAL, "numberLiteral"],
  [TYPE_FLAG_BIGINT_LITERAL, "bigintLiteral"],
  [TYPE_FLAG_BOOLEAN_LITERAL, "booleanLiteral"],
  [TYPE_FLAG_TEMPLATE_LITERAL, "templateLiteral"],
];

function typePartFlagLabel(flags: number): string {
  for (const [mask, label] of TYPE_PART_FLAG_LABELS) {
    if (flags & mask) {
      return label;
    }
  }
  return "other";
}

/** Type-node kinds whose semantics the Rust side can already derive locally. */
const LOCALLY_RESOLVED_TYPE_NODE_KINDS = new Set([
  "TSAnyKeyword",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSLiteralType",
  "TSNeverKeyword",
  "TSNumberKeyword",
  "TSStringKeyword",
  "TSTemplateLiteralType",
  "TSUnknownKeyword",
]);

const redundantTypeConstituentsFacts: FactProvider = (context, node, _sink) => {
  void _sink;
  if (node.type !== "TSUnionType" && node.type !== "TSIntersectionType") {
    return;
  }
  for (const constituent of Array.isArray(node.types) ? node.types : []) {
    if (
      !constituent ||
      LOCALLY_RESOLVED_TYPE_NODE_KINDS.has(constituent.type) ||
      constituent.__typePartFlags
    ) {
      continue;
    }
    const type = typeAtNode(context, constituent);
    if (!type) {
      continue;
    }
    constituent.__typePartFlags = unionPartsOfType(context, type).map((part) => ({
      flag: typePartFlagLabel(part.flags),
      text: renderedTypeText(context, part),
    }));
  }
};

// ---------------------------------------------------------------------------
// require-await (yield facts)
// ---------------------------------------------------------------------------

const requireAwaitFacts: FactProvider = (context, node, _sink) => {
  void _sink;
  if (node.generator !== true) {
    return;
  }
  forEachNodeOfType(node.body, "YieldExpression", (yieldNode: any) => {
    const argument = yieldNode.argument;
    if (!argument) {
      return;
    }
    if (yieldNode.delegate === true) {
      const propertyNames = propertyNamesAt(context, argument);
      if (propertyNames.some((name) => name.startsWith("__@asyncIterator"))) {
        yieldNode.__yieldDelegatesAsyncIterable = true;
      }
      return;
    }
    const texts = typeTextsAtNode(context, argument);
    const thenable =
      texts.some((text) =>
        text
          .split("|")
          .some((part) => part.trim().startsWith("Promise<") || part.trim().startsWith("PromiseLike<")),
      ) || propertyNamesAt(context, argument).includes("then");
    if (thenable) {
      yieldNode.__yieldArgumentThenable = true;
    }
  });
};

function propertyNamesAt(context: ContextWithParserOptions, node: any): readonly string[] {
  const type = typeAtNode(context, node);
  if (!type) {
    return [];
  }
  return checkerFor(context)
    .getPropertiesOfType(type)
    .map((property) => property.name);
}

/** Depth-limited walk over an ESTree subtree, skipping parent backlinks. */
function forEachNodeOfType(
  root: any,
  kind: string,
  visit: (node: any) => void,
  depthLimit = 6,
): void {
  if (!root || typeof root !== "object" || depthLimit < 0) {
    return;
  }
  if (Array.isArray(root)) {
    for (const item of root) {
      forEachNodeOfType(item, kind, visit, depthLimit);
    }
    return;
  }
  if (typeof root.type === "string" && root.type === kind) {
    visit(root);
  }
  for (const [key, value] of Object.entries(root)) {
    if (key === "parent" || value === null || typeof value !== "object") {
      continue;
    }
    forEachNodeOfType(value, kind, visit, depthLimit - 1);
  }
}

// ---------------------------------------------------------------------------
// unbound-method
// ---------------------------------------------------------------------------

const SYMBOL_FLAG_METHOD = 1 << 13;

/**
 * Faithful ESTree port of the upstream `isSafeUse` parent walk.
 */
function isSafeUse(start: any): boolean {
  let node = start;
  let parent = start?.parent;
  while (parent) {
    switch (parent.type) {
      case "ChainExpression":
      case "TSNonNullExpression":
      case "TSAsExpression":
      case "TSTypeAssertion":
        node = parent;
        parent = parent.parent;
        continue;
      case "IfStatement":
      case "ForStatement":
      case "MemberExpression":
      case "SwitchStatement":
      case "WhileStatement":
        return true;
      case "UpdateExpression":
        return parent.operator === "++" || parent.operator === "--";
      case "UnaryExpression":
        return ["!", "delete", "typeof", "void"].includes(parent.operator);
      case "CallExpression":
        return stripChainExpression(parent.callee) === node;
      case "ConditionalExpression":
        return parent.test === node;
      case "TaggedTemplateExpression":
        return parent.tag === node;
      case "LogicalExpression":
        if (parent.operator === "&&" && parent.left === node) {
          return true;
        }
        node = parent;
        parent = parent.parent;
        continue;
      case "BinaryExpression":
        if (["!=", "!==", "==", "===", "instanceof"].includes(parent.operator)) {
          return true;
        }
        return false;
      case "AssignmentExpression":
        return (
          parent.left === node ||
          (node.type === "MemberExpression" &&
            node.object?.type === "Super" &&
            parent.left?.type === "MemberExpression" &&
            parent.left.object?.type === "ThisExpression")
        );
      default:
        return false;
    }
  }
  return false;
}

interface UnboundMethodInfo {
  isMethod: boolean;
  firstParamIsThis: boolean;
  thisArgIsVoid: boolean;
  isStatic: boolean;
}

/**
 * Resolves the method-shape bundle for a member reference through the
 * checker. Returns undefined (rule stays silent) when the shape cannot be
 * proven — including an unknowable `static` modifier while `ignoreStatic`
 * is on.
 */
function unboundMethodInfoAt(
  context: ContextWithParserOptions,
  lookupNode: any,
  ignoreStatic: boolean,
): UnboundMethodInfo | undefined {
  const checker = checkerFor(context);
  const symbol = checker.getSymbolAtLocation(lookupNode);
  if (!symbol) {
    return undefined;
  }
  const isMethod = (symbol.flags & SYMBOL_FLAG_METHOD) !== 0;
  let firstParamIsThis = false;
  let thisArgIsVoid = false;
  if (isMethod) {
    const type = checker.getTypeOfSymbol(symbol);
    const signature = type ? checker.getSignaturesOfType(type, 0)[0] : undefined;
    if (signature?.thisParameterSymbol || signature?.thisParameter) {
      firstParamIsThis = true;
      const thisTexts = signature.thisParameterTypeTexts ?? [];
      thisArgIsVoid = thisTexts.length > 0 && thisTexts.every((text) => text.trim() === "void");
    }
  }
  const isStatic = staticModifierFor(context, symbol);
  if (isMethod && ignoreStatic && isStatic === undefined) {
    // Reporting a static method that ignoreStatic excludes would be a false
    // positive, so degrade to silence when staticness is unknowable.
    return undefined;
  }
  return {
    isMethod,
    firstParamIsThis,
    thisArgIsVoid,
    isStatic: isStatic ?? false,
  };
}

/**
 * Determines the `static` modifier by reading the declaration's leading text
 * when the declaration lives in the current file. Compact node handles carry
 * no source offset, so staticness can be unknowable.
 */
function staticModifierFor(
  context: ContextWithParserOptions,
  symbol: { readonly valueDeclaration?: string; readonly declarations: readonly string[] },
): boolean | undefined {
  const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
  if (!declaration) {
    return undefined;
  }
  const [posPart, , ...pathParts] = declaration.split(".");
  const path = pathParts.join(".");
  const filename = String(context.filename ?? "");
  if (!path || !(path === filename || filename.endsWith(path) || path.endsWith(filename))) {
    return undefined;
  }
  const pos = Number(posPart);
  if (!Number.isFinite(pos) || pos < 0) {
    return undefined;
  }
  const source = context.sourceCode.text;
  if (pos > source.length) {
    return undefined;
  }
  const lineStart = source.lastIndexOf("\n", pos) + 1;
  return /\bstatic\b/.test(source.slice(lineStart, pos + 1));
}

function insideTypeDeclaration(node: any): boolean {
  for (let current = node?.parent; current; current = current.parent) {
    const kind = current.type;
    if (
      kind === "TSInterfaceDeclaration" ||
      kind === "TSTypeAliasDeclaration" ||
      kind === "TSTypeLiteral" ||
      kind === "TSDeclareFunction" ||
      (typeof kind === "string" && kind.startsWith("TSType"))
    ) {
      return true;
    }
  }
  return false;
}

const unboundMethodFacts: FactProvider = (context, node, sink) => {
  const options = (context as { options?: readonly unknown[] }).options?.[0] as
    | { ignoreStatic?: boolean }
    | undefined;
  const ignoreStatic = options?.ignoreStatic === true;

  if (node.type === "MemberExpression") {
    if (isSafeUse(node)) {
      sink.fields.__safeUse = true;
      return;
    }
    const property = node.computed ? undefined : node.property;
    if (!property || property.type !== "Identifier") {
      return;
    }
    const info = unboundMethodInfoAt(context, property, ignoreStatic);
    if (info) {
      sink.fields.__unboundMethodInfo = { ...info };
    }
    const objectSymbol =
      node.object?.type === "Identifier"
        ? checkerFor(context).getSymbolAtLocation(node.object)
        : undefined;
    if (objectSymbol) {
      const declaration = objectSymbol.valueDeclaration ?? objectSymbol.declarations[0];
      if (declaration) {
        const path = declaration.split(".").slice(2).join(".");
        const filename = String(context.filename ?? "");
        if (path && !(path === filename || filename.endsWith(path))) {
          sink.fields.__objectNotImported = true;
        }
      }
    }
    return;
  }

  if (node.type === "ObjectPattern") {
    if (insideTypeDeclaration(node)) {
      sink.fields.__insideTypeDeclaration = true;
      return;
    }
    annotateDestructuredProperties(context, node, ignoreStatic);
    return;
  }

  if (node.type === "ObjectExpression") {
    if (node.parent?.type === "AssignmentExpression" && node.parent.left === node) {
      sink.fields.__isAssignmentTarget = true;
      annotateDestructuredProperties(context, node, ignoreStatic);
    }
  }
};

function annotateDestructuredProperties(
  context: ContextWithParserOptions,
  node: any,
  ignoreStatic: boolean,
): void {
  for (const property of Array.isArray(node.properties) ? node.properties : []) {
    if (!property || typeof property !== "object") {
      continue;
    }
    if (property.type === "RestElement" || property.type === "SpreadElement") {
      property.__isRest = true;
      continue;
    }
    if (property.computed) {
      property.__isComputed = true;
      continue;
    }
    const key = property.key;
    if (key?.type !== "Identifier") {
      continue;
    }
    const info = unboundMethodInfoAt(context, key, ignoreStatic);
    if (info) {
      property.__unboundMethodInfo = { ...info };
    }
  }
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
  "no-redundant-type-constituents": [redundantTypeConstituentsFacts],
  "no-unsafe-argument": [unsafeArgumentFacts],
  "no-unsafe-enum-comparison": [unsafeEnumComparisonFacts],
  "require-await": [requireAwaitFacts],
  "unbound-method": [unboundMethodFacts],
};
