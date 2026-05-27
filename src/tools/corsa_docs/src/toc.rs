use ox_content_ssg::TocEntry;

/// Builds a table of contents from Markdown headings.
pub fn markdown_toc(source: &str) -> Vec<TocEntry> {
    source
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            let depth = trimmed.chars().take_while(|ch| *ch == '#').count();
            if !(1..=3).contains(&depth) || !trimmed[depth..].starts_with(' ') {
                return None;
            }
            let text = trimmed[depth..].trim().trim_matches('#').trim();
            Some(TocEntry {
                depth: depth as u8,
                text: text.to_string(),
                slug: slugify(text),
            })
        })
        .collect()
}

fn slugify(text: &str) -> String {
    let mut slug = String::new();
    let mut pending_dash = false;
    for ch in text.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(ch);
        } else {
            pending_dash = true;
        }
    }
    slug
}
