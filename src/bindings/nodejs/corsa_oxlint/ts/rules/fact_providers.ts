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
// no-misused-spread
// ---------------------------------------------------------------------------

const SYMBOL_FLAG_CLASS = 1 << 5;
const TYPE_FLAG_UNDEFINED = 1 << 2;

function specifierNamesFromOption(options: unknown, key: string): string[] {
  const list = (options as Record<string, unknown> | undefined)?.[key];
  if (!Array.isArray(list)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      names.push(entry);
    } else if (entry && typeof entry === "object") {
      const name = (entry as { name?: unknown }).name;
      if (typeof name === "string") {
        names.push(name);
      } else if (Array.isArray(name)) {
        names.push(...name.filter((item): item is string => typeof item === "string"));
      }
    }
  }
  return names;
}

const misusedSpreadFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "SpreadElement" && node.type !== "JSXSpreadAttribute") {
    return;
  }
  const argument = node.argument;
  if (!argument) {
    return;
  }
  const checker = checkerFor(context);
  const type = typeAtNode(context, argument);
  if (!type) {
    return;
  }
  const parts = unionPartsOfType(context, type);

  const allowNames = specifierNamesFromOption(
    (context as { options?: readonly unknown[] }).options?.[0],
    "allow",
  );
  if (allowNames.length > 0) {
    const matches = parts.some((part) => {
      const text = renderedTypeText(context, part).trim();
      const name = text.slice(0, text.search(/[<\s|&]/) === -1 ? text.length : text.search(/[<\s|&]/));
      return allowNames.includes(name || text);
    });
    if (matches) {
      sink.fields.__spreadAllowed = true;
      return;
    }
  }

  let isString = false;
  let isPromiseLike = false;
  let isFunctionWithoutProps = false;
  let isMapType = false;
  let allPartsMap = parts.length > 0;
  let isArray = false;
  let isIterable = false;
  let isClassInstance = false;
  let isClassDeclaration = false;

  for (const part of parts) {
    const text = renderedTypeText(context, part).trim();
    if (part.flags & TYPE_FLAG_STRING_LIKE) {
      isString = true;
    }
    const partIsMap =
      text.startsWith("Map<") || text.startsWith("ReadonlyMap<") || text.startsWith("WeakMap<");
    if (partIsMap) {
      isMapType = true;
    } else {
      allPartsMap = false;
    }
    if (text.startsWith("Promise<") || text.startsWith("PromiseLike<")) {
      isPromiseLike = true;
    }
    if (isArrayLikeTypeText(text)) {
      isArray = true;
    }
    const properties = checker.getPropertiesOfType(part);
    const propertyNames = properties.map((property) => property.name);
    if (propertyNames.includes("then")) {
      isPromiseLike = true;
    }
    if (propertyNames.some((name) => name.startsWith("__@iterator"))) {
      isIterable = true;
    }
    const hasCallSignatures =
      checker.getSignaturesOfType(part, 0).length > 0 ||
      checker.getSignaturesOfType(part, 1).length > 0;
    if (hasCallSignatures && properties.length === 0) {
      isFunctionWithoutProps = true;
    }
    const symbol = checker.getSymbolOfType(part);
    if (symbol && (symbol.flags & SYMBOL_FLAG_CLASS) !== 0) {
      if (text.startsWith("typeof ")) {
        isClassDeclaration = true;
      } else {
        isClassInstance = true;
      }
    }
  }

  if (isString) sink.fields.__spreadIsString = true;
  if (isPromiseLike) sink.fields.__spreadIsPromise = true;
  if (isFunctionWithoutProps) sink.fields.__spreadIsFunctionWithoutProps = true;
  if (isMapType) sink.fields.__spreadIsMap = true;
  sink.fields.__spreadAllUnionPartsMap = allPartsMap && isMapType;
  if (isArray) sink.fields.__spreadIsArray = true;
  if (isIterable) sink.fields.__spreadIsIterable = true;
  if (isClassInstance) sink.fields.__spreadIsClassInstance = true;
  if (isClassDeclaration) sink.fields.__spreadIsClassDeclaration = true;

  // The facts live on the ARGUMENT node in the Rust rule.
  for (const key of Object.keys(sink.fields)) {
    if (key.startsWith("__spread")) {
      argument[key] = sink.fields[key];
      delete sink.fields[key];
    }
  }

  // Sole-property object-literal suggestion facts.
  const parent = node.parent;
  if (parent?.type === "ObjectExpression" && Array.isArray(parent.properties)) {
    sink.fields.__objectPropertyCount = parent.properties.length;
    if (Array.isArray(parent.range)) {
      sink.fields.__objectStart = parent.range[0];
      sink.fields.__objectEnd = parent.range[1];
    }
  }
};

// ---------------------------------------------------------------------------
// no-duplicate-type-constituents
// ---------------------------------------------------------------------------

const duplicateTypeConstituentsFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "TSUnionType" && node.type !== "TSIntersectionType") {
    return;
  }
  let ancestor = node.parent;
  while (ancestor?.type === "TSParenthesizedType") {
    ancestor = ancestor.parent;
  }
  if (ancestor?.type === node.type) {
    sink.fields.__sameKindAncestor = true;
  }
  if (node.type === "TSUnionType") {
    // `param?: A | undefined` — the parent annotation's holder is optional.
    const holder = node.parent?.type === "TSTypeAnnotation" ? node.parent.parent : undefined;
    if (holder?.optional === true) {
      sink.fields.__parentOptionalParam = true;
    }
  }
  for (const constituent of Array.isArray(node.types) ? node.types : []) {
    if (!constituent || constituent.__resolvedTypeId) {
      continue;
    }
    const type = typeAtNode(context, constituent);
    if (!type) {
      continue;
    }
    const text = renderedTypeText(context, type);
    if (text === "error") {
      continue;
    }
    constituent.__resolvedTypeId = type.id;
    if (type.flags & TYPE_FLAG_UNDEFINED) {
      constituent.__isUndefinedType = true;
    }
  }
};


// ---------------------------------------------------------------------------
// strict-boolean-expressions
// ---------------------------------------------------------------------------

const TYPE_FLAG_NULL = 1 << 3;
const TYPE_FLAG_VOID = 1 << 4;
const TYPE_FLAG_ES_SYMBOL = 1 << 9;
const TYPE_FLAG_UNIQUE_ES_SYMBOL = 1 << 14;
const TYPE_FLAG_NON_PRIMITIVE = 1 << 17;
const TYPE_FLAG_TYPE_PARAMETER = 1 << 19;
const TYPE_FLAG_OBJECT = 1 << 20;
const TYPE_FLAG_INDEX = 1 << 21;
const TYPE_FLAG_SUBSTITUTION = 1 << 24;
const TYPE_FLAG_INDEXED_ACCESS = 1 << 25;
const TYPE_FLAG_CONDITIONAL = 1 << 26;

interface ConditionPartDescriptor {
  variant: string;
  isTruthy: boolean;
  isEnum: boolean;
}

function conditionPartDescriptor(
  context: ContextWithParserOptions,
  part: CorsaType,
): ConditionPartDescriptor {
  const flags = part.flags;
  const isEnum = (flags & TYPE_FLAG_ENUM_LITERAL) !== 0;
  let variant: string;
  let isTruthy = false;
  if (flags & (TYPE_FLAG_UNDEFINED | TYPE_FLAG_NULL | TYPE_FLAG_VOID)) {
    variant = "nullish";
  } else if (flags & (TYPE_FLAG_BOOLEAN | TYPE_FLAG_BOOLEAN_LITERAL)) {
    variant = "boolean";
    isTruthy = part.value === true || renderedTypeText(context, part) === "true";
  } else if (flags & TYPE_FLAG_STRING_LIKE) {
    variant = "string";
    isTruthy =
      (flags & TYPE_FLAG_STRING_LITERAL) !== 0 &&
      typeof part.value === "string" &&
      part.value.length > 0;
  } else if (flags & (TYPE_FLAG_NUMBER | TYPE_FLAG_NUMBER_LITERAL | TYPE_FLAG_ENUM)) {
    variant = "number";
    isTruthy =
      (flags & TYPE_FLAG_NUMBER_LITERAL) !== 0 &&
      typeof part.value === "number" &&
      part.value !== 0;
  } else if (flags & (TYPE_FLAG_BIGINT | TYPE_FLAG_BIGINT_LITERAL)) {
    variant = "bigint";
    const literal =
      typeof part.value === "object" && part.value !== null
        ? (part.value as { base10Value?: string }).base10Value
        : part.value;
    isTruthy =
      (flags & TYPE_FLAG_BIGINT_LITERAL) !== 0 &&
      (typeof literal === "string" || typeof literal === "number") &&
      String(literal) !== "0";
  } else if (flags & TYPE_FLAG_ANY) {
    variant = "any";
  } else if (flags & TYPE_FLAG_UNKNOWN) {
    variant = "unknown";
  } else if (flags & TYPE_FLAG_NEVER) {
    variant = "never";
  } else if (
    flags &
    (TYPE_FLAG_TYPE_PARAMETER | TYPE_FLAG_INDEX | TYPE_FLAG_INDEXED_ACCESS | TYPE_FLAG_CONDITIONAL | TYPE_FLAG_SUBSTITUTION)
  ) {
    variant = "generic";
  } else if (
    flags &
    (TYPE_FLAG_OBJECT | TYPE_FLAG_NON_PRIMITIVE | TYPE_FLAG_ES_SYMBOL | TYPE_FLAG_UNIQUE_ES_SYMBOL)
  ) {
    variant = "object";
    isTruthy = true;
  } else {
    variant = "mixed";
  }
  return { variant, isTruthy, isEnum };
}

function annotateConditionParts(context: ContextWithParserOptions, node: any): void {
  if (!node || typeof node !== "object" || node.__conditionTypeParts) {
    return;
  }
  if (node.type === "LogicalExpression") {
    annotateConditionParts(context, node.left);
    annotateConditionParts(context, node.right);
    return;
  }
  if (node.type === "UnaryExpression" && node.operator === "!") {
    annotateConditionParts(context, node.argument);
    return;
  }
  const inner = stripChainExpression(node);
  const type = typeAtNode(context, inner);
  if (!type) {
    return;
  }
  const descriptors = unionPartsOfType(context, type).map((part) =>
    conditionPartDescriptor(context, part),
  );
  node.__conditionTypeParts = descriptors;
  if (inner !== node) {
    inner.__conditionTypeParts = descriptors;
  }
}

/** TypePredicateKind values mirror the upstream checker (asserts x is index 3). */
const PREDICATE_KIND_ASSERTS_IDENTIFIER = 3;

const strictBooleanExpressionsFacts: FactProvider = (context, node, sink) => {
  switch (node.type) {
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ConditionalExpression":
      annotateConditionParts(context, node.test);
      return;
    case "UnaryExpression":
      if (node.operator === "!") {
        annotateConditionParts(context, node.argument);
      }
      return;
    case "LogicalExpression":
      annotateConditionParts(context, node);
      return;
    case "CallExpression": {
      const callee = stripChainExpression(node.callee);
      if (!callee) {
        return;
      }
      const checker = checkerFor(context);
      const calleeType = typeAtNode(context, callee);
      const signature = calleeType ? checker.getSignaturesOfType(calleeType, 0)[0] : undefined;
      if (signature) {
        const predicate = checker.getTypePredicateOfSignature(signature);
        if (
          predicate &&
          predicate.kind === PREDICATE_KIND_ASSERTS_IDENTIFIER &&
          predicate.parameterIndex >= 0 &&
          Array.isArray(node.arguments) &&
          node.arguments[predicate.parameterIndex]
        ) {
          sink.fields.__truthinessAssertedArgumentIndex = predicate.parameterIndex;
          annotateConditionParts(context, node.arguments[predicate.parameterIndex]);
        }
      }
      if (
        callee.type === "MemberExpression" &&
        ARRAY_PREDICATE_METHODS.has(memberPropertyName(callee) ?? "") &&
        typeTextsAtNode(context, callee.object).some(isArrayLikeTypeText)
      ) {
        sink.fields.__arrayMethodPredicateCall = true;
        const predicateArg = node.arguments?.[0];
        if (predicateArg && typeof predicateArg === "object") {
          const argType = typeAtNode(context, predicateArg);
          const argSignature = argType
            ? checkerFor(context).getSignaturesOfType(argType, 0)[0]
            : undefined;
          const returnType = argSignature
            ? checkerFor(context).getReturnTypeOfSignature(argSignature)
            : undefined;
          if (returnType) {
            predicateArg.__predicateReturnTypeParts = unionPartsOfType(context, returnType).map(
              (part) => conditionPartDescriptor(context, part),
            );
          }
        }
      }
      return;
    }
    default:
  }
};

// ---------------------------------------------------------------------------
// switch-exhaustiveness-check
// ---------------------------------------------------------------------------

const TYPE_FLAG_LITERAL_LIKE =
  TYPE_FLAG_STRING_LITERAL |
  TYPE_FLAG_NUMBER_LITERAL |
  TYPE_FLAG_BIGINT_LITERAL |
  TYPE_FLAG_BOOLEAN_LITERAL |
  TYPE_FLAG_ENUM_LITERAL |
  TYPE_FLAG_UNDEFINED |
  TYPE_FLAG_NULL;

const switchExhaustivenessFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "SwitchStatement" || !node.discriminant) {
    return;
  }
  const type = typeAtNode(context, node.discriminant);
  if (!type) {
    return;
  }
  const parts = unionPartsOfType(context, type);
  sink.fields.__discriminantContainsNonLiteral = parts.some(
    (part) => (part.flags & TYPE_FLAG_LITERAL_LIKE) === 0,
  );

  const coveredTypeIds = new Set<string>();
  for (const switchCase of Array.isArray(node.cases) ? node.cases : []) {
    if (!switchCase?.test) {
      continue;
    }
    const testType = typeAtNode(context, switchCase.test);
    if (testType) {
      coveredTypeIds.add(testType.id);
    }
  }
  const missing = parts.filter((part) => !coveredTypeIds.has(part.id));
  sink.fields.__missingBranchTexts = missing.map((part) => renderedTypeText(context, part));
  sink.fields.__missingBranchCaseTests = missing.map((part) => renderedTypeText(context, part));

  const source = context.sourceCode.text;
  const blockStart = source.indexOf("{", node.discriminant.range[1]);
  if (blockStart !== -1 && Array.isArray(node.range)) {
    sink.fields.__caseBlockRange = [blockStart, node.range[1]];
  }
  const anchor = node.cases?.[0] ?? node;
  if (Array.isArray(anchor.range)) {
    const lineStart = source.lastIndexOf("\n", anchor.range[0]) + 1;
    const indent = source.slice(lineStart, anchor.range[0]);
    if (/^\s*$/.test(indent)) {
      sink.fields.__caseIndent = indent;
    }
  }
};

// ---------------------------------------------------------------------------
// prefer-nullish-coalescing (syntactic facts)
// ---------------------------------------------------------------------------

const preferNullishCoalescingFacts: FactProvider = (_context, node, sink) => {
  const parent = node.parent;
  if (parent?.type === "LogicalExpression" && typeof parent.operator === "string") {
    sink.fields.__parentLogicalOperator = parent.operator;
  }
  for (let current = parent; current; current = current.parent) {
    if (
      current.type === "CallExpression" &&
      current.callee?.type === "Identifier" &&
      current.callee.name === "Boolean"
    ) {
      sink.fields.__inBooleanConstructorCall = true;
      break;
    }
    if (typeof current.type === "string" && current.type.endsWith("Statement")) {
      break;
    }
  }
};


// ---------------------------------------------------------------------------
// no-unnecessary-type-assertion
// ---------------------------------------------------------------------------

const TYPE_FLAG_LITERAL =
  TYPE_FLAG_STRING_LITERAL |
  TYPE_FLAG_NUMBER_LITERAL |
  TYPE_FLAG_BIGINT_LITERAL |
  TYPE_FLAG_BOOLEAN_LITERAL;

function nullishTopFlagLabels(
  context: ContextWithParserOptions,
  type: CorsaType,
): string[] {
  const labels = new Set<string>();
  for (const part of unionPartsOfType(context, type)) {
    if (part.flags & TYPE_FLAG_ANY) labels.add("any");
    if (part.flags & TYPE_FLAG_UNKNOWN) labels.add("unknown");
    if (part.flags & TYPE_FLAG_NULL) labels.add("null");
    if (part.flags & TYPE_FLAG_UNDEFINED) labels.add("undefined");
    if (part.flags & TYPE_FLAG_VOID) labels.add("void");
  }
  return [...labels];
}

/** Best-effort contextual type for an expression position. */
function contextualTypeForNode(context: ContextWithParserOptions, node: any): CorsaType | undefined {
  const parent = node.parent;
  if (!parent) {
    return undefined;
  }
  if (parent.type === "VariableDeclarator" && parent.init === node && parent.id?.typeAnnotation) {
    return typeAtNode(context, parent.id);
  }
  if (parent.type === "AssignmentExpression" && parent.right === node) {
    return typeAtNode(context, parent.left);
  }
  return undefined;
}

const unnecessaryTypeAssertionFacts: FactProvider = (context, node, sink) => {
  if (
    node.type !== "TSAsExpression" &&
    node.type !== "TSTypeAssertion" &&
    node.type !== "TSNonNullExpression"
  ) {
    return;
  }
  const expression = node.expression;
  if (!expression) {
    return;
  }

  if (node.type === "TSNonNullExpression") {
    sink.fields.__exclamationRange = [expression.range[1], node.range[1]];
    const parent = node.parent;
    if (parent?.type === "AssignmentExpression" && parent.left === node) {
      sink.fields.__isAssignmentLeft = true;
    }
    const expressionType = typeAtNode(context, expression);
    if (expressionType) {
      sink.fields.__expressionTypeFlags = nullishTopFlagLabels(context, expressionType);
    }
    const contextualType = contextualTypeForNode(context, node);
    if (contextualType) {
      sink.fields.__contextualTypeFlags = nullishTopFlagLabels(context, contextualType);
    }
    if (expression.type === "Identifier") {
      if (letDeclarationWithoutInitializer(context, expression)) {
        sink.fields.__possiblyUsedBeforeAssigned = true;
      }
    }
    return;
  }

  // `expr as T` / `<T>expr`
  if (node.type === "TSAsExpression") {
    sink.fields.__assertionRange = [expression.range[1], node.range[1]];
    sink.fields.__removeRange = [expression.range[1], node.range[1]];
  } else {
    sink.fields.__assertionRange = [node.range[0], expression.range[0]];
    sink.fields.__removeRange = [node.range[0], expression.range[0]];
  }

  const castType = typeAtNode(context, node);
  const uncastType = typeAtNode(context, expression);
  if (castType && (castType.flags & TYPE_FLAG_LITERAL) !== 0) {
    sink.fields.__castTypeIsLiteral = true;
  }
  if (castType && uncastType && castType.id === uncastType.id) {
    sink.fields.__typeIsUnchanged = true;
  }

  const parent = node.parent;
  const declarator = parent?.type === "VariableDeclarator" ? parent : undefined;
  if (
    (declarator && declarator.parent?.kind === "const" && !declarator.id?.typeAnnotation) ||
    (parent?.type === "PropertyDefinition" && parent.readonly === true)
  ) {
    sink.fields.__implicitlyNarrowedLiteralDeclaration = true;
  }
};

/**
 * Whether the identifier resolves to a same-file `let`/`var` declaration
 * without an initializer (the definite-assignment pattern `x!`).
 */
function letDeclarationWithoutInitializer(
  context: ContextWithParserOptions,
  identifier: any,
): boolean {
  const symbol = checkerFor(context).getSymbolAtLocation(identifier);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (!declaration) {
    return false;
  }
  const [posPart, , ...pathParts] = declaration.split(".");
  const path = pathParts.join(".");
  const filename = String(context.filename ?? "");
  if (!path || !(path === filename || filename.endsWith(path) || path.endsWith(filename))) {
    return false;
  }
  const pos = Number(posPart);
  const source = context.sourceCode.text;
  if (!Number.isFinite(pos) || pos < 0 || pos > source.length) {
    return false;
  }
  const statementEnd = source.indexOf(";", pos);
  const statement = source.slice(
    Math.max(0, source.lastIndexOf("\n", pos)),
    statementEnd === -1 ? source.length : statementEnd,
  );
  return /\b(?:let|var)\b/.test(statement) && !statement.includes("=");
}


// ---------------------------------------------------------------------------
// related-getter-setter-pairs
// ---------------------------------------------------------------------------

const relatedGetterSetterFacts: FactProvider = (context, node, _sink) => {
  void _sink;
  const members: any[] = node.body?.body ?? node.members ?? [];
  if (!Array.isArray(members) || members.length === 0) {
    return;
  }
  const checker = checkerFor(context);
  const setterParamTypes = new Map<string, CorsaType>();
  for (const member of members) {
    if (member?.kind !== "set" || member.key?.type !== "Identifier") {
      continue;
    }
    const param = member.value?.params?.[0];
    if (!param) {
      continue;
    }
    const paramType = typeAtNode(context, param);
    if (paramType) {
      setterParamTypes.set(member.key.name, paramType);
    }
  }
  if (setterParamTypes.size === 0) {
    return;
  }
  for (const member of members) {
    if (member?.kind !== "get" || member.key?.type !== "Identifier") {
      continue;
    }
    const setterType = setterParamTypes.get(member.key.name);
    if (!setterType) {
      continue;
    }
    const annotation = member.value?.returnType;
    const getterType = annotation
      ? typeAtNode(context, annotation.typeAnnotation ?? annotation)
      : undefined;
    if (!getterType) {
      continue;
    }
    const assignable = checker.isTypeAssignableTo(getterType, setterType);
    if (assignable !== undefined) {
      member.__getterTypeAssignableToSetter = assignable;
    }
  }
};

// ---------------------------------------------------------------------------
// strict-void-return
// ---------------------------------------------------------------------------

function isVoidReturnTextList(texts: readonly string[]): boolean {
  return (
    texts.length > 0 &&
    texts.every((text) => {
      const trimmed = text.trim();
      return trimmed === "void" || trimmed === "undefined" || trimmed === "Promise<void>";
    })
  );
}

const strictVoidReturnFacts: FactProvider = (context, node, sink) => {
  if (node.type === "CallExpression" || node.type === "NewExpression") {
    const callFacts = sink.fields.__callFacts as
      | { expectedArgumentTypeTexts?: readonly (readonly string[])[] }
      | undefined;
    const expected = callFacts?.expectedArgumentTypeTexts;
    if (!expected) {
      return;
    }
    const args = Array.isArray(node.arguments) ? node.arguments : [];
    expected.forEach((slotTexts, index) => {
      const argument = args[index];
      if (!argument || typeof argument !== "object") {
        return;
      }
      const returnTexts: string[] = [];
      for (const text of slotTexts) {
        const returnText = returnTextOfFunctionTypeText(text);
        if (returnText) {
          returnTexts.push(returnText);
        }
      }
      if (isVoidReturnTextList(returnTexts)) {
        argument.__voidReturnExpected = true;
        annotateApparentReturnTexts(context, argument);
      }
    });
    return;
  }

  if (node.type === "VariableDeclarator" && node.init && node.id?.typeAnnotation) {
    const expectedTexts = returnTypeTextsOfType(context, typeAtNode(context, node.id));
    if (isVoidReturnTextList(expectedTexts)) {
      node.init.__voidReturnExpected = true;
      annotateApparentReturnTexts(context, node.init);
    }
    return;
  }

  if (node.type === "AssignmentExpression" && node.right) {
    const expectedTexts = returnTypeTextsOfType(context, typeAtNode(context, node.left));
    if (isVoidReturnTextList(expectedTexts)) {
      node.right.__voidReturnExpected = true;
      annotateApparentReturnTexts(context, node.right);
    }
  }
};

function annotateApparentReturnTexts(context: ContextWithParserOptions, value: any): void {
  if (value.__functionApparentReturnTypeTexts) {
    return;
  }
  const inner = stripChainExpression(value);
  if (inner.type === "ArrowFunctionExpression" || inner.type === "FunctionExpression") {
    // Function literals have no position-addressable checker type; derive the
    // apparent return texts from the literal itself.
    const texts = functionLiteralReturnTexts(context, inner);
    if (texts.length > 0) {
      value.__functionApparentReturnTypeTexts = texts;
    }
    return;
  }
  const valueType = typeAtNode(context, inner);
  const texts = returnTypeTextsOfType(context, valueType);
  if (texts.length > 0) {
    value.__functionApparentReturnTypeTexts = texts;
  }
}

function functionLiteralReturnTexts(context: ContextWithParserOptions, fn: any): string[] {
  if (fn.returnType) {
    const annotation = fn.returnType.typeAnnotation ?? fn.returnType;
    const text = context.sourceCode.getText(annotation);
    if (text) {
      return fn.async === true ? [`Promise<${text}>`] : [text];
    }
  }
  if (fn.async === true) {
    return ["Promise<unknown>"];
  }
  if (fn.body && fn.body.type !== "BlockStatement") {
    const bodyType = typeAtNode(context, stripChainExpression(fn.body));
    if (bodyType) {
      return unionPartsOfType(context, bodyType).map((part) => renderedTypeText(context, part));
    }
    return [];
  }
  const returnTexts = new Set<string>();
  let sawValueReturn = false;
  forEachNodeOfType(fn.body, "ReturnStatement", (returnNode: any) => {
    if (!returnNode.argument) {
      returnTexts.add("void");
      return;
    }
    sawValueReturn = true;
    const argumentType = typeAtNode(context, stripChainExpression(returnNode.argument));
    if (argumentType) {
      for (const part of unionPartsOfType(context, argumentType)) {
        returnTexts.add(renderedTypeText(context, part));
      }
    }
  });
  if (!sawValueReturn) {
    return ["void"];
  }
  return [...returnTexts];
}

// ---------------------------------------------------------------------------
// prefer-optional-chain
// ---------------------------------------------------------------------------

function nullishPartsDescriptor(
  context: ContextWithParserOptions,
  type: CorsaType,
): Record<string, boolean> {
  const parts = unionPartsOfType(context, type);
  const descriptor = {
    hasNull: false,
    hasUndefined: false,
    hasAny: false,
    hasUnknown: false,
    hasBigIntLike: false,
    hasBooleanLike: false,
    hasNumberLike: false,
    hasStringLike: false,
    hasFalsyNonNullishLiteral: false,
  };
  for (const part of parts) {
    const flags = part.flags;
    if (flags & TYPE_FLAG_NULL) descriptor.hasNull = true;
    if (flags & (TYPE_FLAG_UNDEFINED | TYPE_FLAG_VOID)) descriptor.hasUndefined = true;
    if (flags & TYPE_FLAG_ANY) descriptor.hasAny = true;
    if (flags & TYPE_FLAG_UNKNOWN) descriptor.hasUnknown = true;
    if (flags & (TYPE_FLAG_BIGINT | TYPE_FLAG_BIGINT_LITERAL)) descriptor.hasBigIntLike = true;
    if (flags & (TYPE_FLAG_BOOLEAN | TYPE_FLAG_BOOLEAN_LITERAL)) descriptor.hasBooleanLike = true;
    if (flags & (TYPE_FLAG_NUMBER | TYPE_FLAG_NUMBER_LITERAL | TYPE_FLAG_ENUM))
      descriptor.hasNumberLike = true;
    if (flags & TYPE_FLAG_STRING_LIKE) descriptor.hasStringLike = true;
    const falsyLiteral =
      (flags & TYPE_FLAG_STRING_LITERAL && part.value === "") ||
      (flags & TYPE_FLAG_NUMBER_LITERAL && part.value === 0) ||
      ((flags & TYPE_FLAG_BOOLEAN_LITERAL) !== 0 &&
        renderedTypeText(context, part) === "false");
    if (falsyLiteral) descriptor.hasFalsyNonNullishLiteral = true;
  }
  return descriptor;
}

function annotateNullishParts(context: ContextWithParserOptions, target: any, depth = 4): void {
  if (!target || typeof target !== "object" || depth < 0) {
    return;
  }
  const kind = target.type;
  if (kind === "LogicalExpression" || kind === "BinaryExpression") {
    annotateNullishParts(context, target.left, depth - 1);
    annotateNullishParts(context, target.right, depth - 1);
    return;
  }
  if (kind === "UnaryExpression") {
    annotateNullishParts(context, target.argument, depth - 1);
    return;
  }
  if (kind === "ChainExpression") {
    annotateNullishParts(context, target.expression, depth);
    return;
  }
  if (kind !== "Identifier" && kind !== "MemberExpression" && kind !== "CallExpression") {
    return;
  }
  if (target.__nullishParts) {
    return;
  }
  const type = typeAtNode(context, target);
  if (type) {
    target.__nullishParts = nullishPartsDescriptor(context, type);
  }
  if (kind === "MemberExpression") {
    annotateNullishParts(context, target.object, depth - 1);
  }
}

const preferOptionalChainFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "LogicalExpression") {
    return;
  }
  for (let current = node.parent; current; current = current.parent) {
    if (typeof current.type === "string" && current.type.startsWith("JSX")) {
      sink.fields.__insideJsx = true;
      break;
    }
    if (typeof current.type === "string" && current.type.endsWith("Statement")) {
      break;
    }
  }
  const parent = node.parent;
  if (parent?.type === "LogicalExpression" && typeof parent.operator === "string") {
    sink.fields.__parentOperator = parent.operator;
  }
  annotateNullishParts(context, node);
};

// ---------------------------------------------------------------------------
// no-unnecessary-boolean-literal-compare
// ---------------------------------------------------------------------------

function annotateTypeParameterConstraint(context: ContextWithParserOptions, operand: any): void {
  if (!operand || typeof operand !== "object" || operand.__constraintTypeTexts) {
    return;
  }
  const type = typeAtNode(context, stripChainExpression(operand));
  if (!type || (type.flags & TYPE_FLAG_TYPE_PARAMETER) === 0) {
    return;
  }
  const constraint = checkerFor(context).getConstraintOfType(type);
  if (!constraint) {
    operand.__isUnconstrainedTypeParameter = true;
    return;
  }
  operand.__constraintTypeTexts = unionPartsOfType(context, constraint).map((part) =>
    renderedTypeText(context, part),
  );
}

const booleanLiteralCompareFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "BinaryExpression") {
    return;
  }
  const parent = node.parent;
  if (parent?.type === "UnaryExpression") {
    sink.fields.__parentUnaryOperator = parent.operator;
    if (Array.isArray(parent.range)) {
      sink.fields.__unaryParentStart = parent.range[0];
      sink.fields.__unaryParentEnd = parent.range[1];
    }
  }
  annotateTypeParameterConstraint(context, node.left);
  annotateTypeParameterConstraint(context, node.right);
};

// ---------------------------------------------------------------------------
// return-await
// ---------------------------------------------------------------------------

const STRONG_PRECEDENCE_KINDS = new Set([
  "Identifier",
  "Literal",
  "MemberExpression",
  "CallExpression",
  "NewExpression",
  "TemplateLiteral",
  "TaggedTemplateExpression",
  "ThisExpression",
  "ArrayExpression",
  "ObjectExpression",
  "ArrowFunctionExpression",
  "FunctionExpression",
  "ClassExpression",
  "ParenthesizedExpression",
]);

const returnAwaitFacts: FactProvider = (context, node, _sink) => {
  void _sink;
  const targets: any[] = [];
  if (node.type === "ReturnStatement" && node.argument) {
    targets.push(node.argument);
  } else if (node.type === "ArrowFunctionExpression" && node.body?.type !== "BlockStatement") {
    targets.push(node.body);
  }
  for (const rawTarget of targets) {
    const target = stripChainExpression(rawTarget);
    const value = target?.type === "AwaitExpression" ? target.argument : target;
    if (!value || typeof value !== "object") {
      continue;
    }
    const inner = stripChainExpression(value);
    if (!inner.__awaitableCertainty) {
      const type = typeAtNode(context, inner);
      if (type) {
        const parts = unionPartsOfType(context, type);
        const thenableParts = parts.filter((part) => {
          const text = renderedTypeText(context, part);
          return (
            text.startsWith("Promise<") ||
            text.startsWith("PromiseLike<") ||
            text === "Promise" ||
            (part.flags & (TYPE_FLAG_ANY | TYPE_FLAG_UNKNOWN)) !== 0
          );
        });
        const certainty =
          thenableParts.length === parts.length && parts.length > 0
            ? "always"
            : thenableParts.length > 0
              ? "may"
              : "never";
        inner.__awaitableCertainty = certainty;
        if (inner !== value) {
          value.__awaitableCertainty = certainty;
        }
      }
    }
    if (STRONG_PRECEDENCE_KINDS.has(inner.type)) {
      inner.__isHigherPrecedenceThanAwait = true;
    }
  }
};

// ---------------------------------------------------------------------------
// promise-function-async / consistent-return / prefer-return-this-type
// ---------------------------------------------------------------------------

function functionSignatureReturnTexts(context: ContextWithParserOptions, node: any): string[] {
  // Prefer the declared annotation; fall back to the checker through an
  // addressable lookup node (the function name or the annotation itself).
  if (node.returnType) {
    const annotation = node.returnType.typeAnnotation ?? node.returnType;
    const text = context.sourceCode.getText(annotation);
    if (text) {
      return [text];
    }
  }
  const lookup = node.id ?? node.key;
  if (!lookup) {
    return [];
  }
  return returnTypeTextsOfType(context, typeAtNode(context, lookup));
}

const promiseFunctionAsyncFacts: FactProvider = (context, node, sink) => {
  const fn = node.type === "MethodDefinition" ? node.value : node;
  if (!fn || typeof fn !== "object") {
    return;
  }
  if (node.type === "MethodDefinition" || node.type === "TSAbstractMethodDefinition") {
    if (node.type === "TSAbstractMethodDefinition" || node.abstract === true) {
      sink.fields.__isAbstract = true;
    }
  }
  if (fn.returnType) {
    sink.fields.__hasExplicitReturnType = true;
  }
  const texts = functionSignatureReturnTexts(context, node.type === "MethodDefinition" ? { ...fn, key: node.key, returnType: fn.returnType } : node);
  if (texts.length > 0) {
    sink.fields.__signatureReturnTypeTexts = [texts];
  }
};

const consistentReturnFacts: FactProvider = (context, node, sink) => {
  const texts = functionSignatureReturnTexts(context, node);
  if (
    texts.length > 0 &&
    texts.every((text) => {
      const trimmed = text.trim();
      return (
        trimmed === "void" ||
        trimmed === "undefined" ||
        trimmed === "Promise<void>" ||
        trimmed === "Promise<undefined>"
      );
    })
  ) {
    sink.fields.__allowsVoidReturn = true;
  }
  const body = node.body;
  if (body?.type === "BlockStatement" && Array.isArray(body.body)) {
    const last = body.body[body.body.length - 1];
    const terminal =
      last &&
      (last.type === "ReturnStatement" ||
        last.type === "ThrowStatement" ||
        (last.type === "ForStatement" && !last.test) ||
        (last.type === "WhileStatement" && last.test?.value === true));
    if (!terminal) {
      sink.fields.__hasImplicitReturn = true;
    }
  }
};

const preferReturnThisTypeFacts: FactProvider = (context, node, sink) => {
  const classNode = findEnclosingClass(node);
  const classType = classNode?.id ? typeAtNode(context, classNode.id) : undefined;
  let containsThisReturn = false;
  let containsClassTypeReturn = false;
  const body = node.body;
  if (body && body.type !== "BlockStatement") {
    if (body.type === "ThisExpression") {
      sink.fields.__conciseBodyIsThisType = true;
    }
  }
  forEachNodeOfType(body, "ReturnStatement", (returnNode: any) => {
    const argument = stripChainExpression(returnNode.argument);
    if (!argument) {
      return;
    }
    if (argument.type === "ThisExpression") {
      containsThisReturn = true;
      return;
    }
    if (classType) {
      const returnedType = typeAtNode(context, argument);
      if (returnedType && returnedType.id === classType.id) {
        containsClassTypeReturn = true;
      }
    }
  });
  if (containsThisReturn) {
    sink.fields.__returnsContainThisType = true;
  }
  if (containsClassTypeReturn) {
    sink.fields.__returnsContainClassType = true;
  }
};

function findEnclosingClass(node: any): any {
  for (let current = node?.parent; current; current = current.parent) {
    if (current.type === "ClassDeclaration" || current.type === "ClassExpression") {
      return current;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// non-nullable-type-assertion-style
// ---------------------------------------------------------------------------

const nonNullableAssertionStyleFacts: FactProvider = (context, node, sink) => {
  if (node.type !== "TSAsExpression" && node.type !== "TSTypeAssertion") {
    return;
  }
  const annotation = node.typeAnnotation;
  if (
    annotation?.type === "TSTypeReference" &&
    annotation.typeName?.type === "Identifier" &&
    annotation.typeName.name === "const"
  ) {
    sink.fields.__isConstAssertion = true;
    return;
  }
  const expression = node.expression;
  const expressionType = expression ? typeAtNode(context, stripChainExpression(expression)) : undefined;
  if (expressionType) {
    const parts = unionPartsOfType(context, expressionType);
    if (parts.some((part) => (part.flags & (TYPE_FLAG_ANY | TYPE_FLAG_UNKNOWN)) !== 0)) {
      sink.fields.__expressionLoose = true;
    } else {
      sink.fields.__expressionUnionTypeTexts = parts.map((part) =>
        renderedTypeText(context, part),
      );
    }
  }
  const assertedType = annotation ? typeAtNode(context, annotation) : undefined;
  if (assertedType) {
    const parts = unionPartsOfType(context, assertedType);
    if (parts.some((part) => (part.flags & (TYPE_FLAG_ANY | TYPE_FLAG_UNKNOWN)) !== 0)) {
      sink.fields.__assertedLoose = true;
    } else {
      sink.fields.__assertedUnionTypeTexts = parts.map((part) => renderedTypeText(context, part));
      sink.fields.__assertedPartCouldBeNullable = parts.map((part) => {
        if ((part.flags & TYPE_FLAG_TYPE_PARAMETER) === 0) {
          return false;
        }
        const constraint = checkerFor(context).getConstraintOfType(part);
        if (!constraint) {
          return true;
        }
        return unionPartsOfType(context, constraint).some(
          (constraintPart) =>
            (constraintPart.flags &
              (TYPE_FLAG_NULL | TYPE_FLAG_UNDEFINED | TYPE_FLAG_VOID | TYPE_FLAG_ANY | TYPE_FLAG_UNKNOWN)) !==
            0,
        );
      });
    }
  }
  if (expression && STRONG_PRECEDENCE_KINDS.has(stripChainExpression(expression).type)) {
    sink.fields.__higherPrecedenceThanUnary = true;
  }
};

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
  "consistent-return": [consistentReturnFacts],
  "no-duplicate-type-constituents": [duplicateTypeConstituentsFacts],
  "no-misused-promises": [misusedPromisesFacts],
  "no-misused-spread": [misusedSpreadFacts],
  "no-redundant-type-constituents": [redundantTypeConstituentsFacts],
  "no-unnecessary-boolean-literal-compare": [booleanLiteralCompareFacts],
  "no-unnecessary-type-assertion": [unnecessaryTypeAssertionFacts],
  "non-nullable-type-assertion-style": [nonNullableAssertionStyleFacts],
  "no-unsafe-argument": [unsafeArgumentFacts],
  "no-unsafe-enum-comparison": [unsafeEnumComparisonFacts],
  "prefer-nullish-coalescing": [preferNullishCoalescingFacts],
  "prefer-optional-chain": [preferOptionalChainFacts],
  "prefer-return-this-type": [preferReturnThisTypeFacts],
  "promise-function-async": [promiseFunctionAsyncFacts],
  "related-getter-setter-pairs": [relatedGetterSetterFacts],
  "return-await": [returnAwaitFacts],
  "require-await": [requireAwaitFacts],
  "strict-boolean-expressions": [strictBooleanExpressionsFacts],
  "strict-void-return": [strictVoidReturnFacts],
  "switch-exhaustiveness-check": [switchExhaustivenessFacts],
  "unbound-method": [unboundMethodFacts],
};
