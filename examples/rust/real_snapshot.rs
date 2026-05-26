mod support;

use corsa::{
    CorsaError,
    api::{ApiClient, ApiMode, UpdateSnapshotParams},
    runtime::block_on,
};
use serde_json::json;

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let workspace_root = support::workspace_root();
        let dataset = support::real_dataset();
        let dataset_wire = dataset.display().to_string();
        let client = ApiClient::spawn(support::real_api_config(
            "real_snapshot",
            ApiMode::SyncMsgpackStdio,
        )?)
        .await?;
        let init = client.initialize().await?;
        let config = client.parse_config_file(dataset_wire.as_str()).await?;
        let snapshot = client
            .update_snapshot(UpdateSnapshotParams {
                open_project: Some(dataset_wire.clone()),
                file_changes: None,
                overlay_changes: None,
            })
            .await?;
        let project = snapshot.projects.first().ok_or_else(|| {
            CorsaError::Protocol("real snapshot example did not return a project".into())
        })?;
        let primary_file = config
            .file_names
            .iter()
            .find(|file| !file.ends_with(".d.ts"))
            .cloned()
            .or_else(|| config.file_names.first().cloned())
            .ok_or_else(|| {
                CorsaError::Protocol("real snapshot example did not find a file".into())
            })?;
        let source = client
            .get_source_file(
                snapshot.handle.clone(),
                project.id.clone(),
                primary_file.as_str(),
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol("real snapshot example did not return source".into())
            })?;
        let string_type = client
            .get_string_type(snapshot.handle.clone(), project.id.clone())
            .await?;
        let rendered = client
            .type_to_string(
                snapshot.handle.clone(),
                project.id.clone(),
                string_type.id.clone(),
                None,
                None,
            )
            .await?;

        let result = json!({
            "currentDirectory": support::normalize_path(&workspace_root, &init.current_directory),
            "configFileName": support::normalize_path(&workspace_root, &project.config_file_name),
            "fileCount": config.file_names.len(),
            "primaryFile": support::normalize_path(&workspace_root, primary_file.as_str()),
            "projectId": project.id,
            "sourceLength": source.as_bytes().len(),
            "stringTypeText": rendered,
        });
        snapshot.release().await?;
        client.close().await?;
        Ok::<_, corsa::CorsaError>(result)
    })?;

    support::print_json(result);
    Ok(())
}
