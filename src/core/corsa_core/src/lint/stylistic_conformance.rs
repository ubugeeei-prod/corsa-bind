//! Data-driven conformance harness for the native stylistic rules.
//!
//! When the research spec corpus is present under
//! `.cache/stylistic_specs/<rule>.json`, this test runs every implemented rule
//! against the spec's `testVectors` (small snippets with an expected violation
//! count under the rule's default options) and reports the agreement rate.
//!
//! The spec corpus is an LLM-generated oracle, so it is *informational*: the
//! test prints a per-rule conformance summary (visible with `--nocapture`) and
//! only hard-fails if a rule regresses below its recorded floor in
//! [`CONFORMANCE_FLOORS`]. This keeps known oracle noise from breaking CI while
//! still catching real regressions in rules we have already aligned.

#![cfg(test)]

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde_json::Value;

use super::{StylisticRuleConfig, StylisticRunConfig, run_stylistic_lint};

fn specs_dir() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../.cache/stylistic_specs"
    ))
}

/// Rules whose conformance we have already driven to a known level. The test
/// fails if the measured agreement on the spec vectors drops below the floor,
/// guarding against regressions while we keep raising coverage.
const CONFORMANCE_FLOORS: &[(&str, f64)] = &[
    ("array-bracket-spacing", 0.95),
    ("block-spacing", 0.95),
    ("comma-dangle", 0.95),
    ("computed-property-spacing", 0.95),
    ("function-call-spacing", 0.9),
    ("generator-star-spacing", 0.95),
    ("max-len", 0.95),
    ("no-floating-decimal", 0.95),
    ("object-curly-spacing", 0.95),
    ("space-before-blocks", 0.95),
    ("space-before-function-paren", 0.95),
    ("space-infix-ops", 0.9),
    ("template-tag-spacing", 0.9),
    ("yield-star-spacing", 0.95),
    ("semi-style", 0.95),
    ("comma-style", 0.95),
    ("arrow-parens", 0.95),
    ("switch-colon-spacing", 0.95),
    ("no-extra-semi", 0.95),
    ("new-parens", 0.95),
    ("space-unary-ops", 0.9),
    ("wrap-regex", 0.95),
    ("implicit-arrow-linebreak", 0.95),
    ("operator-linebreak", 0.9),
    ("keyword-spacing", 0.95),
];

fn implemented_rule_names() -> Vec<String> {
    super::stylistic_rule_metas()
        .into_iter()
        .map(|meta| meta.name)
        .collect()
}

#[test]
fn stylistic_rules_match_spec_vectors() {
    let dir = specs_dir();
    let Ok(entries) = fs::read_dir(&dir) else {
        eprintln!("stylistic spec corpus not present at {dir:?}; skipping conformance check");
        return;
    };
    let implemented: Vec<String> = implemented_rule_names();

    let mut per_rule: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut mismatches: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(spec): Result<Value, _> = serde_json::from_str(&text) else {
            continue;
        };
        let rule = spec
            .get("rule")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if !implemented.contains(&rule) {
            continue;
        }
        let Some(vectors) = spec.get("testVectors").and_then(Value::as_array) else {
            continue;
        };
        for vector in vectors {
            // Prefer the real `@stylistic` count (`oracleErrors`); fall back to
            // the LLM-authored `errors` only when the oracle did not run.
            let expected = match vector.get("oracleErrors") {
                Some(Value::Null) => continue, // oracle could not parse the snippet
                Some(value) => value.as_u64(),
                None => vector.get("errors").and_then(Value::as_u64),
            };
            let (Some(code), Some(expected)) =
                (vector.get("code").and_then(Value::as_str), expected)
            else {
                continue;
            };
            // Run with empty options so our rule applies its own defaults, the
            // same way the oracle ran the real rule with no explicit options.
            let config = StylisticRunConfig {
                rules: vec![StylisticRuleConfig {
                    name: rule.clone(),
                    options: Value::Null,
                }],
            };
            let actual = match run_stylistic_lint(code, &config) {
                Ok(diagnostics) => diagnostics
                    .iter()
                    .filter(|diagnostic| diagnostic.rule_name == rule)
                    .count() as u64,
                Err(_) => continue,
            };
            let entry = per_rule.entry(rule.clone()).or_insert((0, 0));
            entry.1 += 1;
            if actual == expected {
                entry.0 += 1;
            } else if mismatches.len() < 200 {
                mismatches.push(format!(
                    "  {rule}: expected {expected}, got {actual} for {code:?}"
                ));
            }
        }
    }

    if per_rule.is_empty() {
        return;
    }

    let mut total_pass = 0usize;
    let mut total = 0usize;
    eprintln!("\n=== stylistic conformance (spec vectors) ===");
    for (rule, (pass, count)) in &per_rule {
        total_pass += pass;
        total += count;
        eprintln!(
            "  {rule:32} {pass:3}/{count:<3} ({:.0}%)",
            100.0 * *pass as f64 / *count as f64
        );
    }
    eprintln!(
        "  {:32} {total_pass:3}/{total:<3} ({:.0}%)",
        "TOTAL",
        100.0 * total_pass as f64 / total.max(1) as f64
    );
    if !mismatches.is_empty() {
        eprintln!("--- mismatches (first {}) ---", mismatches.len());
        for line in &mismatches {
            eprintln!("{line}");
        }
    }

    // Regression guard for rules we have already aligned.
    let mut regressions = Vec::new();
    for (rule, floor) in CONFORMANCE_FLOORS {
        if let Some((pass, count)) = per_rule.get(*rule) {
            if *count == 0 {
                continue;
            }
            let rate = *pass as f64 / *count as f64;
            if rate + 1e-9 < *floor {
                regressions.push(format!(
                    "{rule}: {rate:.2} < floor {floor:.2} ({pass}/{count})"
                ));
            }
        }
    }
    assert!(
        regressions.is_empty(),
        "stylistic conformance regressed:\n{}",
        regressions.join("\n")
    );
}
