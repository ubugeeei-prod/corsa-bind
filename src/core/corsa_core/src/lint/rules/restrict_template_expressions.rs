use super::super::{LintNode, RuleContext, RuleMessage, RustLintRule};
use crate::lint::helpers::{
    child_list, rule_allow_list_names, rule_option_bool, type_texts_match_names,
};
use crate::lint::type_tree::{TypeTree, flags};
use crate::utils::{
    TypeTextKind, classify_type_text, is_array_like_type_texts, split_top_level_type_text,
};

/// Type-aware rule that restricts template literal expression types.
#[derive(Clone, Copy, Debug, Default)]
pub struct RestrictTemplateExpressionsRule;

const MESSAGES: &[RuleMessage] = &[RuleMessage {
    id: "invalidType",
    description: "Invalid type used in template literal expression.",
}];
const LISTENERS: &[&str] = &["TemplateLiteral"];

impl RustLintRule for RestrictTemplateExpressionsRule {
    fn name(&self) -> &'static str {
        "restrict-template-expressions"
    }

    fn docs_description(&self) -> &'static str {
        "Require template literal expressions to be string-compatible."
    }

    fn messages(&self) -> &'static [RuleMessage] {
        MESSAGES
    }

    fn listeners(&self) -> &'static [&'static str] {
        LISTENERS
    }

    fn check(&self, ctx: &mut RuleContext<'_>, node: &LintNode) {
        if node.kind != "TemplateLiteral" || is_tagged_template(node) {
            return;
        }

        let options = RestrictTemplateExpressionsOptions::from_node(node);
        for expression in child_list(node, "expressions") {
            if !is_allowed_expression(expression, &options) {
                ctx.report("invalidType", expression.range);
            }
        }
    }
}

fn is_tagged_template(node: &LintNode) -> bool {
    node.field_str("__parentKind") == Some("TaggedTemplateExpression")
}

#[derive(Clone, Debug)]
struct RestrictTemplateExpressionsOptions {
    allow: Vec<String>,
    /// Whether `allow` came from the user (any source) rather than the
    /// default `{ from: 'lib' }` list.
    allow_from_any_source: bool,
    allow_any: bool,
    allow_array: bool,
    allow_boolean: bool,
    allow_never: bool,
    allow_nullish: bool,
    allow_number: bool,
    allow_regexp: bool,
}

impl RestrictTemplateExpressionsOptions {
    fn from_node(node: &LintNode) -> Self {
        let allow_configured = node
            .fields
            .get("__ruleOptions")
            .and_then(serde_json::Value::as_array)
            .and_then(|options| options.first())
            .and_then(|options| options.get("allow"))
            .is_some();
        Self {
            allow_from_any_source: allow_configured,
            allow: {
                let configured = rule_allow_list_names(node, "allow");
                if node
                    .fields
                    .get("__ruleOptions")
                    .and_then(serde_json::Value::as_array)
                    .and_then(|options| options.first())
                    .and_then(|options| options.get("allow"))
                    .is_some()
                {
                    configured
                } else {
                    // Upstream default allow list.
                    ["Error", "URL", "URLSearchParams"]
                        .map(String::from)
                        .to_vec()
                }
            },
            allow_any: rule_option_bool(node, "allowAny").unwrap_or(true),
            allow_array: rule_option_bool(node, "allowArray").unwrap_or(false),
            allow_boolean: rule_option_bool(node, "allowBoolean").unwrap_or(true),
            allow_never: rule_option_bool(node, "allowNever").unwrap_or(false),
            allow_nullish: rule_option_bool(node, "allowNullish").unwrap_or(true),
            allow_number: rule_option_bool(node, "allowNumber").unwrap_or(true),
            allow_regexp: rule_option_bool(node, "allowRegExp").unwrap_or(true),
        }
    }
}

fn is_allowed_expression(
    expression: &LintNode,
    options: &RestrictTemplateExpressionsOptions,
) -> bool {
    if let Some(shape) = TypeTree::of(expression) {
        return is_allowed_shape(&shape.constrained(), options);
    }
    if type_texts_match_names(&expression.type_texts, &options.allow) {
        return true;
    }
    if matches!(
        expression.kind.as_str(),
        "ObjectExpression" | "FunctionExpression" | "ArrowFunctionExpression"
    ) {
        return false;
    }
    if expression.kind == "ArrayExpression" {
        return options.allow_array;
    }

    !expression.type_texts.is_empty()
        && expression
            .type_texts
            .iter()
            .all(|text| is_allowed_type_text(text, options))
}

/// typescript-eslint's `recursivelyCheckType` over a checker type shape.
fn is_allowed_shape(shape: &TypeTree, options: &RestrictTemplateExpressionsOptions) -> bool {
    if !shape.parts_known() {
        // Constituents unknown: stay silent rather than guess.
        return true;
    }
    if shape.is_union() {
        return shape
            .types
            .iter()
            .all(|part| is_allowed_shape(part, options));
    }
    if shape.is_intersection() {
        return shape
            .types
            .iter()
            .any(|part| is_allowed_shape(part, options));
    }
    if shape.has(flags::STRING_LIKE) || matches_allowed_name(shape, options) {
        return true;
    }
    (options.allow_any && shape.has(flags::ANY))
        || (options.allow_array && is_allowed_array(shape, options))
        || (options.allow_boolean && shape.has(flags::BOOLEAN_LIKE))
        || (options.allow_nullish && shape.has(flags::NULL | flags::UNDEFINED))
        || (options.allow_number && shape.has(flags::NUMBER_LIKE | flags::BIGINT_LIKE))
        || (options.allow_regexp && shape.text == "RegExp")
        || (options.allow_never && shape.has(flags::NEVER))
}

fn is_allowed_array(shape: &TypeTree, options: &RestrictTemplateExpressionsOptions) -> bool {
    if let Some(element) = &shape.array_element {
        return is_allowed_shape(&element.constrained(), options);
    }
    if let Some(elements) = &shape.tuple_elements {
        return elements
            .iter()
            .all(|element| is_allowed_shape(&element.constrained(), options));
    }
    false
}

/// `matchesTypeOrBaseType(typeMatchesSomeSpecifier(allow))`: the type's
/// symbol (from the default library, for the default list) or one of its base
/// types is allow-listed.
fn matches_allowed_name(shape: &TypeTree, options: &RestrictTemplateExpressionsOptions) -> bool {
    let symbol_matches = shape.symbol.as_deref().is_some_and(|symbol| {
        options.allow.iter().any(|allowed| allowed == symbol)
            && (options.allow_from_any_source || shape.lib != Some(false))
    });
    symbol_matches
        || shape.bases.iter().any(|base| {
            let name = base.split('<').next().unwrap_or(base);
            options.allow.iter().any(|allowed| allowed == name)
        })
}

fn is_allowed_type_text(text: &str, options: &RestrictTemplateExpressionsOptions) -> bool {
    split_top_level_type_text(text, '|')
        .iter()
        .all(|part| is_allowed_intersection_type_text(part, options))
}

fn is_allowed_intersection_type_text(
    text: &str,
    options: &RestrictTemplateExpressionsOptions,
) -> bool {
    split_top_level_type_text(text, '&')
        .iter()
        .any(|part| is_allowed_atom_type_text(part, options))
}

fn is_allowed_atom_type_text(text: &str, options: &RestrictTemplateExpressionsOptions) -> bool {
    let text = text.trim();
    if text.is_empty() {
        return false;
    }
    if options.allow_array && is_array_like_type_texts(&[text]) {
        return true;
    }

    match classify_type_text(Some(text)) {
        TypeTextKind::String => true,
        TypeTextKind::Any => options.allow_any,
        TypeTextKind::Boolean => options.allow_boolean,
        TypeTextKind::Bigint | TypeTextKind::Number => options.allow_number,
        TypeTextKind::Nullish => options.allow_nullish,
        TypeTextKind::Regexp => options.allow_regexp,
        TypeTextKind::Unknown if text == "never" => options.allow_never,
        // Named types are only permitted through the `allow` option (whose
        // default carries the upstream Error/URL/URLSearchParams list) plus
        // the Error-suffix convention shared with the Error-likeness helpers.
        TypeTextKind::Other => {
            let name = &text[..text.find('<').unwrap_or(text.len())];
            options.allow.iter().any(|allowed| allowed == name)
                || (options.allow.iter().any(|allowed| allowed == "Error")
                    && text.ends_with("Error"))
        }
        TypeTextKind::Unknown => false,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::super::super::{LintNode, RuleContext, RustLintRule};
    use super::RestrictTemplateExpressionsRule;
    use crate::lint::type_tree::flags;

    fn run(shape: serde_json::Value, options: Option<serde_json::Value>) -> usize {
        let mut fields = serde_json::Map::new();
        if let Some(options) = options {
            fields.insert("__ruleOptions".to_owned(), json!([options]));
        }
        let node: LintNode = serde_json::from_value(json!({
            "kind": "TemplateLiteral",
            "range": { "start": 0, "end": 10 },
            "fields": fields,
            "childLists": { "expressions": [{
                "kind": "Identifier",
                "range": { "start": 3, "end": 6 },
                "fields": { "__typeTree": shape }
            }] }
        }))
        .unwrap();
        let rule = RestrictTemplateExpressionsRule;
        let mut ctx = RuleContext::new(&rule);
        rule.check(&mut ctx, &node);
        ctx.finish().len()
    }

    #[test]
    fn uses_the_constraint_of_type_parameters() {
        let generic = |constraint: serde_json::Value| json!({ "id": "T", "flags": flags::TYPE_PARAMETER, "text": "T", "constraint": constraint });
        assert_eq!(
            run(
                generic(json!({ "id": "s", "flags": flags::STRING, "text": "string" })),
                None
            ),
            0
        );
        assert_eq!(
            run(
                generic(json!({ "id": "b", "flags": flags::BOOLEAN, "text": "boolean" })),
                None
            ),
            0
        );
        assert_eq!(
            run(
                generic(json!({ "id": "o", "flags": flags::OBJECT, "text": "{}" })),
                None
            ),
            1
        );
    }

    #[test]
    fn allow_list_matches_library_symbols_and_base_types() {
        let error = json!({ "id": "e", "flags": flags::OBJECT, "text": "Error", "symbol": "Error", "lib": true });
        assert_eq!(run(error, None), 0);
        let local = json!({ "id": "l", "flags": flags::OBJECT, "text": "Error", "symbol": "Error", "lib": false });
        assert_eq!(run(local, None), 1);
        let subclass = json!({ "id": "m", "flags": flags::OBJECT, "text": "MyError", "symbol": "MyError", "lib": false, "bases": ["Error"] });
        assert_eq!(run(subclass, None), 0);
    }

    #[test]
    fn options_disable_testers() {
        let number = json!({ "id": "n", "flags": flags::NUMBER, "text": "number" });
        assert_eq!(run(number.clone(), None), 0);
        assert_eq!(run(number, Some(json!({ "allowNumber": false }))), 1);
    }
}
