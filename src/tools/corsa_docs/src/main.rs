mod api;
mod config;
mod markdown;
mod site;
mod toc;

use std::path::PathBuf;

use config::DocsSiteConfig;
use site::SiteBuildError;

/// Builds the Ox Content documentation site for local preview or Void deploys.
fn main() -> Result<(), SiteBuildError> {
    let root = std::env::current_dir()?;
    let out_dir = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("dist/docs"));
    let config = DocsSiteConfig::from_root(root, out_dir);

    site::build_site(&config)?;
    println!("generated docs at {}", config.out_dir.display());
    Ok(())
}
