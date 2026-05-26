mod support;

use corsa::{
    CorsaError,
    api::{ApiClient, ApiMode, UpdateSnapshotParams},
    runtime::block_on,
};
use serde_json::json;

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let client = ApiClient::spawn(support::mock_api_config(
            "mock_client",
            ApiMode::AsyncJsonRpcStdio,
        )?)
        .await?;
        let init = client.initialize().await?;
        let config = client.parse_config_file("/workspace/tsconfig.json").await?;
        let snapshot = client
            .update_snapshot(UpdateSnapshotParams {
                open_project: Some("/workspace/tsconfig.json".into()),
                file_changes: None,
                overlay_changes: None,
            })
            .await?;
        let project = snapshot.projects.first().ok_or_else(|| {
            CorsaError::Protocol("mock client example did not return a project".into())
        })?;
        let source = client
            .get_source_file(
                snapshot.handle.clone(),
                project.id.clone(),
                "/workspace/src/index.ts",
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol("mock client example did not return source".into())
            })?;
        let source_text = String::from_utf8(source.as_bytes().to_vec()).map_err(|err| {
            CorsaError::Protocol(format!("source file was not utf8: {err}").into())
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
            "currentDirectory": init.current_directory,
            "projectId": project.id,
            "configFileName": project.config_file_name,
            "fileCount": config.file_names.len(),
            "sourceFileText": source_text,
            "stringTypeText": rendered,
        });
        snapshot.release().await?;
        client.close().await?;
        Ok::<_, corsa::CorsaError>(result)
    })?;

    support::print_json(result);
    Ok(())
}
