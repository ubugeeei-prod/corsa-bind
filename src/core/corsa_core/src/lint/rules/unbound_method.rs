use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{member_object, member_property_name, rule_option_bool};

/// Type-aware rule that disallows referencing class/object methods without
/// their bound receiver, which can cause unintentional re-scoping of `this`.
///
/// This is a faithful port of the tsgolint Go rule `unbound-method`. The
/// structural/decision logic (the `isSafeUse` walk, the native-binding
/// allowlist, and the `unbound` vs `unboundWithoutThisAnnotation` distinction)
/// lives here in Rust; the raw symbol-shape facts that require the TypeScript
/// checker are supplied by the host (`__unbound*` fields) and only *consumed*
/// here.
#[derive(Clone, Copy, Debug, Default)]
pub struct UnboundMethodRule;

const BASE_MESSAGE: &str =
    "Avoid referencing unbound methods which may cause unintentional scoping of `this`.";

const MESSAGES: &[RuleMessage] = &[
    RuleMessage {
        id: "unbound",
        description: BASE_MESSAGE,
    },
    RuleMessage {
        id: "unboundWithoutThisAnnotation",
        description: BASE_MESSAGE,
    },
];

// The Go rule registers three listeners: PropertyAccessExpression (the dominant
// case), ObjectLiteralExpression assignment patterns, and ObjectBindingPattern.
// In the TSESTree/ESTree world these correspond to MemberExpression,
// ObjectExpression (assignment targets), and ObjectPattern respectively.
const LISTENERS: &[&str] = &["MemberExpression", "ObjectPattern", "ObjectExpression"];

impl RustLintRule for UnboundMethodRule {
    fn name(&self) -> &'static str {
        "unbound-method"
    }

    fn docs_description(&self) -> &'static str {
        "Disallow referencing methods without their receiver (`this`)."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        let ignore_static = rule_option_bool(node, "ignoreStatic").unwrap_or(false);

        match node.kind.as_str() {
            "MemberExpression" => check_member_expression(ctx, node, ignore_static),
            "ObjectPattern" => check_object_binding_pattern(ctx, node, ignore_static),
            "ObjectExpression" => check_object_literal_assignment(ctx, node, ignore_static),
            _ => {}
        }
    }
}

/// Resolved shape of the property/method symbol that the host computed via the
/// TypeScript checker. Mirrors `checkIfMethod` + `checkMethod` in the Go rule.
#[derive(Clone, Copy, Debug, Default)]
struct MethodShape {
    /// The resolved symbol's value declaration is a method-like declaration
    /// (MethodDeclaration / MethodSignature / PropertyAssignment whose
    /// initializer is a function expression), i.e. it can be "dangerous".
    is_method: bool,
    /// The (method) declaration declares an explicit `this` parameter.
    first_param_is_this: bool,
    /// The explicit `this` parameter is annotated `this: void` (always safe).
    this_arg_is_void: bool,
    /// The declaration carries the `static` modifier.
    is_static: bool,
}

impl MethodShape {
    /// Reads the raw `__unbound*` fact bundle that the host attaches under the
    /// given key prefix. Returns `None` when no symbol shape is available
    /// (e.g. the symbol could not be resolved), matching the Go behavior of
    /// returning `(false, false)` for a missing value declaration.
    fn from_fact(node: &LintNode, key: &str) -> Option<Self> {
        let value = node.fields.get(key)?.as_object()?;
        Some(Self {
            is_method: value
                .get("isMethod")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            first_param_is_this: value
                .get("firstParamIsThis")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            this_arg_is_void: value
                .get("thisArgIsVoid")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            is_static: value
                .get("isStatic")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        })
    }

    /// Computes `(dangerous, firstParamIsThis)` exactly as the Go
    /// `checkIfMethod`/`checkMethod` pair does.
    fn evaluate(self, ignore_static: bool) -> (bool, bool) {
        if !self.is_method {
            return (false, false);
        }
        let dangerous = !self.this_arg_is_void && (!ignore_static || !self.is_static);
        (dangerous, self.first_param_is_this)
    }
}

/// Reports the appropriate diagnostic for a dangerous method reference,
/// returning whether anything was reported. Mirrors `checkIfMethodAndReport`.
fn report_method(
    ctx: &mut RuleContext<'_>,
    report_node: &LintNode,
    shape: Option<MethodShape>,
    ignore_static: bool,
) -> bool {
    let Some(shape) = shape else {
        return false;
    };
    let (dangerous, first_param_is_this) = shape.evaluate(ignore_static);
    if !dangerous {
        return false;
    }
    if first_param_is_this {
        ctx.report("unbound", report_node.range);
    } else {
        ctx.report("unboundWithoutThisAnnotation", report_node.range);
    }
    true
}

fn check_member_expression(ctx: &mut RuleContext<'_>, node: &LintNode, ignore_static: bool) {
    if is_safe_use(node) {
        return;
    }
    if let Some(object) = node.child("object")
        && let Some(members) = MemberFacts::of(object, "__memberMethods")
    {
        let property = node.child("property");
        if is_natively_bound_by_facts(object, property, &members) {
            return;
        }
        let Some(name) = accessed_name(node) else {
            return;
        };
        members.report_any_dangerous(ctx, node, &name, ignore_static);
        return;
    }
    if is_natively_bound(
        member_object(node),
        member_property_name(node).as_deref(),
        node,
    ) {
        return;
    }
    let shape = MethodShape::from_fact(node, "__unboundMethodInfo");
    report_method(ctx, node, shape, ignore_static);
}

fn check_object_binding_pattern(ctx: &mut RuleContext<'_>, node: &LintNode, ignore_static: bool) {
    if let Some(pattern_members) = MemberFacts::of(node, "__memberMethods") {
        check_pattern_with_facts(ctx, node, &pattern_members, ignore_static);
        return;
    }
    // The host omits the fact bundle (or sets `__insideTypeDeclaration`) for
    // patterns inside type declarations; mirror the early-return there.
    if node.field_bool("__insideTypeDeclaration").unwrap_or(false) {
        return;
    }
    for property in node.child_list("properties").unwrap_or(&[]) {
        // Each binding-pattern property carries its own resolved symbol shape
        // for the destructured member, computed by the host.
        if property.field_bool("__isRest").unwrap_or(false) {
            continue;
        }
        if property.field_bool("__isComputed").unwrap_or(false) {
            continue;
        }
        let shape = MethodShape::from_fact(property, "__unboundMethodInfo");
        report_method(ctx, property, shape, ignore_static);
    }
}

fn check_object_literal_assignment(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    ignore_static: bool,
) {
    // Only object literals used as the left-hand side of a destructuring
    // assignment are relevant; the host marks those.
    if !node.field_bool("__isAssignmentTarget").unwrap_or(false) {
        return;
    }
    for property in node.child_list("properties").unwrap_or(&[]) {
        if property.field_bool("__isComputed").unwrap_or(false) {
            continue;
        }
        let shape = MethodShape::from_fact(property, "__unboundMethodInfo");
        report_method(ctx, property, shape, ignore_static);
    }
}

// Global types whose members typescript-eslint treats as natively bound.
const SUPPORTED_GLOBAL_TYPES: &[&str] = &[
    "NumberConstructor",
    "ObjectConstructor",
    "StringConstructor",
    "SymbolConstructor",
    "ArrayConstructor",
    "Array",
    "ProxyConstructor",
    "Console",
    "DateConstructor",
    "Atomics",
    "Math",
    "JSON",
];
// Instance methods the spec binds to their instance.
const SPEC_BOUND_INSTANCE_METHODS: &[(&str, &str)] = &[("Collator", "compare")];

/// The host's checker facts for a receiver: its symbol and, per member name,
/// how each union/intersection constituent declares the property.
struct MemberFacts<'a> {
    raw: &'a serde_json::Value,
}

impl<'a> MemberFacts<'a> {
    fn of(node: &'a LintNode, key: &str) -> Option<Self> {
        node.fields.get(key).map(|raw| Self { raw })
    }

    fn receiver_symbol(&self) -> Option<&str> {
        self.raw
            .get("receiverSymbol")
            .and_then(serde_json::Value::as_str)
    }

    fn receiver_lib(&self) -> bool {
        self.raw
            .get("receiverLib")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    }

    /// `isBuiltinSymbolLike(receiver, names)`: the receiver's own symbol or a
    /// base type is one of `names` (from the default library).
    fn receiver_is_builtin(&self, names: &[&str]) -> bool {
        let own = self.receiver_lib()
            && self
                .receiver_symbol()
                .is_some_and(|symbol| names.contains(&symbol));
        own || ["receiverBases", "receiverClassBases"].iter().any(|key| {
            self.raw
                .get(*key)
                .and_then(serde_json::Value::as_array)
                .is_some_and(|bases| {
                    bases
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .any(|base| names.contains(&base.split('<').next().unwrap_or(base).trim()))
                })
        })
    }

    fn member(&self, name: &str) -> Option<&'a serde_json::Value> {
        self.raw.get("members")?.get(name)
    }

    fn property_lib(&self, name: &str) -> bool {
        self.member(name)
            .and_then(|member| member.get("propertyLib"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    }

    fn parts(&self, name: &str) -> Vec<Option<MethodShape>> {
        self.member(name)
            .and_then(|member| member.get("parts"))
            .and_then(serde_json::Value::as_array)
            .map(|parts| parts.iter().map(MethodShape::from_value).collect())
            .unwrap_or_default()
    }

    /// `checkUnionConstituentsAndReport`.
    fn report_any_dangerous(
        &self,
        ctx: &mut RuleContext<'_>,
        report_node: &LintNode,
        name: &str,
        ignore_static: bool,
    ) -> bool {
        self.parts(name)
            .into_iter()
            .any(|shape| report_method(ctx, report_node, shape, ignore_static))
    }

    /// `checkIfMethodAndReport(node, type.getProperty(name))`: the property of
    /// the whole type, which only has a declaration when the type is not a
    /// union of several constituents.
    fn report_whole_type(
        &self,
        ctx: &mut RuleContext<'_>,
        report_node: &LintNode,
        name: &str,
        ignore_static: bool,
    ) -> bool {
        let parts = self.parts(name);
        match parts.as_slice() {
            [single] => report_method(ctx, report_node, *single, ignore_static),
            _ => false,
        }
    }
}

impl MethodShape {
    fn from_value(value: &serde_json::Value) -> Option<Self> {
        let value = value.as_object()?;
        let flag = |key: &str| {
            value
                .get(key)
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
        };
        Some(Self {
            is_method: flag("isMethod"),
            first_param_is_this: flag("firstParamIsThis"),
            this_arg_is_void: flag("thisArgIsVoid"),
            is_static: flag("isStatic"),
        })
    }
}

/// typescript-eslint's `getAccessedPropertyNames` for statically known names.
fn accessed_name(node: &LintNode) -> Option<String> {
    let property = node.child("property")?;
    if node.field_bool("computed").unwrap_or(false) {
        return property.field_stringish("value");
    }
    (property.kind == "Identifier")
        .then(|| property.field_stringish("name"))
        .flatten()
}

/// `isNativelyBound(object, property)` over checker facts.
fn is_natively_bound_by_facts(
    object: &LintNode,
    property: Option<&LintNode>,
    members: &MemberFacts<'_>,
) -> bool {
    let property_name = property
        .filter(|property| property.kind == "Identifier")
        .and_then(|property| property.field_stringish("name"));
    let object_name = (object.kind == "Identifier")
        .then(|| object.field_stringish("name"))
        .flatten();
    natively_bound(
        object_name.as_deref(),
        object.field_bool("__declaredInFile"),
        property_name.as_deref(),
        members,
    )
}

fn natively_bound(
    object_name: Option<&str>,
    object_declared_in_file: Option<bool>,
    property_name: Option<&str>,
    members: &MemberFacts<'_>,
) -> bool {
    let Some(property_name) = property_name else {
        return false;
    };
    // `Math.floor`: a global (not file-local) object's natively bound member.
    if let Some(object_name) = object_name
        && object_declared_in_file == Some(false)
        && is_natively_bound_member(object_name, property_name)
    {
        return true;
    }
    let receiver = members.receiver_symbol();
    if members.receiver_lib()
        && receiver.is_some_and(|receiver| {
            SPEC_BOUND_INSTANCE_METHODS.contains(&(receiver, property_name))
        })
    {
        return true;
    }
    members.receiver_is_builtin(SUPPORTED_GLOBAL_TYPES) && members.property_lib(property_name)
}

/// typescript-eslint's `ObjectPattern` listener over checker facts.
fn check_pattern_with_facts(
    ctx: &mut RuleContext<'_>,
    node: &LintNode,
    pattern_members: &MemberFacts<'_>,
    ignore_static: bool,
) {
    if is_inside_type_declaration(node) {
        return;
    }
    let init_members = MemberFacts::of(node, "__initMemberMethods");
    let parent_is_assignment_pattern = node.field_str("__parentKind") == Some("AssignmentPattern");
    for property in node.child_list("properties").unwrap_or(&[]) {
        if property.kind != "Property" || property.field_bool("computed") == Some(true) {
            continue;
        }
        let Some(key) = property.child("key").filter(|key| key.kind == "Identifier") else {
            continue;
        };
        let Some(name) = key.field_stringish("name") else {
            continue;
        };
        if let Some(init_members) = &init_members {
            let bound = natively_bound(
                node.field_str("__initName"),
                node.field_bool("__initDeclaredInFile"),
                Some(&name),
                init_members,
            );
            if !bound {
                if init_members.report_whole_type(ctx, key, &name, ignore_static) {
                    continue;
                }
            } else if !parent_is_assignment_pattern {
                continue;
            }
        }
        pattern_members.report_any_dangerous(ctx, key, &name, ignore_static);
    }
}

/// `isNodeInsideTypeDeclaration`, over the host's ancestor facts.
fn is_inside_type_declaration(node: &LintNode) -> bool {
    if node.field_bool("__insideTypeDeclaration").unwrap_or(false) {
        return true;
    }
    node.fields
        .get("__ancestorFacts")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|ancestors| {
            ancestors.iter().any(|ancestor| {
                let kind = ancestor
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                let declare = ancestor
                    .get("declare")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                matches!(
                    kind,
                    "TSAbstractMethodDefinition"
                        | "TSDeclareFunction"
                        | "TSFunctionType"
                        | "TSInterfaceDeclaration"
                        | "TSTypeAliasDeclaration"
                ) || (declare && matches!(kind, "ClassDeclaration" | "VariableDeclaration"))
            })
        })
}

/// Returns `true` when the `${object}.${property}` access is a known
/// natively-bound global member. Mirrors `isNativelyBound`.
///
/// The structural allowlist match (object/property both identifiers, object
/// declared outside the current file) is performed in Rust over the host's
/// `__objectNotImported` fact. The type-level fallback (`IsBuiltinSymbolLike`)
/// is delegated to the host's `__nativelyBoundType` fact.
fn is_natively_bound(
    object: Option<&LintNode>,
    property_name: Option<&str>,
    member: &LintNode,
) -> bool {
    if let (Some(object), Some(property_name)) = (object, property_name) {
        if object.kind == "Identifier" {
            if let Some(object_name) = object.field_stringish("name") {
                // The host tells us whether the object symbol resolves to a
                // declaration outside the current source file.
                let not_imported = member.field_bool("__objectNotImported").unwrap_or(false);
                if not_imported && is_natively_bound_member(&object_name, property_name) {
                    return true;
                }
            }
        }
    }
    // Type-level fallback: the host computed IsBuiltinSymbolLike(object) over
    // the supported global types AND IsAnyBuiltinSymbolLike(property).
    member.field_bool("__nativelyBoundType").unwrap_or(false)
}

/// Walks parents to decide whether the member reference is in a position that
/// does not actually unbind `this`. Faithful port of Go `isSafeUse`.
///
/// The host serializes the parent chain as `__safeUse`, computed by replaying
/// the same parent walk against the real AST (where operator kinds and the
/// `expr.Left == node` / `parent.Expression() == node` identity comparisons are
/// available). The Rust side consumes that single raw boolean.
fn is_safe_use(node: &LintNode) -> bool {
    let Some(chain) = node
        .fields
        .get("__ancestorChain")
        .and_then(serde_json::Value::as_array)
    else {
        return node.field_bool("__safeUse").unwrap_or(false);
    };
    let object_is_super = node
        .child("object")
        .is_some_and(|object| object.kind == "Super");
    is_safe_use_at(chain, 0, object_is_super)
}

/// typescript-eslint's `isSafeUse`, walking the host's ancestor chain
/// (innermost first; each entry records which slot the child sits in).
fn is_safe_use_at(chain: &[serde_json::Value], index: usize, object_is_super: bool) -> bool {
    let Some(parent) = chain.get(index) else {
        return false;
    };
    let text = |key: &str| parent.get(key).and_then(serde_json::Value::as_str);
    let child_key = text("childKey");
    let operator = text("operator");
    match text("kind").unwrap_or_default() {
        "IfStatement" | "ForStatement" | "MemberExpression" | "SwitchStatement"
        | "UpdateExpression" | "WhileStatement" => true,
        "CallExpression" => child_key == Some("callee"),
        "ConditionalExpression" => child_key == Some("test"),
        "TaggedTemplateExpression" => child_key == Some("tag"),
        "UnaryExpression" => matches!(operator, Some("!" | "delete" | "typeof" | "void")),
        "BinaryExpression" => matches!(operator, Some("!=" | "!==" | "==" | "===" | "instanceof")),
        "AssignmentExpression" => {
            operator == Some("=")
                && (child_key == Some("left")
                    || (index == 0
                        && object_is_super
                        && parent
                            .get("leftIsThisMember")
                            .and_then(serde_json::Value::as_bool)
                            .unwrap_or(false)))
        }
        "ChainExpression"
        | "TSNonNullExpression"
        | "TSAsExpression"
        | "TSTypeAssertion"
        | "ParenthesizedExpression" => is_safe_use_at(chain, index + 1, false),
        "LogicalExpression" => {
            (operator == Some("&&") && child_key == Some("left"))
                || is_safe_use_at(chain, index + 1, false)
        }
        _ => false,
    }
}

/// The generated natively-bound members allowlist, ported verbatim from
/// `natively_bound_members.go`. RegExp is intentionally present with no members.
fn is_natively_bound_member(object: &str, property: &str) -> bool {
    let members: &[&str] = match object {
        "Number" => &[
            "isFinite",
            "isInteger",
            "isNaN",
            "isSafeInteger",
            "parseFloat",
            "parseInt",
        ],
        "Object" => &[
            "assign",
            "getOwnPropertyDescriptor",
            "getOwnPropertyDescriptors",
            "getOwnPropertyNames",
            "getOwnPropertySymbols",
            "hasOwn",
            "is",
            "preventExtensions",
            "seal",
            "create",
            "defineProperties",
            "defineProperty",
            "freeze",
            "getPrototypeOf",
            "setPrototypeOf",
            "isExtensible",
            "isFrozen",
            "isSealed",
            "keys",
            "entries",
            "fromEntries",
            "values",
            "groupBy",
        ],
        "String" => &["fromCharCode", "fromCodePoint", "raw"],
        "RegExp" => &[],
        "Symbol" => &["for", "keyFor"],
        "Array" => &["isArray", "from", "of", "fromAsync"],
        "Proxy" => &["revocable"],
        "Date" => &["now", "parse", "UTC"],
        "Atomics" => &[
            "load",
            "store",
            "add",
            "sub",
            "and",
            "or",
            "xor",
            "exchange",
            "compareExchange",
            "isLockFree",
            "wait",
            "waitAsync",
            "notify",
        ],
        "Reflect" => &[
            "defineProperty",
            "deleteProperty",
            "apply",
            "construct",
            "get",
            "getOwnPropertyDescriptor",
            "getPrototypeOf",
            "has",
            "isExtensible",
            "ownKeys",
            "preventExtensions",
            "set",
            "setPrototypeOf",
        ],
        "console" => &[
            "log",
            "info",
            "debug",
            "warn",
            "error",
            "dir",
            "time",
            "timeEnd",
            "timeLog",
            "trace",
            "assert",
            "clear",
            "count",
            "countReset",
            "group",
            "groupEnd",
            "table",
            "dirxml",
            "groupCollapsed",
            "Console",
            "profile",
            "profileEnd",
            "timeStamp",
            "context",
            "createTask",
        ],
        "Math" => &[
            "abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "atan2", "ceil", "cbrt",
            "expm1", "clz32", "cos", "cosh", "exp", "floor", "fround", "hypot", "imul", "log",
            "log1p", "log2", "log10", "max", "min", "pow", "random", "round", "sign", "sin",
            "sinh", "sqrt", "tan", "tanh", "trunc",
        ],
        "JSON" => &["parse", "stringify", "rawJSON", "isRawJSON"],
        "Intl" => &[
            "getCanonicalLocales",
            "supportedValuesOf",
            "DateTimeFormat",
            "NumberFormat",
            "Collator",
            "PluralRules",
            "RelativeTimeFormat",
            "ListFormat",
            "Locale",
            "DisplayNames",
            "Segmenter",
        ],
        _ => return false,
    };
    members.contains(&property)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintNode, RuleContext, RustLintRule};
    use super::UnboundMethodRule;

    fn run(node: &LintNode) -> Vec<(String, super::super::super::TextRange)> {
        let rule = UnboundMethodRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, node);
        ctx.finish()
            .into_iter()
            .map(|d| (d.message_id, d.range))
            .collect()
    }

    fn member(object_name: &str, property_name: &str) -> serde_json::Value {
        json!({
            "kind": "MemberExpression",
            "range": { "start": 0, "end": 16 },
            "fields": { "computed": false },
            "children": {
                "object": {
                    "kind": "Identifier",
                    "range": { "start": 0, "end": 8 },
                    "fields": { "name": object_name }
                },
                "property": {
                    "kind": "Identifier",
                    "range": { "start": 9, "end": 16 },
                    "fields": { "name": property_name }
                }
            }
        })
    }

    // `const unbound = instance.unbound;` — a method without a `this`
    // annotation referenced in an unsafe (assignment value) position reports
    // `unboundWithoutThisAnnotation`.
    #[test]
    fn reports_unbound_without_this_annotation() {
        let mut value = member("instance", "unbound");
        value["fields"]["__safeUse"] = json!(false);
        value["fields"]["__unboundMethodInfo"] = json!({
            "isMethod": true,
            "firstParamIsThis": false,
            "thisArgIsVoid": false,
            "isStatic": false
        });
        let node: LintNode = serde_json::from_value(value).unwrap();
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].0, "unboundWithoutThisAnnotation");
    }

    // A method that declares an explicit (non-void) `this` parameter reports the
    // `unbound` message id.
    #[test]
    fn reports_unbound_with_this_param() {
        let mut value = member("instance", "unbound");
        value["fields"]["__safeUse"] = json!(false);
        value["fields"]["__unboundMethodInfo"] = json!({
            "isMethod": true,
            "firstParamIsThis": true,
            "thisArgIsVoid": false,
            "isStatic": false
        });
        let node: LintNode = serde_json::from_value(value).unwrap();
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].0, "unbound");
    }

    // `instance.bound()` — a safe call-position use must not report.
    #[test]
    fn does_not_report_safe_use() {
        let mut value = member("instance", "unbound");
        value["fields"]["__safeUse"] = json!(true);
        value["fields"]["__unboundMethodInfo"] = json!({
            "isMethod": true,
            "firstParamIsThis": false,
            "thisArgIsVoid": false,
            "isStatic": false
        });
        let node: LintNode = serde_json::from_value(value).unwrap();
        assert!(run(&node).is_empty());
    }

    // `[5.2].map(Math.floor)` — a natively-bound global member (object declared
    // outside the file) must not report even in an unsafe position.
    #[test]
    fn does_not_report_natively_bound_member() {
        let mut value = member("Math", "floor");
        value["fields"]["__safeUse"] = json!(false);
        value["fields"]["__objectNotImported"] = json!(true);
        value["fields"]["__unboundMethodInfo"] = json!({
            "isMethod": true,
            "firstParamIsThis": false,
            "thisArgIsVoid": false,
            "isStatic": false
        });
        let node: LintNode = serde_json::from_value(value).unwrap();
        assert!(run(&node).is_empty());
    }

    // A method annotated `this: void` is never dangerous.
    #[test]
    fn does_not_report_this_void() {
        let mut value = member("o", "f");
        value["fields"]["__safeUse"] = json!(false);
        value["fields"]["__unboundMethodInfo"] = json!({
            "isMethod": true,
            "firstParamIsThis": true,
            "thisArgIsVoid": true,
            "isStatic": false
        });
        let node: LintNode = serde_json::from_value(value).unwrap();
        assert!(run(&node).is_empty());
    }

    // With `ignoreStatic: true`, a static method (no `this` annotation) is not
    // reported.
    #[test]
    fn ignore_static_option_skips_static() {
        let mut value = member("ContainsMethods", "unboundStatic");
        value["fields"]["__safeUse"] = json!(false);
        value["fields"]["__ruleOptions"] = json!([{ "ignoreStatic": true }]);
        value["fields"]["__unboundMethodInfo"] = json!({
            "isMethod": true,
            "firstParamIsThis": false,
            "thisArgIsVoid": false,
            "isStatic": true
        });
        let node: LintNode = serde_json::from_value(value).unwrap();
        assert!(run(&node).is_empty());
    }

    fn method_facts(info: serde_json::Value) -> serde_json::Value {
        json!({
            "receiverSymbol": "Foo",
            "receiverLib": false,
            "members": { "unbound": { "parts": [info], "propertyLib": false } }
        })
    }

    fn checked_member(chain: serde_json::Value, info: serde_json::Value) -> LintNode {
        let mut value = member("instance", "unbound");
        value["fields"]["__ancestorChain"] = chain;
        value["children"]["object"]["fields"]["__memberMethods"] = method_facts(info);
        value["children"]["object"]["fields"]["__declaredInFile"] = json!(true);
        serde_json::from_value(value).unwrap()
    }

    fn method() -> serde_json::Value {
        json!({ "isMethod": true, "firstParamIsThis": false, "thisArgIsVoid": false })
    }

    #[test]
    fn checker_facts_report_unsafe_references() {
        let assigned = checked_member(
            json!([{ "kind": "VariableDeclarator", "childKey": "init" }]),
            method(),
        );
        assert_eq!(run(&assigned)[0].0, "unboundWithoutThisAnnotation");

        let arrow_property = checked_member(
            json!([{ "kind": "VariableDeclarator", "childKey": "init" }]),
            json!({ "isMethod": false }),
        );
        assert!(run(&arrow_property).is_empty());
    }

    #[test]
    fn ancestor_chain_decides_safe_uses() {
        for chain in [
            json!([{ "kind": "CallExpression", "childKey": "callee" }]),
            json!([{ "kind": "IfStatement", "childKey": "test" }]),
            json!([{ "kind": "UnaryExpression", "operator": "typeof", "childKey": "argument" }]),
            json!([{ "kind": "BinaryExpression", "operator": "!==", "childKey": "left" }]),
            json!([{ "kind": "AssignmentExpression", "operator": "=", "childKey": "left" }]),
            json!([
                { "kind": "LogicalExpression", "operator": "||", "childKey": "left" },
                { "kind": "IfStatement", "childKey": "test" }
            ]),
            json!([
                { "kind": "ChainExpression", "childKey": "expression" },
                { "kind": "ConditionalExpression", "childKey": "test" }
            ]),
        ] {
            assert!(run(&checked_member(chain, method())).is_empty());
        }
        for chain in [
            json!([{ "kind": "CallExpression", "childKey": "arguments" }]),
            json!([{ "kind": "AssignmentExpression", "operator": "=", "childKey": "right" }]),
            json!([{ "kind": "ConditionalExpression", "childKey": "consequent" }]),
        ] {
            assert_eq!(run(&checked_member(chain, method())).len(), 1);
        }
    }

    #[test]
    fn checker_facts_recognize_natively_bound_members() {
        let mut value = member("Math", "floor");
        value["fields"]["__ancestorChain"] =
            json!([{ "kind": "CallExpression", "childKey": "arguments" }]);
        value["children"]["object"]["fields"]["__declaredInFile"] = json!(false);
        value["children"]["object"]["fields"]["__memberMethods"] = json!({
            "receiverSymbol": "Math",
            "receiverLib": true,
            "members": { "floor": { "parts": [method()], "propertyLib": true } }
        });
        let node: LintNode = serde_json::from_value(value.clone()).unwrap();
        assert!(run(&node).is_empty());

        // A file-local `Math` with a user method is not the global.
        value["children"]["object"]["fields"]["__declaredInFile"] = json!(true);
        value["children"]["object"]["fields"]["__memberMethods"]["receiverLib"] = json!(false);
        let node: LintNode = serde_json::from_value(value).unwrap();
        assert_eq!(run(&node).len(), 1);
    }

    #[test]
    fn destructuring_reports_the_key() {
        let node: LintNode = serde_json::from_value(json!({
            "kind": "ObjectPattern",
            "range": { "start": 6, "end": 17 },
            "fields": {
                "__parentKind": "VariableDeclarator",
                "__memberMethods": method_facts(method()),
                "__initMemberMethods": method_facts(method()),
                "__ancestorFacts": [{ "kind": "VariableDeclaration" }]
            },
            "childLists": { "properties": [{
                "kind": "Property",
                "range": { "start": 8, "end": 15 },
                "fields": { "computed": false },
                "children": { "key": {
                    "kind": "Identifier",
                    "range": { "start": 8, "end": 15 },
                    "fields": { "name": "unbound" }
                } }
            }] }
        }))
        .unwrap();
        let diagnostics = run(&node);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].1, super::super::super::TextRange::new(8, 15));
    }
}
