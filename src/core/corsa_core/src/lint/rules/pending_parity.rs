use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::{
    lint::helpers::{
        child_list, identifier_name, is_any_like_node, is_identifier_named,
        is_obviously_promise_like, is_promise_like_node, member_property_name,
        strip_chain_expression,
    },
    utils::{
        TypeTextKind, classify_type_text, is_any_like_type_texts, is_array_like_type_texts,
        is_promise_like_type_texts, is_unknown_like_type_texts, split_top_level_type_text,
    },
};

const UNEXPECTED: &[RuleMessage] = &[RuleMessage {
    id: "unexpected",
    description: "This TypeScript-aware construct should be simplified or made safer.",
}];

macro_rules! parity_rule {
    ($rule:ident, $name:literal, $description:literal, [$($listener:literal),+], $check:ident) => {
        #[derive(Clone, Copy, Debug, Default)]
        pub struct $rule;

        impl RustLintRule for $rule {
            fn name(&self) -> &'static str {
                $name
            }

            fn docs_description(&self) -> &'static str {
                $description
            }

            fn messages(&self) -> &'static [RuleMessage] {
                UNEXPECTED
            }

            fn listeners(&self) -> &'static [&'static str] {
                &[$($listener),+]
            }

            fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
                $check(ctx, node);
            }
        }
    };
}

parity_rule!(
    ConsistentReturnRule,
    "consistent-return",
    "Require functions to return values consistently.",
    [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression"
    ],
    check_consistent_return
);
parity_rule!(
    ConsistentTypeExportsRule,
    "consistent-type-exports",
    "Require type-only exports where possible.",
    ["ExportNamedDeclaration"],
    check_host_flag
);
parity_rule!(
    DotNotationRule,
    "dot-notation",
    "Prefer dot notation when accessing statically named properties.",
    ["MemberExpression"],
    check_dot_notation
);
parity_rule!(
    NoConfusingVoidExpressionRule,
    "no-confusing-void-expression",
    "Disallow void-typed expressions in confusing value positions.",
    ["CallExpression", "AwaitExpression", "ChainExpression"],
    check_no_confusing_void_expression
);
parity_rule!(
    NoDeprecatedRule,
    "no-deprecated",
    "Disallow use of deprecated declarations.",
    ["Identifier", "MemberExpression"],
    check_host_flag
);
parity_rule!(
    NoDuplicateTypeConstituentsRule,
    "no-duplicate-type-constituents",
    "Disallow duplicate union or intersection constituents.",
    ["TSUnionType", "TSIntersectionType"],
    check_no_duplicate_type_constituents
);
parity_rule!(
    NoMisusedPromisesRule,
    "no-misused-promises",
    "Disallow promises in places not designed to handle them.",
    [
        "IfStatement",
        "WhileStatement",
        "DoWhileStatement",
        "ForStatement",
        "ConditionalExpression",
        "SpreadElement"
    ],
    check_no_misused_promises
);
parity_rule!(
    NoMisusedSpreadRule,
    "no-misused-spread",
    "Disallow spreading values into incompatible positions.",
    ["SpreadElement"],
    check_no_misused_spread
);
parity_rule!(
    NoRedundantTypeConstituentsRule,
    "no-redundant-type-constituents",
    "Disallow union or intersection constituents made redundant by top types.",
    ["TSUnionType", "TSIntersectionType"],
    check_no_redundant_type_constituents
);
parity_rule!(
    NoUnnecessaryBooleanLiteralCompareRule,
    "no-unnecessary-boolean-literal-compare",
    "Disallow unnecessary comparisons against boolean literals.",
    ["BinaryExpression"],
    check_no_unnecessary_boolean_literal_compare
);
parity_rule!(
    NoUnnecessaryConditionRule,
    "no-unnecessary-condition",
    "Disallow conditions that are always truthy or always falsy.",
    [
        "IfStatement",
        "WhileStatement",
        "DoWhileStatement",
        "ForStatement",
        "ConditionalExpression",
        "LogicalExpression"
    ],
    check_no_unnecessary_condition
);
parity_rule!(
    NoUnnecessaryQualifierRule,
    "no-unnecessary-qualifier",
    "Disallow namespace qualifiers that are not needed.",
    ["TSQualifiedName", "MemberExpression"],
    check_host_flag
);
parity_rule!(
    NoUnnecessaryTemplateExpressionRule,
    "no-unnecessary-template-expression",
    "Disallow template literals that wrap a single expression unnecessarily.",
    ["TemplateLiteral"],
    check_no_unnecessary_template_expression
);
parity_rule!(
    NoUnnecessaryTypeArgumentsRule,
    "no-unnecessary-type-arguments",
    "Disallow type arguments that are inferred from call arguments.",
    ["CallExpression", "NewExpression"],
    check_no_unnecessary_type_arguments
);
parity_rule!(
    NoUnnecessaryTypeAssertionRule,
    "no-unnecessary-type-assertion",
    "Disallow type assertions that do not change the expression type.",
    ["TSAsExpression", "TSTypeAssertion"],
    check_no_unnecessary_type_assertion
);
parity_rule!(
    NoUnnecessaryTypeConversionRule,
    "no-unnecessary-type-conversion",
    "Disallow converting values to their own primitive type.",
    ["CallExpression", "NewExpression"],
    check_no_unnecessary_type_conversion
);
parity_rule!(
    NoUnnecessaryTypeParametersRule,
    "no-unnecessary-type-parameters",
    "Disallow type parameters that are only used once.",
    ["TSTypeParameterDeclaration"],
    check_no_unnecessary_type_parameters
);
parity_rule!(
    NoUnsafeArgumentRule,
    "no-unsafe-argument",
    "Disallow passing any-typed values to typed parameters.",
    ["CallExpression", "NewExpression"],
    check_no_unsafe_argument
);
parity_rule!(
    NoUnsafeEnumComparisonRule,
    "no-unsafe-enum-comparison",
    "Disallow comparing values from different enum domains.",
    ["BinaryExpression"],
    check_no_unsafe_enum_comparison
);
parity_rule!(
    NoUselessDefaultAssignmentRule,
    "no-useless-default-assignment",
    "Disallow defaults that only assign undefined.",
    ["AssignmentPattern"],
    check_no_useless_default_assignment
);
parity_rule!(
    NonNullableTypeAssertionStyleRule,
    "non-nullable-type-assertion-style",
    "Prefer non-null assertions over equivalent non-nullable type assertions.",
    ["TSAsExpression", "TSTypeAssertion"],
    check_non_nullable_type_assertion_style
);
parity_rule!(
    PreferNullishCoalescingRule,
    "prefer-nullish-coalescing",
    "Prefer nullish coalescing for nullish fallbacks.",
    ["LogicalExpression", "ConditionalExpression"],
    check_prefer_nullish_coalescing
);
parity_rule!(
    PreferOptionalChainRule,
    "prefer-optional-chain",
    "Prefer optional chaining over repeated short-circuit checks.",
    ["LogicalExpression"],
    check_prefer_optional_chain
);
parity_rule!(
    PreferReadonlyRule,
    "prefer-readonly",
    "Prefer readonly members that are never reassigned.",
    ["PropertyDefinition", "TSPropertySignature"],
    check_prefer_readonly
);
parity_rule!(
    PreferReadonlyParameterTypesRule,
    "prefer-readonly-parameter-types",
    "Prefer readonly array and object parameter types.",
    [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "MethodDefinition"
    ],
    check_prefer_readonly_parameter_types
);
parity_rule!(
    PreferReturnThisTypeRule,
    "prefer-return-this-type",
    "Prefer this as a return type for fluent instance methods.",
    [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression",
        "MethodDefinition"
    ],
    check_prefer_return_this_type
);
parity_rule!(
    PromiseFunctionAsyncRule,
    "promise-function-async",
    "Require functions that return promises to be async.",
    [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression"
    ],
    check_promise_function_async
);
parity_rule!(
    RelatedGetterSetterPairsRule,
    "related-getter-setter-pairs",
    "Require paired getters and setters to use compatible types.",
    ["ClassBody", "ObjectExpression"],
    check_related_getter_setter_pairs
);
parity_rule!(
    RequireAwaitRule,
    "require-await",
    "Disallow async functions that contain no await expression.",
    [
        "FunctionDeclaration",
        "FunctionExpression",
        "ArrowFunctionExpression"
    ],
    check_require_await
);
parity_rule!(
    ReturnAwaitRule,
    "return-await",
    "Require consistent use of return await.",
    ["ReturnStatement"],
    check_return_await
);
parity_rule!(
    StrictBooleanExpressionsRule,
    "strict-boolean-expressions",
    "Disallow non-boolean values in boolean expression positions.",
    [
        "IfStatement",
        "WhileStatement",
        "DoWhileStatement",
        "ForStatement",
        "ConditionalExpression",
        "LogicalExpression",
        "UnaryExpression"
    ],
    check_strict_boolean_expressions
);
parity_rule!(
    StrictVoidReturnRule,
    "strict-void-return",
    "Disallow returning values from void-returning functions.",
    ["ReturnStatement", "ArrowFunctionExpression"],
    check_strict_void_return
);
parity_rule!(
    SwitchExhaustivenessCheckRule,
    "switch-exhaustiveness-check",
    "Require switch statements over unions to cover every case.",
    ["SwitchStatement"],
    check_switch_exhaustiveness
);
parity_rule!(
    UnboundMethodRule,
    "unbound-method",
    "Disallow referencing methods without their receiver.",
    ["MemberExpression"],
    check_unbound_method
);

fn check_consistent_return(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let returns = descendants_with_kind_in_current_function(node, "ReturnStatement");
    if returns.is_empty() {
        return;
    }
    let has_value = returns
        .iter()
        .any(|return_node| return_node.child("argument").is_some());
    let has_bare = returns
        .iter()
        .any(|return_node| return_node.child("argument").is_none());
    if has_value && has_bare {
        ctx.report("unexpected", node.range);
    }
}

fn check_host_flag(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_bool("__nativeRuleViolation").unwrap_or(false)
        || node.field_bool("__deprecated").unwrap_or(false)
        || node.field_bool("__unnecessaryQualifier").unwrap_or(false)
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_dot_notation(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.kind != "MemberExpression" || !node.field_bool("computed").unwrap_or(false) {
        return;
    }
    let Some(property) = node.child("property") else {
        return;
    };
    let Some(name) = literal_value_string(property) else {
        return;
    };
    if is_valid_identifier_name(&name) {
        ctx.report("unexpected", property.range);
    }
}

fn check_no_confusing_void_expression(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if !has_type_kind(&node.type_texts, TypeTextKind::Unknown, Some("void")) {
        return;
    }
    if matches!(
        node.field_str("__parentKind"),
        Some("ExpressionStatement" | "UnaryExpression")
    ) {
        return;
    }
    ctx.report("unexpected", node.range);
}

fn check_no_duplicate_type_constituents(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let mut seen = BTreeSet::new();
    for ty in child_list(node, "types") {
        let key = type_node_key(ty);
        if key.is_empty() {
            continue;
        }
        if !seen.insert(key) {
            ctx.report("unexpected", ty.range);
            return;
        }
    }
}

fn check_no_misused_promises(ctx: &mut RuleContext<'_>, node: &LintNode) {
    match node.kind.as_str() {
        "SpreadElement" => {
            if node.child("argument").is_some_and(is_promise_like_node) {
                ctx.report("unexpected", node.range);
            }
        }
        "ConditionalExpression" => {
            if node.child("test").is_some_and(is_promise_like_node) {
                ctx.report("unexpected", node.range);
            }
        }
        _ => {
            if node.child("test").is_some_and(is_promise_like_node) {
                ctx.report("unexpected", node.range);
            }
        }
    }
}

fn check_no_misused_spread(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(argument) = node.child("argument") else {
        return;
    };
    match node.field_str("__parentKind") {
        Some("ArrayExpression" | "CallExpression" | "NewExpression")
            if !is_array_like_type_texts(&argument.type_texts)
                && !argument
                    .property_names
                    .iter()
                    .any(|property| property == "Symbol.iterator") =>
        {
            ctx.report("unexpected", argument.range);
        }
        Some("ObjectExpression")
            if is_array_like_type_texts(&argument.type_texts)
                || has_type_kind(&argument.type_texts, TypeTextKind::Nullish, None) =>
        {
            ctx.report("unexpected", argument.range);
        }
        _ => {}
    }
}

fn check_no_redundant_type_constituents(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let constituents = child_list(node, "types");
    if constituents.len() < 2 {
        return;
    }
    let keys = constituents.iter().map(type_node_key).collect::<Vec<_>>();
    if node.kind == "TSUnionType" && keys.iter().any(|key| key == "any" || key == "unknown") {
        report_first_redundant(ctx, constituents, &keys, &["any", "unknown"]);
    }
    if node.kind == "TSIntersectionType" && keys.iter().any(|key| key == "never") {
        report_first_redundant(ctx, constituents, &keys, &["never"]);
    }
}

fn check_no_unnecessary_boolean_literal_compare(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if !matches!(
        node.field_str("operator"),
        Some("===" | "!==" | "==" | "!=")
    ) {
        return;
    }
    let Some(left) = node.child("left") else {
        return;
    };
    let Some(right) = node.child("right") else {
        return;
    };
    if (is_booleanish(left) && is_boolean_literal(right))
        || (is_boolean_literal(left) && is_booleanish(right))
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_no_unnecessary_condition(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let test = match node.kind.as_str() {
        "LogicalExpression" => node.child("left"),
        "ConditionalExpression" => node.child("test"),
        _ => node.child("test"),
    };
    if test.is_some_and(is_always_truthy_or_falsy) {
        ctx.report("unexpected", test.unwrap().range);
    }
}

fn check_no_unnecessary_template_expression(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let expressions = child_list(node, "expressions");
    let quasis = child_list(node, "quasis");
    if expressions.len() == 1 && quasis.len() <= 2 && quasis.iter().all(is_empty_template_quasi) {
        ctx.report("unexpected", node.range);
    }
}

fn check_no_unnecessary_type_arguments(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let has_type_arguments = node.child("typeArguments").is_some()
        || node.child("typeParameters").is_some()
        || node.child("typeParameterInstantiation").is_some();
    if has_type_arguments && node.field_bool("__explicitTypeArgumentsRequired") == Some(false) {
        ctx.report("unexpected", node.range);
    }
}

fn check_no_unnecessary_type_assertion(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(expression) = node.child("expression") else {
        return;
    };
    let Some(annotation) = node.field_str("__typeAnnotationText") else {
        return;
    };
    if expression
        .type_texts
        .iter()
        .any(|text| normalize_type_text(text) == normalize_type_text(annotation))
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_no_unnecessary_type_conversion(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(callee) = node.child("callee") else {
        return;
    };
    let Some(name) = identifier_name(callee) else {
        return;
    };
    let Some(argument) = child_list(node, "arguments").first() else {
        return;
    };
    let expected = match name.as_str() {
        "String" => TypeTextKind::String,
        "Number" => TypeTextKind::Number,
        "Boolean" => TypeTextKind::Boolean,
        "BigInt" => TypeTextKind::Bigint,
        _ => return,
    };
    if has_type_kind(&argument.type_texts, expected, None) {
        ctx.report("unexpected", node.range);
    }
}

fn check_no_unnecessary_type_parameters(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_bool("__hasSingleUseTypeParameter") == Some(true) {
        ctx.report("unexpected", node.range);
        return;
    }
    let params = child_list(node, "params");
    if params.len() == 1 && params[0].field_bool("__usedMultipleTimes") == Some(false) {
        ctx.report("unexpected", params[0].range);
    }
}

fn check_no_unsafe_argument(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let arguments = child_list(node, "arguments");
    let expected_types = expected_argument_type_texts(node);
    for (index, argument) in arguments.iter().enumerate() {
        if !is_any_like_node(argument) {
            continue;
        }
        let expected = expected_types.get(index).map(Vec::as_slice).unwrap_or(&[]);
        if expected.is_empty()
            || is_any_like_type_texts(expected)
            || is_unknown_like_type_texts(expected)
        {
            continue;
        }
        ctx.report("unexpected", argument.range);
        return;
    }
}

fn check_no_unsafe_enum_comparison(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if !matches!(
        node.field_str("operator"),
        Some("===" | "!==" | "==" | "!=" | "<" | "<=" | ">" | ">=")
    ) {
        return;
    }
    let Some(left) = node.child("left") else {
        return;
    };
    let Some(right) = node.child("right") else {
        return;
    };
    let Some(left_enum) = enum_domain(left) else {
        return;
    };
    let Some(right_enum) = enum_domain(right) else {
        return;
    };
    if left_enum != right_enum {
        ctx.report("unexpected", node.range);
    }
}

fn check_no_useless_default_assignment(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node
        .child("right")
        .is_some_and(|right| is_identifier_named(right, "undefined"))
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_non_nullable_type_assertion_style(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(expression) = node.child("expression") else {
        return;
    };
    let Some(annotation) = node.field_str("__typeAnnotationText") else {
        return;
    };
    if !annotation.contains("NonNullable")
        && expression
            .type_texts
            .iter()
            .any(|text| text.contains("null") || text.contains("undefined"))
        && !annotation.contains("null")
        && !annotation.contains("undefined")
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_prefer_nullish_coalescing(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.kind == "LogicalExpression"
        && node.field_str("operator") == Some("||")
        && node
            .child("left")
            .is_some_and(|left| has_type_kind(&left.type_texts, TypeTextKind::Nullish, None))
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_prefer_optional_chain(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.kind != "LogicalExpression" || node.field_str("operator") != Some("&&") {
        return;
    }
    let Some(left) = node.child("left") else {
        return;
    };
    let Some(right) = node.child("right") else {
        return;
    };
    let right = strip_chain_expression(right);
    if right.kind != "MemberExpression" {
        return;
    }
    if right
        .child("object")
        .is_some_and(|object| object.range == left.range)
    {
        ctx.report("unexpected", node.range);
    }
}

fn check_prefer_readonly(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_bool("readonly").unwrap_or(false) {
        return;
    }
    if node.field_bool("__writtenOutsideConstructor") == Some(false) {
        ctx.report("unexpected", node.range);
    }
}

fn check_prefer_readonly_parameter_types(ctx: &mut RuleContext<'_>, node: &LintNode) {
    for param in child_list(node, "params") {
        if param
            .type_texts
            .iter()
            .any(|text| is_mutable_array_type_text(text.as_str()))
        {
            ctx.report("unexpected", param.range);
            return;
        }
    }
}

fn check_prefer_return_this_type(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(class_name) = node.field_str("__nearestClassName") else {
        return;
    };
    let return_type_texts = string_array_field(node, "__returnTypeTexts");
    if return_type_texts.iter().any(|text| text == class_name) && returns_only_this(node) {
        ctx.report("unexpected", node.range);
    }
}

fn check_promise_function_async(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if node.field_bool("async").unwrap_or(false) {
        return;
    }
    let return_type_texts = string_array_field(node, "__returnTypeTexts");
    if is_promise_like_type_texts(&return_type_texts, &[] as &[&str]) {
        ctx.report("unexpected", node.range);
    }
}

fn check_related_getter_setter_pairs(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let mut getters = BTreeMap::<String, Vec<String>>::new();
    let mut setters = BTreeMap::<String, Vec<String>>::new();
    for member in child_list(node, "body")
        .iter()
        .chain(child_list(node, "properties"))
    {
        let Some(name) = property_key_name(member) else {
            continue;
        };
        match member.field_str("kind") {
            Some("get") => {
                getters.insert(name, string_array_field(member, "__returnTypeTexts"));
            }
            Some("set") => {
                if let Some(param) = child_list(member, "params").first() {
                    setters.insert(name, param.type_texts.clone());
                }
            }
            _ => {}
        }
    }
    for (name, getter_type) in getters {
        let Some(setter_type) = setters.get(&name) else {
            continue;
        };
        if !getter_type.is_empty() && !setter_type.is_empty() && getter_type != *setter_type {
            ctx.report("unexpected", node.range);
            return;
        }
    }
}

fn check_require_await(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if !node.field_bool("async").unwrap_or(false) {
        return;
    }
    if contains_kind_in_current_function(node, "AwaitExpression")
        || returns_promise_like_in_current_function(node)
    {
        return;
    }
    ctx.report("unexpected", node.range);
}

fn check_return_await(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(argument) = node.child("argument") else {
        return;
    };
    let argument = strip_chain_expression(argument);
    let is_return_await = argument.kind == "AwaitExpression";
    if node
        .field_bool("__returnAwaitRequiresAwait")
        .unwrap_or(false)
    {
        if !is_return_await && is_promise_like_return_argument(argument) {
            ctx.report("unexpected", argument.range);
        }
        return;
    }
    if is_return_await {
        ctx.report("unexpected", node.range);
    }
}

fn check_strict_boolean_expressions(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let target = match node.kind.as_str() {
        "UnaryExpression" if node.field_str("operator") == Some("!") => node.child("argument"),
        "LogicalExpression" => node.child("left"),
        "ConditionalExpression" => node.child("test"),
        _ => node.child("test"),
    };
    let Some(target) = target else {
        return;
    };
    if target.type_texts.is_empty() || is_booleanish(target) {
        return;
    }
    ctx.report("unexpected", target.range);
}

fn check_strict_void_return(ctx: &mut RuleContext<'_>, node: &LintNode) {
    match node.kind.as_str() {
        "ReturnStatement" => {
            let Some(argument) = node.child("argument") else {
                return;
            };
            let return_type_texts = string_array_field(node, "__returnTypeTexts");
            if return_type_texts.iter().any(|text| text == "void")
                && !has_type_kind(&argument.type_texts, TypeTextKind::Unknown, Some("void"))
            {
                ctx.report("unexpected", argument.range);
            }
        }
        "ArrowFunctionExpression" => {
            let Some(body) = node.child("body") else {
                return;
            };
            let return_type_texts = string_array_field(node, "__returnTypeTexts");
            if return_type_texts.iter().any(|text| text == "void")
                && body.kind != "BlockStatement"
                && !has_type_kind(&body.type_texts, TypeTextKind::Unknown, Some("void"))
            {
                ctx.report("unexpected", body.range);
            }
        }
        _ => {}
    }
}

fn check_switch_exhaustiveness(ctx: &mut RuleContext<'_>, node: &LintNode) {
    let Some(discriminant) = node.child("discriminant") else {
        return;
    };
    let expected = union_literal_values(&discriminant.type_texts);
    if expected.len() < 2 {
        return;
    }
    let mut seen = BTreeSet::new();
    let mut has_default = false;
    for case in child_list(node, "cases") {
        if let Some(test) = case.child("test") {
            if let Some(value) = literal_value_string(test) {
                seen.insert(value);
            }
        } else {
            has_default = true;
        }
    }
    if !has_default && expected.iter().any(|value| !seen.contains(value)) {
        ctx.report("unexpected", node.range);
    }
}

fn check_unbound_method(ctx: &mut RuleContext<'_>, node: &LintNode) {
    if matches!(
        node.field_str("__parentKind"),
        Some("CallExpression" | "ChainExpression")
    ) {
        return;
    }
    if node
        .type_texts
        .iter()
        .any(|text| text.contains("=>") || text.starts_with('(') || text.contains("Function"))
    {
        ctx.report("unexpected", node.range);
    }
}

fn report_first_redundant(
    ctx: &mut RuleContext<'_>,
    constituents: &[LintNode],
    keys: &[String],
    dominant: &[&str],
) {
    for (node, key) in constituents.iter().zip(keys) {
        if !dominant.contains(&key.as_str()) {
            ctx.report("unexpected", node.range);
            return;
        }
    }
}

fn descendants_with_kind<'a>(node: &'a LintNode, kind: &str) -> Vec<&'a LintNode> {
    let mut out = Vec::new();
    walk(node, &mut |candidate| {
        if candidate.kind == kind {
            out.push(candidate);
        }
    });
    out
}

fn descendants_with_kind_in_current_function<'a>(
    node: &'a LintNode,
    kind: &str,
) -> Vec<&'a LintNode> {
    let mut out = Vec::new();
    walk_current_function_body(node, &mut |candidate| {
        if candidate.kind == kind {
            out.push(candidate);
        }
    });
    out
}

fn contains_kind_in_current_function(node: &LintNode, kind: &str) -> bool {
    let mut found = false;
    walk_current_function_body(node, &mut |candidate| {
        if candidate.kind == kind {
            found = true;
        }
    });
    found
}

fn walk<'a>(node: &'a LintNode, visit: &mut impl FnMut(&'a LintNode)) {
    visit(node);
    for child in node.children.values() {
        walk(child, visit);
    }
    for list in node.child_lists.values() {
        for child in list {
            walk(child, visit);
        }
    }
}

fn walk_current_function_body<'a>(node: &'a LintNode, visit: &mut impl FnMut(&'a LintNode)) {
    for child in node.children.values() {
        walk_skipping_nested_functions(child, visit);
    }
    for list in node.child_lists.values() {
        for child in list {
            walk_skipping_nested_functions(child, visit);
        }
    }
}

fn walk_skipping_nested_functions<'a>(node: &'a LintNode, visit: &mut impl FnMut(&'a LintNode)) {
    if is_function_like_kind(&node.kind) {
        return;
    }
    visit(node);
    for child in node.children.values() {
        walk_skipping_nested_functions(child, visit);
    }
    for list in node.child_lists.values() {
        for child in list {
            walk_skipping_nested_functions(child, visit);
        }
    }
}

fn is_function_like_kind(kind: &str) -> bool {
    matches!(
        kind,
        "FunctionDeclaration"
            | "FunctionExpression"
            | "ArrowFunctionExpression"
            | "TSDeclareFunction"
            | "TSEmptyBodyFunctionExpression"
    )
}

fn type_node_key(node: &LintNode) -> String {
    if let Some(text) = node.field_str("__typeAnnotationText") {
        return normalize_type_text(text);
    }
    match node.kind.as_str() {
        "TSStringKeyword" => "string".to_owned(),
        "TSNumberKeyword" => "number".to_owned(),
        "TSBooleanKeyword" => "boolean".to_owned(),
        "TSBigIntKeyword" => "bigint".to_owned(),
        "TSAnyKeyword" => "any".to_owned(),
        "TSUnknownKeyword" => "unknown".to_owned(),
        "TSNeverKeyword" => "never".to_owned(),
        "TSVoidKeyword" => "void".to_owned(),
        "TSNullKeyword" => "null".to_owned(),
        "TSUndefinedKeyword" => "undefined".to_owned(),
        "TSLiteralType" => node
            .child("literal")
            .and_then(literal_value_string)
            .unwrap_or_default(),
        "TSTypeReference" => node
            .child("typeName")
            .and_then(qualified_name_text)
            .unwrap_or_default(),
        _ => node
            .text
            .as_deref()
            .map(normalize_type_text)
            .or_else(|| {
                node.type_texts
                    .first()
                    .map(|text| normalize_type_text(text))
            })
            .unwrap_or_default(),
    }
}

fn qualified_name_text(node: &LintNode) -> Option<String> {
    if let Some(name) = identifier_name(node) {
        return Some(name);
    }
    if node.kind == "TSQualifiedName" {
        let left = node.child("left").and_then(qualified_name_text)?;
        let right = node.child("right").and_then(qualified_name_text)?;
        return Some(format!("{left}.{right}"));
    }
    None
}

fn normalize_type_text(text: &str) -> String {
    text.chars().filter(|ch| !ch.is_whitespace()).collect()
}

fn literal_value_string(node: &LintNode) -> Option<String> {
    let current = strip_chain_expression(node);
    let value = current.fields.get("value")?;
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn is_valid_identifier_name(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(chars.next(), Some(first) if first == '_' || first == '$' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn has_type_kind(type_texts: &[String], kind: TypeTextKind, exact: Option<&str>) -> bool {
    type_texts.iter().any(|text| {
        if exact.is_some_and(|expected| text.trim() == expected) {
            return true;
        }
        split_top_level_type_text(text, '|').iter().any(|part| {
            let part = part.trim();
            exact.is_some_and(|expected| part == expected) || classify_type_text(Some(part)) == kind
        })
    })
}

fn is_booleanish(node: &LintNode) -> bool {
    has_type_kind(&node.type_texts, TypeTextKind::Boolean, None) || is_boolean_literal(node)
}

fn is_boolean_literal(node: &LintNode) -> bool {
    strip_chain_expression(node)
        .fields
        .get("value")
        .is_some_and(Value::is_boolean)
}

fn is_always_truthy_or_falsy(node: &LintNode) -> bool {
    if node.kind == "Literal" {
        return true;
    }
    node.type_texts.iter().any(|text| {
        matches!(
            text.trim(),
            "true" | "false" | "null" | "undefined" | "never"
        )
    })
}

fn is_empty_template_quasi(node: &LintNode) -> bool {
    node.fields
        .get("value")
        .and_then(|value| value.get("cooked").or_else(|| value.get("raw")))
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
}

fn expected_argument_type_texts(node: &LintNode) -> Vec<Vec<String>> {
    node.fields
        .get("__expectedArgumentTypeTexts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    item.as_array()
                        .map(|texts| {
                            texts
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn enum_domain(node: &LintNode) -> Option<String> {
    node.type_texts.iter().find_map(|text| {
        let text = text.trim();
        if text.contains('.') {
            return text.split('.').next().map(str::to_owned);
        }
        if text.ends_with("Enum") {
            return Some(text.to_owned());
        }
        None
    })
}

fn is_mutable_array_type_text(text: &str) -> bool {
    let text = text.trim();
    (text.ends_with("[]") && !text.starts_with("readonly "))
        || text.starts_with("Array<")
        || (text.starts_with('[') && text.ends_with(']') && !text.starts_with("readonly "))
}

fn string_array_field(node: &LintNode, key: &str) -> Vec<String> {
    node.fields
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn returns_promise_like_in_current_function(node: &LintNode) -> bool {
    descendants_with_kind_in_current_function(node, "ReturnStatement")
        .iter()
        .filter_map(|return_node| return_node.child("argument"))
        .any(is_promise_like_return_argument)
}

fn is_promise_like_return_argument(node: &LintNode) -> bool {
    is_promise_like_node(node) || is_obviously_promise_like(node)
}

fn returns_only_this(node: &LintNode) -> bool {
    let returns = descendants_with_kind(node, "ReturnStatement");
    !returns.is_empty()
        && returns.iter().all(|return_node| {
            return_node.child("argument").is_some_and(|argument| {
                argument.kind == "ThisExpression" || is_identifier_named(argument, "this")
            })
        })
}

fn property_key_name(node: &LintNode) -> Option<String> {
    node.child("key")
        .and_then(|key| identifier_name(key).or_else(|| literal_value_string(key)))
        .or_else(|| member_property_name(node))
}

fn union_literal_values(type_texts: &[String]) -> BTreeSet<String> {
    let mut values = BTreeSet::new();
    for text in type_texts {
        for part in split_top_level_type_text(text, '|') {
            let part = part.trim();
            if (part.starts_with('\'') && part.ends_with('\''))
                || (part.starts_with('"') && part.ends_with('"'))
            {
                values.insert(part[1..part.len() - 1].to_owned());
            } else if matches!(part, "true" | "false") || part.parse::<f64>().is_ok() {
                values.insert(part.to_owned());
            }
        }
    }
    values
}
