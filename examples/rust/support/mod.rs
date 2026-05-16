#![allow(dead_code)]

use std::path::{Path, PathBuf};

use corsa::{
    TsgoError,
    api::{ApiMode, ApiSpawnConfig},
    lsp::LspSpawnConfig,
};
use serde_json::Value;

fn executable_suffix() -> &'static str {
    if cfg!(windows) { ".exe" } else { "" }
}

pub fn workspace_root() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            return dir;
        }
        assert!(
            dir.pop(),
            "failed to locate workspace root from {}",
            env!("CARGO_MANIFEST_DIR")
        );
    }
}

pub fn example_cwd(name: &str) -> PathBuf {
    let cwd = workspace_root().join("target/examples").join(name);
    std::fs::create_dir_all(&cwd).unwrap();
    cwd
}

pub fn mock_binary() -> PathBuf {
    workspace_root()
        .join("target/debug")
        .join(format!("mock_tsgo{}", executable_suffix()))
}

pub fn resolved_real_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("TSGO_EXECUTABLE") {
        let path = PathBuf::from(path);
        if path.exists() {
            return Some(path);
        }
    }
    [
        workspace_root().join(format!(".cache/tsgo{}", executable_suffix())),
        workspace_root().join(format!(
            "ref/typescript-go/.cache/tsgo{}",
            executable_suffix()
        )),
        workspace_root().join(format!(
            "ref/typescript-go/built/local/tsgo{}",
            executable_suffix()
        )),
    ]
    .into_iter()
    .find(|path| path.exists())
}

pub fn real_dataset() -> PathBuf {
    [
        workspace_root().join("ref/typescript-go/_packages/native-preview/tsconfig.json"),
        workspace_root().join("ref/typescript-go/_packages/api/tsconfig.json"),
    ]
    .into_iter()
    .find(|path| path.exists())
    .unwrap_or_else(|| {
        workspace_root().join("ref/typescript-go/_packages/native-preview/tsconfig.json")
    })
}

pub fn require_path(path: &Path, label: &str, hint: &str) -> Result<(), TsgoError> {
    if path.exists() {
        Ok(())
    } else {
        Err(TsgoError::Protocol(
            format!("missing {label} at {}; {hint}", path.display()).into(),
        ))
    }
}

pub fn mock_api_config(example_name: &str, mode: ApiMode) -> Result<ApiSpawnConfig, TsgoError> {
    let binary = mock_binary();
    require_path(
        &binary,
        "mock tsgo binary",
        "run `vp run -w build_mock` or `vp run -w build` first",
    )?;
    Ok(ApiSpawnConfig::new(binary)
        .with_mode(mode)
        .with_cwd(example_cwd(example_name)))
}

pub fn mock_lsp_config(example_name: &str) -> Result<LspSpawnConfig, TsgoError> {
    let binary = mock_binary();
    require_path(
        &binary,
        "mock tsgo binary",
        "run `vp run -w build_mock` or `vp run -w build` first",
    )?;
    Ok(LspSpawnConfig::new(binary).with_cwd(example_cwd(example_name)))
}

pub fn real_api_config(_example_name: &str, mode: ApiMode) -> Result<ApiSpawnConfig, TsgoError> {
    let binary = resolved_real_binary().ok_or_else(|| {
        TsgoError::Protocol("missing real tsgo binary; run `vp run -w build_tsgo` first".into())
    })?;
    let dataset = real_dataset();
    require_path(
        &dataset,
        "pinned tsgo dataset",
        "run `vp run -w sync_ref` and `vp run -w verify_ref` first",
    )?;
    Ok(ApiSpawnConfig::new(binary)
        .with_mode(mode)
        .with_cwd(workspace_root()))
}

pub fn normalize_path(workspace_root: &Path, value: &str) -> String {
    if value == workspace_root.display().to_string() {
        return ".".to_owned();
    }
    workspace_root
        .join("")
        .as_path()
        .to_str()
        .and_then(|root| value.strip_prefix(root))
        .map(|relative| relative.trim_start_matches('/').to_owned())
        .unwrap_or_else(|| value.to_owned())
}

pub fn print_json(value: Value) {
    println!("{}", serde_json::to_string_pretty(&value).unwrap());
}
