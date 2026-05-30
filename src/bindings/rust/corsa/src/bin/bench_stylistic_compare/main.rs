//! Times the native Rust stylistic engine over a corpus, for comparison against
//! the upstream `@stylistic` ESLint plugin.
//!
//! This binary measures only the corsa side. The Node orchestrator
//! (`bench/stylistic/compare.mjs`) runs the same corpus and the same rule set
//! through real `@stylistic`, then merges both into one report. It emits a
//! single JSON object on stdout:
//!
//! ```json
//! {"engine":"corsa","files":N,"bytes":N,"lines":N,"rules":N,
//!  "iterations":N,"diagnostics":N,"medianMs":F,"meanMs":F,"p95Ms":F,
//!  "mbPerSec":F}
//! ```
//!
//! Usage:
//! ```text
//! bench_stylistic_compare --corpus <dir> [--rules a,b,c] [--iterations 50]
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use corsa_core::lint::{run_stylistic_lint, stylistic_rule_metas, StylisticRuleConfig, StylisticRunConfig};
use serde_json::json;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--list-rules") {
        let names: Vec<String> = stylistic_rule_metas().into_iter().map(|m| m.name).collect();
        println!("{}", serde_json::to_string(&names).unwrap());
        return;
    }
    let corpus = arg_value(&args, "--corpus").expect("--corpus <dir> is required");
    let iterations: usize = arg_value(&args, "--iterations")
        .and_then(|value| value.parse().ok())
        .unwrap_or(50);
    let rule_filter: Option<Vec<String>> = arg_value(&args, "--rules")
        .map(|value| value.split(',').map(|name| name.trim().to_owned()).collect());

    let rules = select_rules(rule_filter);
    let config = StylisticRunConfig {
        rules: rules
            .iter()
            .map(|name| StylisticRuleConfig {
                name: name.clone(),
                options: serde_json::Value::Null,
            })
            .collect(),
    };

    let sources = read_corpus(Path::new(&corpus));
    if sources.is_empty() {
        eprintln!("no .ts/.tsx sources found under {corpus}");
        std::process::exit(1);
    }
    let bytes: usize = sources.iter().map(|source| source.len()).sum();
    let lines: usize = sources
        .iter()
        .map(|source| source.bytes().filter(|byte| *byte == b'\n').count() + 1)
        .sum();

    // Warm-up pass (also captures a stable diagnostic count).
    let mut diagnostics = 0usize;
    for source in &sources {
        diagnostics += run_stylistic_lint(source, &config).map(|d| d.len()).unwrap_or(0);
    }

    let mut samples = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let start = Instant::now();
        for source in &sources {
            let _ = run_stylistic_lint(source, &config);
        }
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());

    let median = samples[samples.len() / 2];
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let p95 = samples[((samples.len() as f64 * 0.95) as usize).min(samples.len() - 1)];
    let mb = bytes as f64 / (1024.0 * 1024.0);
    let mb_per_sec = if median > 0.0 { mb / (median / 1000.0) } else { 0.0 };

    let report = json!({
        "engine": "corsa",
        "files": sources.len(),
        "bytes": bytes,
        "lines": lines,
        "rules": rules.len(),
        "iterations": iterations,
        "diagnostics": diagnostics,
        "medianMs": round3(median),
        "meanMs": round3(mean),
        "p95Ms": round3(p95),
        "mbPerSec": round3(mb_per_sec),
    });
    println!("{report}");
}

/// Resolves the rule set: an explicit filter intersected with the implemented
/// rules, or every implemented rule when no filter is given.
fn select_rules(filter: Option<Vec<String>>) -> Vec<String> {
    let implemented: Vec<String> = stylistic_rule_metas()
        .into_iter()
        .map(|meta| meta.name)
        .collect();
    match filter {
        Some(names) => names
            .into_iter()
            .filter(|name| implemented.contains(name))
            .collect(),
        None => implemented,
    }
}

fn read_corpus(dir: &Path) -> Vec<String> {
    let mut sources = Vec::new();
    collect_sources(dir, &mut sources);
    sources
}

fn collect_sources(dir: &Path, sources: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    for path in paths {
        if path.is_dir() {
            collect_sources(&path, sources);
        } else if is_source(&path) {
            if let Ok(text) = fs::read_to_string(&path) {
                sources.push(text);
            }
        }
    }
}

fn is_source(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    // Skip declaration files; they carry little stylistic signal.
    if name.ends_with(".d.ts") {
        return false;
    }
    matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("ts" | "tsx" | "js" | "jsx" | "mts" | "cts")
    )
}

fn arg_value(args: &[String], flag: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == flag)
        .and_then(|index| args.get(index + 1))
        .cloned()
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}
