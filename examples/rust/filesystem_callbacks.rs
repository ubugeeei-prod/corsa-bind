mod support;

use std::sync::Arc;

use corsa::{
    api::{
        ApiClient, ApiFileSystem, ApiMode, DirectoryEntries, FileSystemCapabilities,
        ReadFileResult, callback_flag, callback_names,
    },
    fast::{CompactString, FastMap, SmallVec},
    runtime::block_on,
};
use serde_json::json;

struct VirtualFs {
    files: FastMap<CompactString, CompactString>,
}

impl VirtualFs {
    fn new(entries: &[(&str, &str)]) -> Self {
        Self {
            files: entries
                .iter()
                .map(|(path, content)| (CompactString::from(*path), CompactString::from(*content)))
                .collect(),
        }
    }
}

impl ApiFileSystem for VirtualFs {
    fn capabilities(&self) -> FileSystemCapabilities {
        FileSystemCapabilities {
            read_file: true,
            file_exists: true,
            directory_exists: true,
            get_accessible_entries: true,
            realpath: true,
        }
    }

    fn read_file(&self, path: &str) -> ReadFileResult {
        self.files
            .get(path)
            .cloned()
            .map(ReadFileResult::Content)
            .unwrap_or(ReadFileResult::Fallback)
    }

    fn file_exists(&self, path: &str) -> Option<bool> {
        Some(self.files.contains_key(path))
    }

    fn directory_exists(&self, path: &str) -> Option<bool> {
        Some(path == "/virtual")
    }

    fn get_accessible_entries(&self, path: &str) -> Option<DirectoryEntries> {
        (path == "/virtual").then(|| DirectoryEntries {
            files: self
                .files
                .keys()
                .filter_map(|path| path.strip_prefix("/virtual/").map(CompactString::from))
                .collect(),
            directories: SmallVec::new(),
        })
    }

    fn realpath(&self, path: &str) -> Option<CompactString> {
        Some(path.into())
    }
}

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let filesystem = Arc::new(VirtualFs::new(&[
            ("/virtual/tsconfig.json", "{}"),
            ("/virtual/main.ts", "export const value = 1;\n"),
        ]));
        let client = ApiClient::spawn(
            support::mock_api_config("filesystem_callbacks", ApiMode::AsyncJsonRpcStdio)?
                .with_filesystem(filesystem.clone()),
        )
        .await?;
        let config = client.parse_config_file("/virtual/tsconfig.json").await?;
        let result = json!({
            "callbackNames": callback_names(filesystem.as_ref()),
            "callbackFlag": callback_flag(filesystem.as_ref()),
            "fileNames": config.file_names,
            "virtualOption": config.options["virtual"],
        });
        client.close().await?;
        Ok::<_, corsa::CorsaError>(result)
    })?;

    support::print_json(result);
    Ok(())
}
