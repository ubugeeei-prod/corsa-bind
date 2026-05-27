use std::fs;
use std::path::{Path, PathBuf};

use ox_content_ssg::{
    build_nav_items, collect_markdown_files, externalize_shared_page_assets, extract_title,
    generate_html, get_output_path, get_url_path, GeneratedHtmlPage, PageData, SsgConfig,
};
use thiserror::Error;

use crate::api::write_api_reference;
use crate::config::DocsSiteConfig;
use crate::markdown::{parse_markdown, render_markdown};
use crate::toc::markdown_toc;

/// Errors raised while building the generated documentation site.
#[derive(Debug, Error)]
pub enum SiteBuildError {
    /// Filesystem operation failed.
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    /// Ox Content API extraction failed.
    #[error("API docs error: {0}")]
    ApiDocs(#[from] ox_content_docs::GraphError),
    /// Markdown parsing or rendering failed.
    #[error("Markdown error: {0}")]
    Markdown(String),
}

/// Builds handwritten docs and generated API reference pages into static HTML.
pub fn build_site(config: &DocsSiteConfig) -> Result<(), SiteBuildError> {
    prepare_content_tree(config)?;
    let files = collect_markdown_files(config.content_dir.to_string_lossy().as_ref(), &md_exts());
    let nav = build_nav_items(
        &files,
        config.content_dir.to_string_lossy().as_ref(),
        &config.base,
        ".html",
    );
    let pages = files
        .iter()
        .map(|file| render_page(config, file, &nav))
        .collect::<Result<Vec<_>, _>>()?;
    let assets = externalize_shared_page_assets(
        pages,
        config.out_dir.to_string_lossy().as_ref(),
        &config.base,
    );

    for page in assets.pages {
        write_file(&page.output_path, &page.html)?;
    }
    for asset in assets.assets {
        write_file(&asset.output_path, &asset.content)?;
    }
    write_file(config.out_dir.join(".nojekyll"), "")?;
    Ok(())
}

fn prepare_content_tree(config: &DocsSiteConfig) -> Result<(), SiteBuildError> {
    let _ = fs::remove_dir_all(&config.content_dir);
    fs::create_dir_all(&config.content_dir)?;
    copy_markdown_dir(&config.root.join("docs"), &config.content_dir)?;
    write_api_reference(config, &config.content_dir.join("api"))?;
    let _ = fs::remove_dir_all(&config.out_dir);
    fs::create_dir_all(&config.out_dir)?;
    Ok(())
}

fn render_page(
    config: &DocsSiteConfig,
    file: &str,
    nav: &[ox_content_ssg::NavGroup],
) -> Result<GeneratedHtmlPage, SiteBuildError> {
    let source = fs::read_to_string(file)?;
    let document = parse_markdown(&source);
    let html = render_markdown(Path::new(file), &document.body, &config.base)?;
    let title = extract_title(&html, document.title.as_deref());
    let output_path = get_output_path(
        file,
        config.content_dir.to_string_lossy().as_ref(),
        config.out_dir.to_string_lossy().as_ref(),
        ".html",
    );
    let page_data = PageData {
        title,
        description: document.description,
        content: html,
        toc: markdown_toc(&document.body),
        last_updated: None,
        path: get_url_path(file, config.content_dir.to_string_lossy().as_ref()),
        entry_page: None,
    };

    Ok(GeneratedHtmlPage {
        input_path: file.to_string(),
        output_path,
        html: generate_html(&page_data, nav, &ssg_config(config)),
    })
}

fn copy_markdown_dir(source: &Path, destination: &Path) -> Result<(), SiteBuildError> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        fs::copy(&path, destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn ssg_config(config: &DocsSiteConfig) -> SsgConfig {
    SsgConfig {
        site_name: "corsa".to_string(),
        base: config.base.clone(),
        og_image: None,
        theme: None,
        locale: None,
        available_locales: None,
    }
}

fn md_exts() -> Vec<String> {
    vec!["md".to_string(), "mdx".to_string()]
}

fn write_file(path: impl Into<PathBuf>, contents: &str) -> Result<(), SiteBuildError> {
    let path = path.into();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, contents)?;
    Ok(())
}
