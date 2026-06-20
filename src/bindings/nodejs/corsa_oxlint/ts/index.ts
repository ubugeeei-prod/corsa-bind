import type { ESTree as OxlintESTree } from "@oxlint/plugins";
import type { AST_NODE_TYPES as CorsaAST_NODE_TYPES } from "./compat";

export { AST_NODE_TYPES, AST_TOKEN_TYPES, TSESTree } from "./compat";
export * as ASTUtils from "./ast_utils";
export * as JSONSchema from "./json_schema";
export * as OxlintCompat from "./oxlint_compat";
export * as TSUtils from "./ts_utils";
export * as Utils from "./utils";

export { ESLintUtils, OxlintUtils, RuleCreator } from "./oxlint_utils";
export { compatPlugin, definePlugin, defineRule } from "./plugin";
export type {
  Plugin,
  Rule,
  RuleContext,
  RuleDefinition,
  RuleDocs,
  RuleDiagnostic,
  RuleMetaWithMessages,
} from "./plugin";
export { getParserServices } from "./parser_services";
export { RuleTester } from "./rule_tester";
export { SignatureKind } from "./types";
export type { RuleTesterConfig } from "./rule_tester";
export { TSESLint } from "./ts_eslint";
export * as rules from "./rules/index";
export * as stylistic from "./stylistic";
export { oxlintCompat } from "./oxlint_compat";
type CorsaAstNodeType = keyof typeof CorsaAST_NODE_TYPES;

export type ESTree = ESTree.NodeTypes;
export namespace ESTree {
  type OxlintNode = OxlintESTree.Node;
  type NarrowNode<Candidate, Kind extends string> = Candidate extends {
    readonly type: infer CandidateKind;
  }
    ? Kind extends CandidateKind
      ? Candidate & { readonly type: Kind }
      : never
    : never;
  type RemapTuple<Value extends readonly unknown[]> = Value extends []
    ? []
    : Value extends [infer Head, ...infer Tail]
      ? [RemapNodeField<Head>, ...RemapTuple<Tail>]
      : Value extends readonly [infer Head, ...infer Tail]
        ? readonly [RemapNodeField<Head>, ...RemapTuple<Tail>]
        : never;
  type RemapNodeField<Value> = Value extends OxlintESTree.BindingIdentifier
    ? BindingIdentifier
    : Value extends readonly [unknown, ...unknown[]]
      ? RemapTuple<Value>
    : Value extends OxlintNode
      ? NodeByType<Extract<Value["type"], string>>
      : Value extends readonly (infer Item)[]
        ? readonly RemapNodeField<Item>[]
        : Value extends (infer Item)[]
          ? RemapNodeField<Item>[]
          : Value;
  type RemapNodeShape<Candidate> = Candidate extends object
    ? {
        [Key in keyof Candidate]: RemapNodeField<Candidate[Key]>;
      }
    : Candidate;
  export type NodeByType<Kind extends string> = Kind extends string
    ? RemapNodeShape<NarrowNode<OxlintNode, Kind>>
    : never;
  export type Node =
    | {
        [Kind in CorsaAstNodeType]: NodeByType<Kind>;
      }[CorsaAstNodeType]
    | BindingIdentifier;

  export type AccessorProperty = NodeByType<"AccessorProperty">;
  export type ArrayExpression = NodeByType<"ArrayExpression">;
  export type ArrayPattern = NodeByType<"ArrayPattern">;
  export type ArrowFunctionExpression = NodeByType<"ArrowFunctionExpression">;
  export type AssignmentExpression = NodeByType<"AssignmentExpression">;
  export type AssignmentPattern = NodeByType<"AssignmentPattern">;
  export type AwaitExpression = NodeByType<"AwaitExpression">;
  export type BinaryExpression = NodeByType<"BinaryExpression">;
  export type BlockStatement = NodeByType<"BlockStatement">;
  export type BreakStatement = NodeByType<"BreakStatement">;
  export type CallExpression = NodeByType<"CallExpression">;
  export type CatchClause = NodeByType<"CatchClause">;
  export type ChainExpression = NodeByType<"ChainExpression">;
  export type ClassBody = NodeByType<"ClassBody">;
  export type ClassDeclaration = NodeByType<"ClassDeclaration">;
  export type ClassExpression = NodeByType<"ClassExpression">;
  export type ConditionalExpression = NodeByType<"ConditionalExpression">;
  export type ContinueStatement = NodeByType<"ContinueStatement">;
  export type DebuggerStatement = NodeByType<"DebuggerStatement">;
  export type Decorator = NodeByType<"Decorator">;
  export type DoWhileStatement = NodeByType<"DoWhileStatement">;
  export type EmptyStatement = NodeByType<"EmptyStatement">;
  export type ExportAllDeclaration = NodeByType<"ExportAllDeclaration">;
  export type ExportDefaultDeclaration = NodeByType<"ExportDefaultDeclaration">;
  export type ExportNamedDeclaration = NodeByType<"ExportNamedDeclaration">;
  export type ExportSpecifier = NodeByType<"ExportSpecifier">;
  export type ExpressionStatement = NodeByType<"ExpressionStatement">;
  export type ForInStatement = NodeByType<"ForInStatement">;
  export type ForOfStatement = NodeByType<"ForOfStatement">;
  export type ForStatement = NodeByType<"ForStatement">;
  export type FunctionDeclaration = NodeByType<"FunctionDeclaration">;
  export type FunctionExpression = NodeByType<"FunctionExpression">;
  export type Hashbang = NodeByType<"Hashbang">;
  export type Identifier = NodeByType<"Identifier"> | BindingIdentifier;
  export type IfStatement = NodeByType<"IfStatement">;
  export type ImportAttribute = NodeByType<"ImportAttribute">;
  export type ImportDeclaration = NodeByType<"ImportDeclaration">;
  export type ImportDefaultSpecifier = NodeByType<"ImportDefaultSpecifier">;
  export type ImportExpression = NodeByType<"ImportExpression">;
  export type ImportNamespaceSpecifier = NodeByType<"ImportNamespaceSpecifier">;
  export type ImportSpecifier = NodeByType<"ImportSpecifier">;
  export type JSXAttribute = NodeByType<"JSXAttribute">;
  export type JSXClosingElement = NodeByType<"JSXClosingElement">;
  export type JSXClosingFragment = NodeByType<"JSXClosingFragment">;
  export type JSXElement = NodeByType<"JSXElement">;
  export type JSXEmptyExpression = NodeByType<"JSXEmptyExpression">;
  export type JSXExpressionContainer = NodeByType<"JSXExpressionContainer">;
  export type JSXFragment = NodeByType<"JSXFragment">;
  export type JSXIdentifier = NodeByType<"JSXIdentifier">;
  export type JSXMemberExpression = NodeByType<"JSXMemberExpression">;
  export type JSXNamespacedName = NodeByType<"JSXNamespacedName">;
  export type JSXOpeningElement = NodeByType<"JSXOpeningElement">;
  export type JSXOpeningFragment = NodeByType<"JSXOpeningFragment">;
  export type JSXSpreadAttribute = NodeByType<"JSXSpreadAttribute">;
  export type JSXSpreadChild = NodeByType<"JSXSpreadChild">;
  export type JSXText = NodeByType<"JSXText">;
  export type LabeledStatement = NodeByType<"LabeledStatement">;
  export type Literal = NodeByType<"Literal">;
  export type LogicalExpression = NodeByType<"LogicalExpression">;
  export type MemberExpression = NodeByType<"MemberExpression">;
  export type MetaProperty = NodeByType<"MetaProperty">;
  export type MethodDefinition = NodeByType<"MethodDefinition">;
  export type NewExpression = NodeByType<"NewExpression">;
  export type ObjectExpression = NodeByType<"ObjectExpression">;
  export type ObjectPattern = NodeByType<"ObjectPattern">;
  export type ParenthesizedExpression = NodeByType<"ParenthesizedExpression">;
  export type PrivateIdentifier = NodeByType<"PrivateIdentifier">;
  export type Program = NodeByType<"Program">;
  export type Property = NodeByType<"Property">;
  export type PropertyDefinition = NodeByType<"PropertyDefinition">;
  export type RestElement = NodeByType<"RestElement">;
  export type ReturnStatement = NodeByType<"ReturnStatement">;
  export type SequenceExpression = NodeByType<"SequenceExpression">;
  export type SpreadElement = NodeByType<"SpreadElement">;
  export type StaticBlock = NodeByType<"StaticBlock">;
  export type Super = NodeByType<"Super">;
  export type SwitchCase = NodeByType<"SwitchCase">;
  export type SwitchStatement = NodeByType<"SwitchStatement">;
  export type TaggedTemplateExpression = NodeByType<"TaggedTemplateExpression">;
  export type TemplateElement = NodeByType<"TemplateElement">;
  export type TemplateLiteral = NodeByType<"TemplateLiteral">;
  export type ThisExpression = NodeByType<"ThisExpression">;
  export type ThrowStatement = NodeByType<"ThrowStatement">;
  export type TryStatement = NodeByType<"TryStatement">;
  export type UnaryExpression = NodeByType<"UnaryExpression">;
  export type UpdateExpression = NodeByType<"UpdateExpression">;
  export type V8IntrinsicExpression = NodeByType<"V8IntrinsicExpression">;
  export type VariableDeclaration = NodeByType<"VariableDeclaration">;
  export type VariableDeclarator = NodeByType<"VariableDeclarator">;
  export type WhileStatement = NodeByType<"WhileStatement">;
  export type WithStatement = NodeByType<"WithStatement">;
  export type YieldExpression = NodeByType<"YieldExpression">;
  export type TSAbstractAccessorProperty = NodeByType<"TSAbstractAccessorProperty">;
  export type TSAbstractKeyword = NodeByType<"TSAbstractKeyword">;
  export type TSAbstractMethodDefinition = NodeByType<"TSAbstractMethodDefinition">;
  export type TSAbstractPropertyDefinition = NodeByType<"TSAbstractPropertyDefinition">;
  export type TSAnyKeyword = NodeByType<"TSAnyKeyword">;
  export type TSArrayType = NodeByType<"TSArrayType">;
  export type TSAsExpression = NodeByType<"TSAsExpression">;
  export type TSAsyncKeyword = NodeByType<"TSAsyncKeyword">;
  export type TSBigIntKeyword = NodeByType<"TSBigIntKeyword">;
  export type TSBooleanKeyword = NodeByType<"TSBooleanKeyword">;
  export type TSCallSignatureDeclaration = NodeByType<"TSCallSignatureDeclaration">;
  export type TSClassImplements = NodeByType<"TSClassImplements">;
  export type TSConditionalType = NodeByType<"TSConditionalType">;
  export type TSConstructorType = NodeByType<"TSConstructorType">;
  export type TSConstructSignatureDeclaration = NodeByType<"TSConstructSignatureDeclaration">;
  export type TSDeclareFunction = NodeByType<"TSDeclareFunction">;
  export type TSDeclareKeyword = NodeByType<"TSDeclareKeyword">;
  export type TSEmptyBodyFunctionExpression = NodeByType<"TSEmptyBodyFunctionExpression">;
  export type TSEnumBody = NodeByType<"TSEnumBody">;
  export type TSEnumDeclaration = NodeByType<"TSEnumDeclaration">;
  export type TSEnumMember = NodeByType<"TSEnumMember">;
  export type TSExportAssignment = NodeByType<"TSExportAssignment">;
  export type TSExportKeyword = NodeByType<"TSExportKeyword">;
  export type TSExpressionWithTypeArguments = NodeByType<"TSExpressionWithTypeArguments">;
  export type TSExternalModuleReference = NodeByType<"TSExternalModuleReference">;
  export type TSFunctionType = NodeByType<"TSFunctionType">;
  export type TSImportEqualsDeclaration = NodeByType<"TSImportEqualsDeclaration">;
  export type TSImportType = NodeByType<"TSImportType">;
  export type TSIndexedAccessType = NodeByType<"TSIndexedAccessType">;
  export type TSIndexSignature = NodeByType<"TSIndexSignature">;
  export type TSInferType = NodeByType<"TSInferType">;
  export type TSInstantiationExpression = NodeByType<"TSInstantiationExpression">;
  export type TSInterfaceBody = NodeByType<"TSInterfaceBody">;
  export type TSInterfaceDeclaration = NodeByType<"TSInterfaceDeclaration">;
  export type TSInterfaceHeritage = NodeByType<"TSInterfaceHeritage">;
  export type TSIntersectionType = NodeByType<"TSIntersectionType">;
  export type TSIntrinsicKeyword = NodeByType<"TSIntrinsicKeyword">;
  export type TSLiteralType = NodeByType<"TSLiteralType">;
  export type TSMappedType = NodeByType<"TSMappedType">;
  export type TSMethodSignature = NodeByType<"TSMethodSignature">;
  export type TSModuleBlock = NodeByType<"TSModuleBlock">;
  export type TSModuleDeclaration = NodeByType<"TSModuleDeclaration">;
  export type TSNamedTupleMember = NodeByType<"TSNamedTupleMember">;
  export type TSNamespaceExportDeclaration = NodeByType<"TSNamespaceExportDeclaration">;
  export type TSNeverKeyword = NodeByType<"TSNeverKeyword">;
  export type TSJSDocNonNullableType = NodeByType<"TSJSDocNonNullableType">;
  export type TSJSDocNullableType = NodeByType<"TSJSDocNullableType">;
  export type TSJSDocUnknownType = NodeByType<"TSJSDocUnknownType">;
  export type TSNonNullExpression = NodeByType<"TSNonNullExpression">;
  export type TSNullKeyword = NodeByType<"TSNullKeyword">;
  export type TSNumberKeyword = NodeByType<"TSNumberKeyword">;
  export type TSObjectKeyword = NodeByType<"TSObjectKeyword">;
  export type TSOptionalType = NodeByType<"TSOptionalType">;
  export type TSParameterProperty = NodeByType<"TSParameterProperty">;
  export type TSParenthesizedType = NodeByType<"TSParenthesizedType">;
  export type TSPrivateKeyword = NodeByType<"TSPrivateKeyword">;
  export type TSPropertySignature = NodeByType<"TSPropertySignature">;
  export type TSProtectedKeyword = NodeByType<"TSProtectedKeyword">;
  export type TSPublicKeyword = NodeByType<"TSPublicKeyword">;
  export type TSQualifiedName = NodeByType<"TSQualifiedName">;
  export type TSReadonlyKeyword = NodeByType<"TSReadonlyKeyword">;
  export type TSRestType = NodeByType<"TSRestType">;
  export type TSSatisfiesExpression = NodeByType<"TSSatisfiesExpression">;
  export type TSStaticKeyword = NodeByType<"TSStaticKeyword">;
  export type TSStringKeyword = NodeByType<"TSStringKeyword">;
  export type TSSymbolKeyword = NodeByType<"TSSymbolKeyword">;
  export type TSTemplateLiteralType = NodeByType<"TSTemplateLiteralType">;
  export type TSThisType = NodeByType<"TSThisType">;
  export type TSTupleType = NodeByType<"TSTupleType">;
  export type TSTypeAliasDeclaration = NodeByType<"TSTypeAliasDeclaration">;
  export type TSTypeAnnotation = NodeByType<"TSTypeAnnotation">;
  export type TSTypeAssertion = NodeByType<"TSTypeAssertion">;
  export type TSTypeLiteral = NodeByType<"TSTypeLiteral">;
  export type TSTypeOperator = NodeByType<"TSTypeOperator">;
  export type TSTypeParameter = NodeByType<"TSTypeParameter">;
  export type TSTypeParameterDeclaration = NodeByType<"TSTypeParameterDeclaration">;
  export type TSTypeParameterInstantiation = NodeByType<"TSTypeParameterInstantiation">;
  export type TSTypePredicate = NodeByType<"TSTypePredicate">;
  export type TSTypeQuery = NodeByType<"TSTypeQuery">;
  export type TSTypeReference = NodeByType<"TSTypeReference">;
  export type TSUndefinedKeyword = NodeByType<"TSUndefinedKeyword">;
  export type TSUnionType = NodeByType<"TSUnionType">;
  export type TSUnknownKeyword = NodeByType<"TSUnknownKeyword">;
  export type TSVoidKeyword = NodeByType<"TSVoidKeyword">;

  export type BindingIdentifier = RemapNodeShape<
    Omit<OxlintESTree.BindingIdentifier, "typeAnnotation">
  > & {
    typeAnnotation?: TSTypeAnnotation | null;
  };
  export type BindingPattern = BindingIdentifier | ObjectPattern | ArrayPattern | AssignmentPattern;
  export type Class = ClassDeclaration | ClassExpression;
  export type Function =
    | FunctionDeclaration
    | FunctionExpression
    | TSDeclareFunction
    | TSEmptyBodyFunctionExpression;
  export type Declaration =
    | VariableDeclaration
    | Function
    | Class
    | TSTypeAliasDeclaration
    | TSInterfaceDeclaration
    | TSEnumDeclaration
    | TSModuleDeclaration
    | TSImportEqualsDeclaration;
  export type ModuleDeclaration =
    | ImportDeclaration
    | ExportAllDeclaration
    | ExportDefaultDeclaration
    | ExportNamedDeclaration
    | TSExportAssignment
    | TSNamespaceExportDeclaration;
  export type Statement =
    | BlockStatement
    | BreakStatement
    | ContinueStatement
    | DebuggerStatement
    | DoWhileStatement
    | EmptyStatement
    | ExpressionStatement
    | ForInStatement
    | ForOfStatement
    | ForStatement
    | IfStatement
    | LabeledStatement
    | ReturnStatement
    | SwitchStatement
    | ThrowStatement
    | TryStatement
    | WhileStatement
    | WithStatement
    | Declaration
    | ModuleDeclaration;
  export type Expression =
    | Literal
    | TemplateLiteral
    | Identifier
    | MetaProperty
    | Super
    | ArrayExpression
    | ArrowFunctionExpression
    | AssignmentExpression
    | AwaitExpression
    | BinaryExpression
    | CallExpression
    | ChainExpression
    | Class
    | ConditionalExpression
    | Function
    | ImportExpression
    | LogicalExpression
    | NewExpression
    | ObjectExpression
    | ParenthesizedExpression
    | SequenceExpression
    | TaggedTemplateExpression
    | ThisExpression
    | UnaryExpression
    | UpdateExpression
    | V8IntrinsicExpression
    | YieldExpression
    | JSXElement
    | JSXFragment
    | TSAsExpression
    | TSSatisfiesExpression
    | TSTypeAssertion
    | TSNonNullExpression
    | TSInstantiationExpression
    | MemberExpression;
  export type SimpleAssignmentTarget =
    | Identifier
    | TSAsExpression
    | TSSatisfiesExpression
    | TSNonNullExpression
    | TSTypeAssertion
    | MemberExpression;
  export type AssignmentTarget = SimpleAssignmentTarget | ArrayPattern | ObjectPattern;
  export type ChainElement = CallExpression | TSNonNullExpression | MemberExpression;
  export type FormalParameter = BindingPattern;
  export type FormalParameterRest = RestElement;
  export type ParamPattern = FormalParameter | TSParameterProperty | FormalParameterRest;
  export type ClassElement =
    | StaticBlock
    | MethodDefinition
    | TSAbstractMethodDefinition
    | PropertyDefinition
    | TSAbstractPropertyDefinition
    | AccessorProperty
    | TSAbstractAccessorProperty
    | TSIndexSignature;
  export type NodeTypes = {
    [Kind in CorsaAstNodeType]: NodeByType<Kind>;
  } & {
    BindingIdentifier: BindingIdentifier;
    Identifier: Identifier | BindingIdentifier;
    NewExpression: NewExpression;
    TSTypeAnnotation: TSTypeAnnotation;
  };
}
export type {
  CorsaNode,
  CorsaProgramShape,
  CorsaRuntimeOptions,
  CorsaOxlintSettings,
  CorsaStylisticSettings,
  CorsaSignature,
  CorsaSymbol,
  CorsaType,
  CorsaTypeCheckerShape,
  ContextWithParserOptions,
  ParserServices,
  ParserServicesWithTypeInformation,
  ProjectServiceOptions,
  TypeAwareParserOptions,
} from "./types";
