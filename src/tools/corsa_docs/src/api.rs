use std::fs;
use std::path::{Path, PathBuf};

use ox_content_docs::{
    extract_docs_from_entry_points, generate_markdown, ApiDocEntry, ApiDocModule, ApiDocTag,
    ApiParamDoc, ApiReturnDoc, EntryPointDocsOptions, EntryPointSpec, GraphOptions,
    MarkdownDocsOptions, NormalizedDocEntry,
};

use crate::config::DocsSiteConfig;
use crate::site::SiteBuildError;

/// Generates API Markdown from TypeScript entry points with Ox Content Docs.
pub fn write_api_reference(config: &DocsSiteConfig, api_dir: &Path) -> Result<(), SiteBuildError> {
    fs::create_dir_all(api_dir)?;
    let docs = extract_docs_from_entry_points(&entrypoints(&config.root), &entry_options(config))?;
    let modules = docs
        .into_iter()
        .map(|module| ApiDocModule {
            file: module.name,
            entries: module.entries.into_iter().map(api_entry).collect(),
        })
        .collect::<Vec<_>>();
    let pages = generate_markdown(
        &modules,
        &MarkdownDocsOptions {
            group_by: "file".to_string(),
            github_url: Some(config.github_url.clone()),
        },
    );

    for (file_name, contents) in pages {
        fs::write(api_dir.join(file_name), contents)?;
    }
    Ok(())
}

fn entrypoints(root: &Path) -> Vec<EntryPointSpec> {
    [
        (
            "src/bindings/nodejs/corsa_node/ts/index.ts",
            "@corsa-bind/napi",
        ),
        (
            "src/bindings/nodejs/corsa_oxlint/ts/index.ts",
            "corsa-oxlint",
        ),
        (
            "src/bindings/nodejs/corsa_oxlint/ts/rules/index.ts",
            "corsa-oxlint/rules",
        ),
    ]
    .into_iter()
    .map(|(path, name)| EntryPointSpec {
        path: root.join(path),
        name: Some(name.to_string()),
    })
    .collect()
}

fn entry_options(config: &DocsSiteConfig) -> EntryPointDocsOptions {
    EntryPointDocsOptions {
        graph: GraphOptions {
            root: Some(config.root.clone()),
            tsconfig: Some(PathBuf::from("tsconfig.json")),
        },
        include_private: false,
        include_internal: false,
    }
}

fn api_entry(entry: NormalizedDocEntry) -> ApiDocEntry {
    ApiDocEntry {
        name: entry.name,
        kind: entry.kind.as_str().to_string(),
        description: entry.description,
        params: entry
            .params
            .into_iter()
            .map(|param| ApiParamDoc {
                name: param.name,
                type_annotation: param.type_annotation,
                description: param.description,
                optional: param.optional,
                default_value: param.default_value,
            })
            .collect(),
        returns: entry.returns.map(|returns| ApiReturnDoc {
            type_annotation: returns.type_annotation,
            description: returns.description,
        }),
        examples: entry.examples,
        tags: entry
            .tags
            .into_iter()
            .map(|(tag, value)| ApiDocTag { tag, value })
            .collect(),
        private: entry.private,
        file: entry.file,
        line: entry.line,
        end_line: entry.end_line,
        signature: entry.signature,
    }
}
