#![allow(dead_code)]

use napi::Result;
use napi_derive::napi;
use serde_json::Value;

use crate::util::{from_value, into_napi_error, to_value};

#[napi]
pub fn run_native_lint_rule(rule_name: String, node: Value) -> Result<Value> {
    let node = from_value::<corsa::lint::LintNode>(node)?;
    let Some(diagnostics) = corsa::lint::run_default_type_aware_rule(rule_name.as_str(), &node)
    else {
        return Err(into_napi_error(format!(
            "unknown native lint rule: {rule_name}"
        )));
    };
    to_value(&diagnostics)
}

#[napi]
pub fn native_lint_rule_metas() -> Result<Value> {
    to_value(&corsa::lint::LintRuleRegistry::with_default_type_aware_rules().metas())
}

#[napi]
pub fn run_native_stylistic_lint(source_text: String, config: Value) -> Result<Value> {
    let config = from_value::<corsa::lint::StylisticRunConfig>(config)?;
    let diagnostics =
        corsa::lint::run_stylistic_lint(source_text.as_str(), &config).map_err(into_napi_error)?;
    to_value(&diagnostics)
}

#[napi]
pub fn native_stylistic_rule_metas() -> Result<Value> {
    to_value(&corsa::lint::stylistic_rule_metas())
}
