use std::path::PathBuf;

/// Configuration for the generated documentation site.
///
/// The site is assembled from handwritten Markdown in `docs/` plus API
/// reference pages extracted from TypeScript documentation comments.
pub struct DocsSiteConfig {
    /// Repository root used to resolve source and docs paths.
    pub root: PathBuf,
    /// Final static HTML directory consumed by `npx void deploy --dir`.
    pub out_dir: PathBuf,
    /// Temporary content tree containing handwritten and generated Markdown.
    pub content_dir: PathBuf,
    /// Public base path used by generated HTML links.
    pub base: String,
    /// GitHub source URL used by generated API reference pages.
    pub github_url: String,
}

impl DocsSiteConfig {
    /// Creates the default site configuration rooted at the current repository.
    pub fn from_root(root: PathBuf, out_dir: PathBuf) -> Self {
        Self {
            content_dir: root.join(".cache/corsa-docs/content"),
            github_url: "https://github.com/ubugeeei/corsa-bind".to_string(),
            root,
            out_dir,
            base: "/".to_string(),
        }
    }
}
