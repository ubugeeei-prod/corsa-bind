use std::path::Path;

use ox_content_allocator::Allocator;
use ox_content_parser::Parser;
use ox_content_renderer::{HtmlRenderer, HtmlRendererOptions};

use crate::site::SiteBuildError;

/// Markdown document after frontmatter has been removed.
pub struct MarkdownDocument {
    /// Optional frontmatter title.
    pub title: Option<String>,
    /// Optional frontmatter description.
    pub description: Option<String>,
    /// Markdown body rendered by Ox Content.
    pub body: String,
}

/// Extracts simple YAML-style `title` and `description` frontmatter.
pub fn parse_markdown(source: &str) -> MarkdownDocument {
    let Some(rest) = source.strip_prefix("---\n") else {
        return MarkdownDocument {
            title: None,
            description: None,
            body: source.to_string(),
        };
    };
    let Some(end) = rest.find("\n---\n") else {
        return MarkdownDocument {
            title: None,
            description: None,
            body: source.to_string(),
        };
    };

    let frontmatter = &rest[..end];
    let body = rest[end + "\n---\n".len()..].to_string();
    MarkdownDocument {
        title: frontmatter_value(frontmatter, "title"),
        description: frontmatter_value(frontmatter, "description"),
        body,
    }
}

/// Renders Markdown to HTML using Ox Content's parser and renderer.
pub fn render_markdown(path: &Path, body: &str, base: &str) -> Result<String, SiteBuildError> {
    let allocator = Allocator::new();
    let parser = Parser::new(&allocator, body);
    let document = parser
        .parse()
        .map_err(|error| SiteBuildError::Markdown(error.to_string()))?;
    let mut renderer = HtmlRenderer::with_options(HtmlRendererOptions {
        convert_md_links: true,
        base_url: base.to_string(),
        source_path: path.to_string_lossy().into_owned(),
        code_annotations: true,
        ..HtmlRendererOptions::default()
    });

    Ok(renderer.render(&document))
}

fn frontmatter_value(frontmatter: &str, key: &str) -> Option<String> {
    frontmatter.lines().find_map(|line| {
        let (candidate, value) = line.split_once(':')?;
        if candidate.trim() != key {
            return None;
        }
        Some(value.trim().trim_matches('"').to_string()).filter(|value| !value.is_empty())
    })
}
