mod support;

use corsa::{
    CorsaError,
    api::{ApiClient, ApiMode, PrintNodeOptions, UpdateSnapshotParams},
    runtime::block_on,
};
use serde_json::json;

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let client = ApiClient::spawn(
            support::mock_api_config("print_node_opt_in", ApiMode::AsyncJsonRpcStdio)?
                .with_allow_unstable_upstream_calls(true),
        )
        .await?;
        let snapshot = client
            .update_snapshot(UpdateSnapshotParams {
                open_project: Some("/workspace/tsconfig.json".into()),
                file_changes: None,
                overlay_changes: None,
            })
            .await?;
        let project = snapshot.projects.first().ok_or_else(|| {
            CorsaError::Protocol("print node example did not return a project".into())
        })?;
        let string_type = client
            .get_string_type(snapshot.handle.clone(), project.id.clone())
            .await?;
        let type_node = client
            .type_to_type_node(
                snapshot.handle.clone(),
                project.id.clone(),
                string_type.id.clone(),
                None,
                None,
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol("print node example did not return a type node".into())
            })?;
        let rendered = client
            .print_node(
                &type_node,
                PrintNodeOptions {
                    preserve_source_newlines: true,
                    ..PrintNodeOptions::default()
                },
            )
            .await?;
        let type_text = client
            .type_to_string(
                snapshot.handle.clone(),
                project.id.clone(),
                string_type.id.clone(),
                None,
                None,
            )
            .await?;

        let result = json!({
            "allowsUnstableUpstreamCalls": client.allows_unstable_upstream_calls(),
            "typeId": string_type.id,
            "typeNodeBytes": type_node.as_bytes().len(),
            "printedNode": rendered,
            "typeToString": type_text,
        });
        snapshot.release().await?;
        client.close().await?;
        Ok::<_, corsa::CorsaError>(result)
    })?;

    support::print_json(result);
    Ok(())
}
