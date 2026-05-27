export function stripChainExpression<Node>(node: Node): Node {
  let current = node as any;
  while (current?.type === "ChainExpression") {
    current = current.expression;
  }
  return current as Node;
}

export function memberPropertyName(node: unknown): string | undefined {
  const current = stripChainExpression(node as any) as any;
  if (!current || current.type !== "MemberExpression") {
    return undefined;
  }
  if (!current.computed && current.property?.type === "Identifier") {
    return current.property.name;
  }
  if (current.computed && current.property?.type === "Literal") {
    return String(current.property.value);
  }
  return undefined;
}

export function memberObject(node: unknown): unknown {
  const current = stripChainExpression(node as any) as any;
  return current?.type === "MemberExpression" ? current.object : undefined;
}

export function calleePropertyName(node: unknown): string | undefined {
  const current = stripChainExpression(node as any) as any;
  return current?.type === "CallExpression" ? memberPropertyName(current.callee) : undefined;
}

export function isIdentifierNamed(node: unknown, name: string): boolean {
  const current = stripChainExpression(node as any) as any;
  return current?.type === "Identifier" && current.name === name;
}

export function isNegativeOneLiteral(node: unknown): boolean {
  const current = stripChainExpression(node as any) as any;
  if (current?.type === "Literal" && current.value === -1) {
    return true;
  }
  return (
    current?.type === "UnaryExpression" &&
    current.operator === "-" &&
    current.argument?.type === "Literal" &&
    current.argument.value === 1
  );
}

export function isZeroLiteral(node: unknown): boolean {
  const current = stripChainExpression(node as any) as any;
  return current?.type === "Literal" && current.value === 0;
}

export function isLiteralString(node: unknown): boolean {
  const current = stripChainExpression(node as any) as any;
  return current?.type === "Literal" && typeof current.value === "string";
}

export function isRegExpLiteral(node: unknown): boolean {
  const current = stripChainExpression(node as any) as any;
  return current?.type === "Literal" && current.regex !== undefined;
}

export function regexFlags(node: unknown): string | undefined {
  const current = stripChainExpression(node as any) as any;
  return isRegExpLiteral(current) ? current.regex.flags : undefined;
}

export function hasUnknownTypeAnnotation(node: unknown): boolean {
  const current = node as any;
  return (
    current?.typeAnnotation?.typeAnnotation?.type === "TSUnknownKeyword" ||
    current?.typeAnnotation?.type === "TSUnknownKeyword"
  );
}

export function nearestFunctionAncestors(node: any, sourceCode: any): any[] {
  return sourceCode
    .getAncestors(node)
    .toReversed()
    .filter((ancestor: any) => ancestor.type?.includes("Function"));
}
