import type { Node } from "@oxlint/plugins";

import { createNodeMaps, toPosition } from "./node_map";
import { sessionForContext } from "./registry";
import { uniqueClassDeclarationPosition } from "./session";
import type { CorsaProjectSession } from "./session";
import { SignatureKind } from "./types";
import type {
  ContextWithParserOptions,
  CorsaNode,
  CorsaProgramShape,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypeCheckerShape,
} from "./types";

type ImplementingClassDeclarations = {
  /** Ranges of the classes that carry an `implements` clause, keyed by name. */
  readonly byName: ReadonlyMap<string, readonly (readonly [start: number, end: number])[]>;
  /**
   * Names declared by more than one class in the file. A lookup by simple name
   * cannot tell those declarations apart, so it needs a declaration position to
   * pick the right one.
   */
  readonly ambiguousNames: ReadonlySet<string>;
};

type ImplementingClassCache = {
  readonly sourceText: string;
  readonly declarations: ImplementingClassDeclarations;
};

const implementingClassNamesBySession = new WeakMap<
  CorsaProjectSession,
  Map<string, ImplementingClassCache>
>();

export function createProgram(
  context: ContextWithParserOptions,
): CorsaProgramShape & { readonly nodeMaps: ReturnType<typeof createNodeMaps> } {
  const nodeMaps = createNodeMaps(context);
  return {
    nodeMaps,
    getCompilerOptions() {
      return sessionForContext(context).session.getCompilerOptions();
    },
    getCurrentDirectory() {
      return sessionForContext(context).project.rootDir;
    },
    getRootFileNames() {
      return sessionForContext(context).session.getRootFileNames();
    },
    getSourceFile(fileName = context.filename) {
      return { fileName, text: context.sourceCode.text };
    },
    getTypeChecker() {
      return createTypeChecker(context);
    },
  };
}

export function createTypeChecker(context: ContextWithParserOptions): CorsaTypeCheckerShape {
  return {
    getTypeAtLocation(node) {
      const kind = (node as { readonly type?: string }).type;
      if (kind === "NewExpression") {
        return typeOfNewExpression(context, node as Node, this);
      }
      // A position query resolves the touching token, which for call-like
      // expressions is the callee leaf — never the call result. Resolve the
      // result through the callee's call signatures instead, the same way
      // NewExpression resolves through construct signatures.
      if (kind === "CallExpression") {
        const resolved = typeOfCallExpression(context, node as Node, this);
        if (resolved) {
          return resolved;
        }
      }
      if (kind === "AwaitExpression") {
        const resolved = typeOfAwaitExpression(node as Node, this);
        if (resolved) {
          return resolved;
        }
      }
      const lookupNode = nodeForTypeLookup(node);
      const type = sessionForContext(context).session.getTypeAtSourceRange(
        filenameFor(context, lookupNode),
        toPosition(lookupNode),
        endPosition(lookupNode),
        sourceTextFor(context, lookupNode),
        nodeKind(lookupNode),
      );
      primeImplementedTypesCacheFromNode(context, node, type, this);
      return type;
    },
    getContextualType(node) {
      return this.getTypeAtLocation(node);
    },
    getSymbolAtLocation(node) {
      const lookupNode = nodeForTypeLookup(node);
      return sessionForContext(context).session.getSymbolAtPosition(
        filenameFor(context, lookupNode),
        toPosition(lookupNode),
        sourceTextFor(context, lookupNode),
      );
    },
    getSymbol(symbol) {
      return sessionForContext(context).session.getSymbol(symbol);
    },
    getSymbolById(id) {
      return sessionForContext(context).session.getSymbol(id);
    },
    getSymbolOfType(type) {
      return sessionForContext(context).session.getSymbolOfType(type);
    },
    getJsDocTags(symbol) {
      return sessionForContext(context).session.getJsDocTags(symbol);
    },
    isTypeAssignableTo(source, target) {
      return sessionForContext(context).session.isTypeAssignableTo(source, target);
    },
    getNode(node) {
      return sessionForContext(context).session.getNode(node);
    },
    getNodeById(id) {
      return sessionForContext(context).session.getNode(id);
    },
    getTypeOfSymbol(symbol) {
      return sessionForContext(context).session.getTypeOfSymbol(symbol);
    },
    getTypeOfSymbolById(id) {
      return sessionForContext(context).session.getTypeOfSymbolById(id);
    },
    getDeclaredTypeOfSymbol(symbol) {
      return sessionForContext(context).session.getDeclaredTypeOfSymbol(symbol);
    },
    getDeclaredTypeOfSymbolById(id) {
      return sessionForContext(context).session.getDeclaredTypeOfSymbolById(id);
    },
    getTypeOfSymbolAtLocation(symbol, node) {
      return (
        this.getTypeOfSymbol(symbol) ??
        this.getDeclaredTypeOfSymbol(symbol) ??
        this.getTypeAtLocation(node)
      );
    },
    typeToString(type, enclosingDeclaration, flags) {
      void enclosingDeclaration;
      if (flags === undefined) {
        const syntheticText = syntheticTypeText(type);
        if (syntheticText !== undefined) {
          return syntheticText;
        }
      }
      return sessionForContext(context).session.typeToString(type, flags);
    },
    getBaseTypeOfLiteralType(type) {
      return sessionForContext(context).session.getBaseTypeOfLiteralType(type);
    },
    getPropertiesOfType(type) {
      return sessionForContext(context).session.getPropertiesOfType(type);
    },
    getSignaturesOfType(type, kind) {
      return sessionForContext(context).session.getSignaturesOfType(type, kind);
    },
    getCallSignatureFacts(type, kind, argumentTypeTexts, explicitTypeArgumentTexts) {
      return sessionForContext(context).session.getCallSignatureFacts(
        type,
        kind,
        argumentTypeTexts,
        explicitTypeArgumentTexts,
      );
    },
    getReturnTypeOfSignature(signature) {
      return sessionForContext(context).session.getReturnTypeOfSignature(signature);
    },
    getTypePredicateOfSignature(signature) {
      return sessionForContext(context).session.getTypePredicateOfSignature(signature);
    },
    getBaseTypes(type) {
      // A constructor type in a superclass position resolves to its immediate
      // instance type first; the generic base-type cascade would skip past it
      // to the instance's own bases.
      if (isSuperclassConstructorLookup(context, type)) {
        const constructorBases = constructorBaseTypesFromType(context, type, this);
        if (constructorBases.length > 0) {
          return constructorBases;
        }
      }
      const bases = sessionForContext(context).session.getBaseTypes(type);
      return bases.length > 0 ? bases : constructorBaseTypesFromType(context, type, this);
    },
    getImplementedTypes(node) {
      if ("pos" in node) {
        return implementedTypesFromCorsaNode(context, node, this);
      }
      const sourceText = sourceTextFor(context, node);
      const sourceNode = sourceText ? corsaNodeFromEstree(context, node) : undefined;
      if (sourceText && sourceNode) {
        const implemented = implementedTypesFromSourceText(context, sourceNode, sourceText, this);
        if (implemented.length > 0) {
          return implemented;
        }
      }
      return implementedClauseNodes(node)
        .map((clause) => {
          const expression = implementedClauseChildNode(clause, "expression") ?? clause;
          const symbol = this.getSymbolAtLocation(expression) ?? this.getSymbolAtLocation(clause);
          return symbol
            ? (this.getDeclaredTypeOfSymbol(symbol) ?? this.getTypeOfSymbol(symbol))
            : (this.getTypeAtLocation(expression) ?? this.getTypeAtLocation(clause));
        })
        .filter((type): type is CorsaType => type !== undefined);
    },
    getImplementedTypesOfType(type) {
      return implementedTypesFromTypeAndBases(context, type, this);
    },
    getTypeArguments(type) {
      const syntheticArguments = (type as SyntheticSourceType).syntheticTypeArguments;
      if (syntheticArguments) {
        return syntheticArguments;
      }
      return sessionForContext(context).session.getTypeArguments(type);
    },
    getTypesOfType(type) {
      return (
        syntheticTypeConstituents(type) ?? sessionForContext(context).session.getTypesOfType(type)
      );
    },
    getTargetOfType(type) {
      return sessionForContext(context).session.getTargetOfType(type);
    },
    getTypeParametersOfType(type) {
      return sessionForContext(context).session.getTypeParametersOfType(type);
    },
    getOuterTypeParametersOfType(type) {
      return sessionForContext(context).session.getOuterTypeParametersOfType(type);
    },
    getLocalTypeParametersOfType(type) {
      return sessionForContext(context).session.getLocalTypeParametersOfType(type);
    },
    getObjectTypeOfType(type) {
      return sessionForContext(context).session.getObjectTypeOfType(type);
    },
    getIndexTypeOfType(type) {
      return sessionForContext(context).session.getIndexTypeOfType(type);
    },
    getCheckTypeOfType(type) {
      return sessionForContext(context).session.getCheckTypeOfType(type);
    },
    getExtendsTypeOfType(type) {
      return sessionForContext(context).session.getExtendsTypeOfType(type);
    },
    getBaseTypeOfType(type) {
      return sessionForContext(context).session.getBaseTypeOfType(type);
    },
    getConstraintOfType(type) {
      return (
        sessionForContext(context).session.getConstraintOfType(type) ??
        constraintFromTypeParameterSource(context, type, this)
      );
    },
    isUnionType(type) {
      return (type.flags & typeFlags.union) !== 0;
    },
    isIntersectionType(type) {
      return (type.flags & typeFlags.intersection) !== 0;
    },
  };
}

function primeImplementedTypesCacheFromNode(
  context: ContextWithParserOptions,
  node: Node | CorsaNode,
  type: CorsaType | undefined,
  checker: CorsaTypeCheckerShape,
): void {
  if (!type || "pos" in node) {
    return;
  }
  const kind = (node as { readonly type?: string }).type;
  if (kind !== "ClassDeclaration" && kind !== "ClassExpression") {
    return;
  }
  const session = sessionForContext(context).session;
  if (session.getCachedOwnImplementedTypes(type.id)) {
    return;
  }
  session.cacheOwnImplementedTypes(type.id, checker.getImplementedTypes(node));
}

const typeFlags = {
  union: 1 << 27,
  intersection: 1 << 28,
} as const;

type SyntheticCompoundType = CorsaType & {
  readonly syntheticTypes: readonly CorsaType[];
};

type SyntheticSourceType = CorsaType & {
  readonly syntheticText?: string;
  readonly syntheticTypeArguments?: readonly CorsaType[];
};

function sourceTextFor(
  context: ContextWithParserOptions,
  node: Node | CorsaNode | CorsaType | CorsaSymbol | CorsaSignature,
): string | undefined {
  return sourceTextForPath(context, filenameFor(context, node));
}

function sourceTextForPath(
  context: ContextWithParserOptions,
  fileName: string,
): string | undefined {
  return pathsReferToSameFile(fileName, context.filename)
    ? context.sourceCode.text
    : sessionForContext(context).session.getSourceTextForPath(fileName);
}

function pathsReferToSameFile(left: string, right: string): boolean {
  const normalizedLeft = left.replaceAll("\\", "/").toLowerCase();
  const normalizedRight = right.replaceAll("\\", "/").toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`)
  );
}

function syntheticTypeText(type: CorsaType): string | undefined {
  return (
    (type as SyntheticSourceType).syntheticText ??
    (isSyntheticCompoundType(type) ? type.texts[0] : undefined)
  );
}

function syntheticTypeConstituents(type: CorsaType): readonly CorsaType[] | undefined {
  return isSyntheticCompoundType(type) ? type.syntheticTypes : undefined;
}

function isSyntheticCompoundType(type: CorsaType): type is SyntheticCompoundType {
  return (
    type.id.startsWith("synthetic-compound:") &&
    Array.isArray((type as SyntheticCompoundType).syntheticTypes)
  );
}

function syntheticCompoundType(
  kind: "union" | "intersection",
  types: readonly CorsaType[],
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const uniqueTypes = uniqueTypesById(types);
  if (uniqueTypes.length === 0) {
    return undefined;
  }
  if (uniqueTypes.length === 1) {
    return uniqueTypes[0];
  }
  const separator = kind === "union" ? " | " : " & ";
  const text = uniqueTypes
    .map((type) => safeTypeToString(checker, type))
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(separator);
  if (!text) {
    return undefined;
  }
  return {
    __corsaOxlintKind: "type",
    id: `synthetic-compound:${kind}:${uniqueTypes.map((type) => type.id).join(separator)}`,
    flags: kind === "union" ? typeFlags.union : typeFlags.intersection,
    texts: [text],
    syntheticTypes: uniqueTypes,
  } as SyntheticCompoundType;
}

function syntheticSourceType(
  type: CorsaType,
  text: string,
  typeArguments: readonly CorsaType[],
): CorsaType {
  return {
    ...type,
    texts: [text],
    syntheticText: text,
    syntheticTypeArguments: typeArguments,
  } as SyntheticSourceType;
}

function uniqueTypesById(types: readonly CorsaType[]): readonly CorsaType[] {
  const seen = new Set<string>();
  const unique: CorsaType[] = [];
  for (const type of types) {
    if (seen.has(type.id)) {
      continue;
    }
    seen.add(type.id);
    unique.push(type);
  }
  return unique;
}

/**
 * Resolves the result type of a call expression through the callee's call
 * signatures.
 *
 * Position-based type lookups resolve the touching token, so the direct query
 * for a call expression range yields the callee's type. Going through the
 * call signature mirrors what `checker.getTypeAtLocation(callExpr)` means in
 * the real TypeScript API. Overloads resolve to the first signature, which is
 * the same approximation the NewExpression path uses.
 */
function typeOfCallExpression(
  context: ContextWithParserOptions,
  node: Node,
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const callee = childNode(node, "callee");
  if (!callee) {
    return undefined;
  }
  const calleeType = checker.getTypeAtLocation(callee);
  if (!calleeType) {
    return undefined;
  }
  const callSignature = checker.getSignaturesOfType(calleeType, SignatureKind.Call)[0];
  if (!callSignature) {
    return undefined;
  }
  const returnType = checker.getReturnTypeOfSignature(callSignature);
  if (!returnType) {
    return undefined;
  }
  sessionForContext(context).session.rememberTypeLookupFromType(returnType, calleeType);
  return returnType;
}

/**
 * Resolves `await expr` to the awaited type by unwrapping a promise-like
 * reference type's first type argument.
 */
function typeOfAwaitExpression(node: Node, checker: CorsaTypeCheckerShape): CorsaType | undefined {
  const argument = childNode(node, "argument");
  if (!argument) {
    return undefined;
  }
  const argumentType = checker.getTypeAtLocation(argument);
  if (!argumentType) {
    return undefined;
  }
  const rendered = argumentType.texts?.length
    ? argumentType.texts
    : [checker.typeToString(argumentType)];
  const isPromiseReference = rendered.some(
    (text) =>
      text.startsWith("Promise<") || text.startsWith("PromiseLike<") || text === "Promise",
  );
  if (!isPromiseReference) {
    return argumentType;
  }
  return checker.getTypeArguments(argumentType)[0] ?? argumentType;
}

function typeOfNewExpression(
  context: ContextWithParserOptions,
  node: Node,
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const callee = childNode(node, "callee");
  if (!callee) {
    return undefined;
  }
  const calleeType = checker.getTypeAtLocation(callee);
  if (!calleeType) {
    return undefined;
  }
  // A compound constructor type (`typeof Dog | typeof Cat`) must resolve
  // through its constituents so the instance type stays compound; the first
  // construct signature alone would collapse it to one branch.
  if (checker.isUnionType(calleeType) || checker.isIntersectionType(calleeType)) {
    const compound = constructorInstanceTypeFromType(context, calleeType, checker);
    if (compound) {
      sessionForContext(context).session.rememberTypeLookupFromType(compound, calleeType);
      return compound;
    }
  }
  const constructSignature = checker.getSignaturesOfType(calleeType, SignatureKind.Construct)[0];
  const type = constructSignature
    ? (checker.getReturnTypeOfSignature(constructSignature) ??
      constructorInstanceTypeFromType(context, calleeType, checker) ??
      calleeType)
    : (constructorInstanceTypeFromType(context, calleeType, checker) ?? calleeType);
  sessionForContext(context).session.rememberTypeLookupFromType(type, calleeType);
  return type;
}

function constructorBaseTypesFromType(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const constituentBases = constructorBaseTypesFromConstituents(context, type, checker);
  if (constituentBases.length > 0) {
    return constituentBases;
  }
  const instanceType = constructorInstanceTypeFromType(context, type, checker);
  if (!instanceType) {
    return [];
  }
  if (isSuperclassConstructorLookup(context, type)) {
    return [instanceType];
  }
  const instanceBases = sessionForContext(context).session.getBaseTypes(instanceType);
  return instanceBases.length > 0 ? instanceBases : [instanceType];
}

function constructorBaseTypesFromConstituents(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  if (!checker.isIntersectionType(type) && !checker.isUnionType(type)) {
    return [];
  }
  const bases: CorsaType[] = [];
  const seen = new Set<string>();
  for (const constituent of checker.getTypesOfType(type)) {
    const directBases = sessionForContext(context).session.getBaseTypes(constituent);
    const constituentBases =
      directBases.length > 0
        ? directBases
        : constructorBaseTypesFromType(context, constituent, checker);
    for (const base of constituentBases) {
      if (seen.has(base.id)) {
        continue;
      }
      seen.add(base.id);
      bases.push(base);
    }
  }
  return bases;
}

function constructorInstanceTypeFromType(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const constituentInstance = constructorInstanceTypeFromConstituents(context, type, checker);
  if (constituentInstance) {
    return constituentInstance;
  }
  return constructorInstanceTypeFromScalar(context, type, checker);
}

function constructorInstanceTypeFromConstituents(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const kind = compoundTypeKind(type, checker);
  if (!kind) {
    return undefined;
  }
  const constituents = checker.getTypesOfType(type);
  if (constituents.length === 0) {
    return undefined;
  }
  const instances: CorsaType[] = [];
  for (const constituent of constituents) {
    const instance = constructorInstanceTypeFromType(context, constituent, checker);
    if (!instance) {
      return undefined;
    }
    instances.push(instance);
  }
  return syntheticCompoundType(kind, instances, checker);
}

function constructorInstanceTypeFromScalar(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const text = safeTypeToString(checker, type);
  if (!text || !/\btypeof\s+/.test(text)) {
    return undefined;
  }
  const symbol = checker.getSymbolOfType(type);
  const declared = symbol ? checker.getDeclaredTypeOfSymbol(symbol) : undefined;
  if (
    declared &&
    declared.id !== type.id &&
    !safeTypeToString(checker, declared)?.includes("typeof ")
  ) {
    return declared;
  }
  const names = constructorTypeNames(text);
  return names.length === 1 ? typeFromClassName(context, names[0]!, checker, type) : undefined;
}

function compoundTypeKind(
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): "union" | "intersection" | undefined {
  if (checker.isUnionType(type)) {
    return "union";
  }
  return checker.isIntersectionType(type) ? "intersection" : undefined;
}

function constructorTypeNames(text: string): readonly string[] {
  const names: string[] = [];
  const pattern = /\btypeof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  return names;
}

function typeFromClassName(
  context: ContextWithParserOptions,
  name: string,
  checker: CorsaTypeCheckerShape,
  relatedType: CorsaType,
): CorsaType | undefined {
  const session = sessionForContext(context).session;
  const lookup = session.getTypeLookupSource(relatedType);
  const sourceText = lookup
    ? (lookup.sourceText ?? session.getSourceTextForPath(lookup.fileName))
    : context.sourceCode.text;
  const fileName = lookup?.fileName ?? context.filename;
  if (!sourceText) {
    return undefined;
  }
  const simpleName = lastQualifiedNamePart(name);
  const position = classIdentifierPosition(sourceText, name, lookup?.position);
  if (position === undefined) {
    return undefined;
  }
  return checker.getTypeAtLocation({
    fileName,
    pos: position,
    end: position + simpleName.length,
    range: [position, position + simpleName.length] as const,
  });
}

function classIdentifierPosition(
  sourceText: string,
  qualifiedName: string,
  anchorPosition: number | undefined,
): number | undefined {
  const parts = qualifiedName.split(".");
  const simpleName = parts.at(-1)!;
  const namespaceRange =
    parts.length > 1
      ? namespaceBodyRange(sourceText, parts.slice(0, -1), anchorPosition)
      : undefined;
  return classIdentifierPositionInRange(
    sourceText,
    simpleName,
    namespaceRange ?? [0, sourceText.length],
  );
}

function classIdentifierPositionInRange(
  sourceText: string,
  name: string,
  range: readonly [number, number],
): number | undefined {
  const pattern = new RegExp(
    `\\b(?:export\\s+)?(?:declare\\s+)?class\\s+${escapeRegExp(name)}\\b`,
    "g",
  );
  pattern.lastIndex = range[0];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceText))) {
    if (match.index >= range[1]) {
      return undefined;
    }
    return match.index + match[0].lastIndexOf(name);
  }
  return undefined;
}

function namespaceBodyRange(
  sourceText: string,
  names: readonly string[],
  anchorPosition: number | undefined,
): readonly [number, number] | undefined {
  let range: readonly [number, number] = [0, sourceText.length];
  for (const name of names) {
    const nextRange = namespaceBodyRangeForName(sourceText, name, range, anchorPosition);
    if (!nextRange) {
      return undefined;
    }
    range = nextRange;
  }
  return range;
}

function namespaceBodyRangeForName(
  sourceText: string,
  name: string,
  range: readonly [number, number],
  anchorPosition: number | undefined,
): readonly [number, number] | undefined {
  const pattern = new RegExp(`\\b(?:export\\s+)?namespace\\s+${escapeRegExp(name)}\\s*\\{`, "g");
  pattern.lastIndex = range[0];
  let fallback: readonly [number, number] | undefined;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceText))) {
    if (match.index >= range[1]) {
      break;
    }
    const bodyStart = sourceText.indexOf("{", match.index) + 1;
    const bodyEnd = matchingBraceEnd(sourceText, bodyStart - 1);
    if (bodyStart <= 0 || bodyEnd === undefined || bodyEnd > range[1]) {
      continue;
    }
    const bodyRange = [bodyStart, bodyEnd] as const;
    if (
      anchorPosition !== undefined &&
      anchorPosition >= bodyRange[0] &&
      anchorPosition <= bodyRange[1]
    ) {
      return bodyRange;
    }
    fallback ??= bodyRange;
  }
  return fallback;
}

function lastQualifiedNamePart(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

function matchingBraceEnd(sourceText: string, openBracePosition: number): number | undefined {
  let depth = 0;
  for (let index = openBracePosition; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function isSuperclassConstructorLookup(
  context: ContextWithParserOptions,
  type: CorsaType,
): boolean {
  const session = sessionForContext(context).session;
  const lookup = session.getTypeLookupSource(type);
  if (!lookup) {
    return false;
  }
  const sourceText = lookup.sourceText ?? session.getSourceTextForPath(lookup.fileName);
  if (!sourceText) {
    return false;
  }
  return /\bextends\s*$/.test(sourceText.slice(Math.max(0, lookup.position - 32), lookup.position));
}

function constraintFromTypeParameterSource(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const name = safeTypeToString(checker, type)?.trim();
  if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) {
    return undefined;
  }
  const session = sessionForContext(context).session;
  const lookup = session.getTypeLookupSource(type);
  const sourceText = lookup
    ? (lookup.sourceText ?? session.getSourceTextForPath(lookup.fileName))
    : context.sourceCode.text;
  const fileName = lookup?.fileName ?? context.filename;
  if (!sourceText) {
    return undefined;
  }
  const range = typeParameterConstraintRange(sourceText, name, lookup?.position);
  if (!range) {
    return undefined;
  }
  const constraintNode = {
    fileName,
    pos: range[0],
    end: range[1],
    range,
  };
  const symbol = checker.getSymbolAtLocation(constraintNode);
  const constraintType =
    (symbol
      ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
      : undefined) ?? checker.getTypeAtLocation(constraintNode);
  if (!constraintType) {
    return undefined;
  }
  const constraintText = sourceText.slice(range[0], range[1]).trim();
  const argumentTypes = typeArgumentRanges(sourceText, range[0], range[1])
    .map((argumentRange) => typeFromSourceRange(fileName, argumentRange, checker))
    .filter((argument): argument is CorsaType => argument !== undefined);
  return argumentTypes.length > 0
    ? syntheticSourceType(constraintType, constraintText, argumentTypes)
    : constraintType;
}

function typeFromSourceRange(
  fileName: string,
  range: readonly [number, number],
  checker: CorsaTypeCheckerShape,
): CorsaType | undefined {
  const node = {
    fileName,
    pos: range[0],
    end: range[1],
    range,
  };
  const symbol = checker.getSymbolAtLocation(node);
  return (
    (symbol
      ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
      : undefined) ?? checker.getTypeAtLocation(node)
  );
}

function typeParameterConstraintRange(
  sourceText: string,
  name: string,
  lookupPosition: number | undefined,
): readonly [number, number] | undefined {
  const candidate = typeParameterConstraintCandidate(sourceText, name, lookupPosition);
  return candidate ? [candidate.constraintStart, candidate.constraintEnd] : undefined;
}

type TypeParameterConstraintCandidate = {
  readonly nameStart: number;
  readonly nameEnd: number;
  readonly constraintStart: number;
  readonly constraintEnd: number;
  readonly declarationRange?: readonly [number, number];
};

function typeParameterConstraintCandidate(
  sourceText: string,
  name: string,
  lookupPosition: number | undefined,
): TypeParameterConstraintCandidate | undefined {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}\\s+extends\\s+`, "g");
  let selected: TypeParameterConstraintCandidate | undefined;
  let selectedScore = Number.NEGATIVE_INFINITY;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceText))) {
    const nameStart = match.index;
    const nameEnd = nameStart + name.length;
    const constraintStart = match.index + match[0].length;
    const constraintEnd = scanTypeParameterConstraintEnd(sourceText, constraintStart);
    if (constraintEnd <= constraintStart) {
      continue;
    }
    const declarationRange = declarationRangeForTypeParameter(sourceText, nameStart, constraintEnd);
    const candidate = {
      nameStart,
      nameEnd,
      constraintStart,
      constraintEnd,
      declarationRange,
    };
    if (lookupPosition !== undefined && lookupPosition >= nameStart && lookupPosition <= nameEnd) {
      return candidate;
    }
    const score = typeParameterConstraintCandidateScore(candidate, lookupPosition);
    if (score > selectedScore) {
      selected = candidate;
      selectedScore = score;
    }
  }
  return selected;
}

function typeParameterConstraintCandidateScore(
  candidate: TypeParameterConstraintCandidate,
  lookupPosition: number | undefined,
): number {
  if (lookupPosition === undefined) {
    return -candidate.nameStart;
  }
  const declarationRange = candidate.declarationRange;
  if (
    declarationRange &&
    lookupPosition >= declarationRange[0] &&
    lookupPosition <= declarationRange[1]
  ) {
    return declarationRange[0];
  }
  return candidate.nameStart <= lookupPosition ? candidate.nameStart - 1_000_000 : -2_000_000;
}

function declarationRangeForTypeParameter(
  sourceText: string,
  nameStart: number,
  constraintEnd: number,
): readonly [number, number] | undefined {
  const listStart = sourceText.lastIndexOf("<", nameStart);
  if (listStart === -1) {
    return undefined;
  }
  const listEnd = scanTypeParameterListEnd(sourceText, listStart);
  if (listEnd === undefined || listEnd < constraintEnd) {
    return undefined;
  }
  const bodyStart = sourceText.indexOf("{", listEnd);
  if (bodyStart === -1) {
    return [listStart, listEnd + 1];
  }
  const bodyEnd = matchingBraceEnd(sourceText, bodyStart);
  return bodyEnd === undefined ? [listStart, sourceText.length] : [listStart, bodyEnd + 1];
}

function scanTypeParameterListEnd(sourceText: string, listStart: number): number | undefined {
  let depth = 0;
  for (let index = listStart; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "<") {
      depth += 1;
    } else if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function scanTypeParameterConstraintEnd(sourceText: string, start: number): number {
  let end = start;
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  while (end < sourceText.length) {
    const char = sourceText[end]!;
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">") {
      if (angleDepth === 0) {
        break;
      }
      angleDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      if (braceDepth === 0) {
        break;
      }
      braceDepth -= 1;
    } else if (
      angleDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      braceDepth === 0 &&
      (char === "," || char === "=")
    ) {
      break;
    }
    end += 1;
  }
  while (end > start && /\s/.test(sourceText[end - 1]!)) {
    end -= 1;
  }
  return end;
}

function typeArgumentRanges(
  sourceText: string,
  start: number,
  end: number,
): readonly (readonly [number, number])[] {
  const open = sourceText.indexOf("<", start);
  if (open === -1 || open >= end) {
    return [];
  }
  const close = matchingAngleEnd(sourceText, open, end);
  if (close === undefined) {
    return [];
  }
  const ranges: (readonly [number, number])[] = [];
  let argumentStart = open + 1;
  let angleDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  for (let index = open + 1; index < close; index += 1) {
    const char = sourceText[index]!;
    if (char === "<") {
      angleDepth += 1;
    } else if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (
      char === "," &&
      angleDepth === 0 &&
      bracketDepth === 0 &&
      parenDepth === 0 &&
      braceDepth === 0
    ) {
      appendTrimmedRange(ranges, sourceText, argumentStart, index);
      argumentStart = index + 1;
    }
  }
  appendTrimmedRange(ranges, sourceText, argumentStart, close);
  return ranges;
}

function matchingAngleEnd(
  sourceText: string,
  openAnglePosition: number,
  limit: number,
): number | undefined {
  let depth = 0;
  for (let index = openAnglePosition; index < limit; index += 1) {
    const char = sourceText[index];
    if (char === "<") {
      depth += 1;
    } else if (char === ">") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return undefined;
}

function appendTrimmedRange(
  ranges: (readonly [number, number])[],
  sourceText: string,
  start: number,
  end: number,
): void {
  while (start < end && /\s/.test(sourceText[start]!)) {
    start += 1;
  }
  while (end > start && /\s/.test(sourceText[end - 1]!)) {
    end -= 1;
  }
  if (end > start) {
    ranges.push([start, end] as const);
  }
}

function safeTypeToString(checker: CorsaTypeCheckerShape, type: CorsaType): string | undefined {
  try {
    return checker.typeToString(type);
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nodeForTypeLookup(node: Node | CorsaNode): Node | CorsaNode {
  if ("pos" in node) {
    return node;
  }
  switch ((node as { readonly type?: string }).type) {
    case "ClassBody": {
      const parent = childNode(node, "parent");
      if (
        parent &&
        ((parent as { readonly type?: string }).type === "ClassDeclaration" ||
          (parent as { readonly type?: string }).type === "ClassExpression")
      ) {
        return childNode(parent, "id") ?? parent;
      }
      return node;
    }
    case "ClassDeclaration":
    case "ClassExpression":
      return childNode(node, "id") ?? node;
    case "TSPropertySignature":
      return childNode(node, "key") ?? node;
    case "PropertyDefinition":
    case "TSAbstractPropertyDefinition":
      return childNode(node, "typeAnnotation") ?? childNode(node, "key") ?? node;
    default:
      return node;
  }
}

function endPosition(node: Node | CorsaNode): number {
  if ("end" in node) {
    return node.end;
  }
  const range = (node as Node & { readonly range?: readonly [number, number] }).range;
  if (!range) {
    throw new Error("corsa oxlint requires ESTree nodes with range data");
  }
  return range[1];
}

function nodeKind(node: Node | CorsaNode): string | undefined {
  return "pos" in node ? undefined : (node as { readonly type?: string }).type;
}

function childNode(node: Node, key: string): Node | undefined {
  const value = (node as unknown as Record<string, unknown>)[key];
  if (isNode(value)) {
    return value;
  }
  return undefined;
}

function implementedClauseNodes(node: Node | CorsaNode): readonly Node[] {
  if ("pos" in node) {
    return [];
  }
  const clauses = (node as unknown as { readonly implements?: unknown }).implements;
  if (!Array.isArray(clauses)) {
    return [];
  }
  return clauses.filter(isNode);
}

function implementedClauseChildNode(node: Node, key: string): Node | undefined {
  const value = (node as unknown as Record<string, unknown>)[key];
  if (isNode(value)) {
    return value;
  }
  return undefined;
}

function implementedTypesFromCorsaNode(
  context: ContextWithParserOptions,
  node: CorsaNode,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const symbol = checker.getSymbolAtLocation(node);
  if (symbol) {
    const declaredType = checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol);
    if (declaredType) {
      const implemented = checker.getImplementedTypesOfType(declaredType);
      if (implemented.length > 0) {
        return implemented;
      }
    }
  }
  const sourceText = sourceTextFor(context, node);
  if (sourceText) {
    return implementedTypesFromSourceText(context, node, sourceText, checker);
  }
  const type = checker.getTypeAtLocation(node);
  return type ? checker.getImplementedTypesOfType(type) : [];
}

function corsaNodeFromEstree(context: ContextWithParserOptions, node: Node): CorsaNode | undefined {
  const range = (node as { readonly range?: unknown }).range;
  if (
    !Array.isArray(range) ||
    range.length < 2 ||
    typeof range[0] !== "number" ||
    typeof range[1] !== "number"
  ) {
    return undefined;
  }
  return {
    fileName: context.filename,
    pos: range[0],
    end: range[1],
    range: [range[0], range[1]] as const,
  };
}

function implementedTypesFromTypeAndBases(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const session = sessionForContext(context).session;
  const cached = session.getCachedImplementedTypes(type.id);
  if (cached) {
    return cached;
  }
  // Iterative DFS over the base chain so we don't pay for one closure call
  // and one `push(...subResult)` spread per base (each spread used to copy
  // the entire growing accumulator). Visit order doesn't matter because we
  // dedupe by `type.id`.
  const seenTypes = new Set<string>();
  const seenImplementedTypes = new Set<string>();
  const implemented: CorsaType[] = [];
  const stack: CorsaType[] = [type];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seenTypes.has(current.id)) {
      continue;
    }
    seenTypes.add(current.id);

    const ownImplemented = implementedTypesFromTypeDeclaration(context, current, checker);
    for (let index = 0; index < ownImplemented.length; index += 1) {
      const ownType = ownImplemented[index]!;
      if (seenImplementedTypes.has(ownType.id)) {
        continue;
      }
      seenImplementedTypes.add(ownType.id);
      implemented.push(ownType);
    }

    const bases = checker.getBaseTypes(current);
    // Push in reverse so the natural visit order matches the recursive form.
    for (let index = bases.length - 1; index >= 0; index -= 1) {
      const baseType = bases[index]!;
      if (seenTypes.has(baseType.id)) {
        continue;
      }
      stack.push(baseType);
    }
  }
  return session.cacheImplementedTypes(type.id, implemented);
}

function implementedTypesFromTypeDeclaration(
  context: ContextWithParserOptions,
  type: CorsaType,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  const session = sessionForContext(context).session;
  const cached = session.getCachedOwnImplementedTypes(type.id);
  if (cached) {
    return cached;
  }
  // Resolve through the session's type-symbol lookup first: it primes the
  // declaration-position caches for compact TypeScript 7 handles before the
  // source scans below run, while a direct `getSymbol(type.symbol)` cache hit
  // would skip that recovery.
  const symbol =
    checker.getSymbolOfType(type) ?? (type.symbol ? session.getSymbol(type.symbol) : undefined);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  const declarationNode = declaration ? session.getNode(declaration) : undefined;
  const scanDeclarationNode = declarationNodeForImplementsScan(context, symbol, declarationNode);
  const matchedDeclarationNode = session.getClassDeclarationForType(type);
  const localImplementingDeclaration =
    scanDeclarationNode && pathsReferToSameFile(scanDeclarationNode.fileName, context.filename)
      ? implementingClassDeclaration(context, type, symbol, scanDeclarationNode)
      : undefined;
  const resolvedDeclarationNode =
    matchedDeclarationNode ??
    localImplementingDeclaration ??
    scanDeclarationNode ??
    implementingClassDeclaration(context, type, symbol);
  const sourceText = resolvedDeclarationNode
    ? sourceTextForPath(context, resolvedDeclarationNode.fileName)
    : undefined;
  const implemented =
    resolvedDeclarationNode && sourceText
      ? implementedTypesFromSourceText(context, resolvedDeclarationNode, sourceText, checker)
      : [];
  return session.cacheOwnImplementedTypes(type.id, implemented);
}

/**
 * Returns a declaration node whose range can anchor an `implements` source
 * scan.
 *
 * Positional handles are used as-is. A compact TypeScript 7 declaration handle
 * carries a node id instead of source offsets, so its parsed range cannot
 * anchor a scan; the declaring file is searched for the symbol's unique class
 * declaration instead. An ambiguous name yields no node rather than a
 * same-named declaration from another scope.
 */
function declarationNodeForImplementsScan(
  context: ContextWithParserOptions,
  symbol: CorsaSymbol | undefined,
  declarationNode: CorsaNode | undefined,
): CorsaNode | undefined {
  if (!declarationNode?.positionless) {
    return declarationNode;
  }
  const name = symbol?.name;
  if (!name) {
    return undefined;
  }
  const sourceText = sourceTextForPath(context, declarationNode.fileName);
  if (!sourceText) {
    return undefined;
  }
  const pos = uniqueClassDeclarationPosition(sourceText, name);
  if (pos === undefined) {
    return undefined;
  }
  return {
    fileName: declarationNode.fileName,
    pos,
    end: sourceText.length,
    range: [pos, sourceText.length] as const,
  };
}

function implementingClassDeclaration(
  context: ContextWithParserOptions,
  type: CorsaType,
  symbol?: CorsaSymbol,
  declarationNode?: CorsaNode,
): CorsaNode | undefined {
  const name = implementingClassName(type, symbol);
  if (!name) {
    return undefined;
  }
  const { byName, ambiguousNames } = implementingClassDeclarations(context);
  const ranges = byName.get(name);
  if (!ranges || ranges.length === 0) {
    return undefined;
  }
  const range = ambiguousNames.has(name)
    ? declaredRange(ranges, declarationNode, context.filename)
    : ranges[0];
  return range
    ? {
        fileName: context.filename,
        pos: range[0],
        end: range[1],
        range,
      }
    : undefined;
}

/**
 * Picks the candidate whose `class` keyword sits inside `declarationNode`, which
 * is the declaration the symbol actually points at. Without a usable declaration
 * range there is nothing to disambiguate with, so the lookup gives up rather
 * than returning a same-named class from another scope.
 */
function declaredRange(
  ranges: readonly (readonly [start: number, end: number])[],
  declarationNode: CorsaNode | undefined,
  filename: string,
): readonly [start: number, end: number] | undefined {
  if (!declarationNode || !pathsReferToSameFile(declarationNode.fileName, filename)) {
    return undefined;
  }
  return ranges.find(([start]) => start >= declarationNode.pos && start < declarationNode.end);
}

function implementingClassName(type: CorsaType, symbol?: CorsaSymbol): string | undefined {
  return symbol?.name || typeSymbolName(type.texts ?? []);
}

function typeSymbolName(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const match =
      /^(?:typeof\s+)?(?:[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*\.)*([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)(?:\s*<|$)/u.exec(
        text.trim(),
      );
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function implementingClassDeclarations(
  context: ContextWithParserOptions,
): ImplementingClassDeclarations {
  const session = sessionForContext(context).session;
  let byFile = implementingClassNamesBySession.get(session);
  if (!byFile) {
    byFile = new Map();
    implementingClassNamesBySession.set(session, byFile);
  }
  const sourceText = context.sourceCode.text;
  const cached = byFile.get(context.filename);
  if (cached?.sourceText === sourceText) {
    return cached.declarations;
  }
  const declarations = collectImplementingClassDeclarations(sourceText);
  byFile.set(context.filename, { sourceText, declarations });
  return declarations;
}

function collectImplementingClassDeclarations(sourceText: string): ImplementingClassDeclarations {
  const byName = new Map<string, (readonly [start: number, end: number])[]>();
  const declaredNames = new Set<string>();
  const ambiguousNames = new Set<string>();
  let offset = 0;
  while (offset < sourceText.length) {
    const classOffset = findKeywordOutsideTrivia(sourceText.slice(offset), "class");
    if (classOffset < 0) {
      break;
    }
    const declarationStart = offset + classOffset + "class".length;
    const rest = sourceText.slice(declarationStart);
    const match = /^\s*([$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*)/u.exec(rest);
    if (match?.[1]) {
      const name = match[1];
      if (declaredNames.has(name)) {
        ambiguousNames.add(name);
      }
      declaredNames.add(name);
      const bodyOpen = findClassBodyOpen(rest, 0);
      const header = rest.slice(0, bodyOpen >= 0 ? bodyOpen : rest.length);
      if (findKeywordOutsideTrivia(header, "implements") >= 0) {
        const range = [offset + classOffset, sourceText.length] as const;
        const ranges = byName.get(name);
        if (ranges) {
          ranges.push(range);
        } else {
          byName.set(name, [range]);
        }
      }
    }
    offset = declarationStart;
  }
  return { byName, ambiguousNames };
}

function implementedTypesFromSourceText(
  context: ContextWithParserOptions,
  node: CorsaNode,
  sourceText: string,
  checker: CorsaTypeCheckerShape,
): readonly CorsaType[] {
  if (node.pos < 0 || node.end > sourceText.length || node.pos >= node.end) {
    return [];
  }
  const classText = sourceText.slice(node.pos, node.end);
  const classStart = findKeywordOutsideTrivia(classText, "class");
  const headerStart = classStart >= 0 ? classStart : 0;
  const bodyOpen = findClassBodyOpen(classText, headerStart);
  const headerText = classText.slice(headerStart, bodyOpen >= 0 ? bodyOpen : classText.length);
  const implementsIndex = findKeywordOutsideTrivia(headerText, "implements");
  if (implementsIndex < 0) {
    return [];
  }
  const clauseText = headerText.slice(implementsIndex + "implements".length);
  const clauseStart = node.pos + headerStart + implementsIndex + "implements".length;
  return splitTopLevelRanges(clauseText, ",")
    .map((range) => {
      const raw = clauseText.slice(range.start, range.end);
      const leading = raw.search(/\S/);
      if (leading < 0) {
        return undefined;
      }
      const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
      const pos = clauseStart + range.start + leading;
      const end = clauseStart + range.end - trailing;
      const lookupNode: CorsaNode = {
        fileName: node.fileName,
        pos,
        end,
        range: [pos, end] as const,
      };
      const nameNode = implementedClauseNameNode(lookupNode, raw);
      const symbol =
        checker.getSymbolAtLocation(nameNode) ?? checker.getSymbolAtLocation(lookupNode);
      const type = symbol
        ? (checker.getDeclaredTypeOfSymbol(symbol) ?? checker.getTypeOfSymbol(symbol))
        : (checker.getTypeAtLocation(nameNode) ?? checker.getTypeAtLocation(lookupNode));
      if (type) {
        try {
          checker.typeToString(type);
        } catch {
          // Corsa-side relation fallbacks handle stale type handles; avoid
          // deriving replacement text from source names in the JS bridge.
        }
      }
      return type;
    })
    .filter((type): type is CorsaType => type !== undefined);
}

function implementedClauseNameNode(node: CorsaNode, raw: string): CorsaNode {
  const range = lastTypeNameIdentifierRange(raw);
  if (!range) {
    return node;
  }
  const pos = node.pos + range.start;
  const end = node.pos + range.end;
  return {
    fileName: node.fileName,
    pos,
    end,
    range: [pos, end] as const,
  };
}

function lastTypeNameIdentifierRange(
  text: string,
): { readonly start: number; readonly end: number } | undefined {
  let last: { start: number; end: number } | undefined;
  const scanner = createScanner();
  for (let index = 0; index < text.length; index += 1) {
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    const char = text[index];
    if (char === "<") {
      break;
    }
    if (!isIdentifierStart(char)) {
      continue;
    }
    let end = index + 1;
    while (isIdentifierPart(text[end])) {
      end += 1;
    }
    last = { start: index, end };
    index = end - 1;
  }
  return last;
}

function findClassBodyOpen(text: string, start: number): number {
  const scanner = createScanner();
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = start; index < text.length; index += 1) {
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    const char = text[index];
    if (char === "<") angleDepth += 1;
    else if (char === ">") angleDepth = Math.max(0, angleDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (
      char === "{" &&
      angleDepth === 0 &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    } else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
  }
  return -1;
}

function findKeywordOutsideTrivia(text: string, keyword: string): number {
  const scanner = createScanner();
  for (let index = 0; index < text.length; index += 1) {
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
    if (matchesKeyword(text, keyword, index)) {
      return index;
    }
  }
  return -1;
}

function matchesKeyword(text: string, keyword: string, index: number): boolean {
  return (
    text.startsWith(keyword, index) &&
    !isIdentifierPart(text[index - 1]) &&
    !isIdentifierPart(text[index + keyword.length])
  );
}

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && (isIdentifierStart(char) || /[0-9]/.test(char));
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_$]/.test(char);
}

function splitTopLevelRanges(
  text: string,
  delimiter: string,
): readonly { readonly start: number; readonly end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const scanner = createScanner();
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextIndex = scanner.skip(text, index);
    if (nextIndex > index) {
      index = nextIndex - 1;
      continue;
    }
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
      ranges.push({ start, end: index });
      start = index + 1;
    }
  }
  ranges.push({ start, end: text.length });
  return ranges;
}

function createScanner(): {
  skip(text: string, index: number): number;
} {
  let quote: string | undefined;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  return {
    skip(text, index) {
      const char = text[index];
      const next = text[index + 1];
      if (inLineComment) {
        if (char === "\n" || char === "\r") {
          inLineComment = false;
        }
        return index + 1;
      }
      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          return index + 2;
        }
        return index + 1;
      }
      if (quote) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === quote) {
          quote = undefined;
        }
        return index + 1;
      }
      if (char === "/" && next === "/") {
        inLineComment = true;
        return index + 2;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        return index + 2;
      }
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        return index + 1;
      }
      return index;
    },
  };
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value && "range" in value;
}

function filenameFor(
  context: ContextWithParserOptions,
  node: Node | CorsaNode | CorsaType | CorsaSymbol | CorsaSignature,
): string {
  if ("fileName" in node) {
    return node.fileName;
  }
  return context.filename;
}
