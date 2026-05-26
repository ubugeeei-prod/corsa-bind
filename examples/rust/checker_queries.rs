mod support;

use corsa::{
    CorsaError,
    api::{ApiClient, ApiMode, DocumentPosition, UpdateSnapshotParams},
    runtime::block_on,
};
use serde_json::json;

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let client = ApiClient::spawn(support::mock_api_config(
            "checker_queries",
            ApiMode::AsyncJsonRpcStdio,
        )?)
        .await?;
        let snapshot = client
            .update_snapshot(UpdateSnapshotParams {
                open_project: Some("/workspace/tsconfig.json".into()),
                file_changes: None,
                overlay_changes: None,
            })
            .await?;
        let project = snapshot.projects.first().ok_or_else(|| {
            CorsaError::Protocol("checker queries example did not return a project".into())
        })?;
        let symbol = client
            .get_symbol_at_position(
                snapshot.handle.clone(),
                project.id.clone(),
                "/workspace/src/index.ts",
                1,
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol("checker queries example did not resolve a symbol".into())
            })?;
        let declaration = symbol.value_declaration.clone().ok_or_else(|| {
            CorsaError::Protocol("checker queries example did not return a declaration".into())
        })?;
        let parsed = declaration.parse()?;
        let type_at_position = client
            .get_type_at_position(
                snapshot.handle.clone(),
                project.id.clone(),
                "/workspace/src/index.ts",
                1,
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol("checker queries example did not resolve a type".into())
            })?;
        let type_at_location = client
            .get_type_at_location(
                snapshot.handle.clone(),
                project.id.clone(),
                declaration.clone(),
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol(
                    "checker queries example did not resolve a location type".into(),
                )
            })?;
        let declared_type = client
            .get_declared_type_of_symbol(
                snapshot.handle.clone(),
                project.id.clone(),
                symbol.id.clone(),
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol(
                    "checker queries example did not resolve a declared type".into(),
                )
            })?;
        let signatures = client
            .get_signatures_of_type(
                snapshot.handle.clone(),
                project.id.clone(),
                type_at_position.id.clone(),
                0,
            )
            .await?;
        let signature = signatures.first().ok_or_else(|| {
            CorsaError::Protocol("checker queries example did not return a signature".into())
        })?;
        let return_type = client
            .get_return_type_of_signature(
                snapshot.handle.clone(),
                project.id.clone(),
                signature.id.clone(),
            )
            .await?
            .ok_or_else(|| {
                CorsaError::Protocol("checker queries example did not resolve a return type".into())
            })?;
        let predicate = client
            .get_type_predicate_of_signature(
                snapshot.handle.clone(),
                project.id.clone(),
                signature.id.clone(),
            )
            .await?;
        let properties = client
            .get_properties_of_type(
                snapshot.handle.clone(),
                project.id.clone(),
                type_at_position.id.clone(),
            )
            .await?;
        let index_infos = client
            .get_index_infos_of_type(
                snapshot.handle.clone(),
                project.id.clone(),
                type_at_position.id.clone(),
            )
            .await?;
        let batch_symbols = client
            .get_symbols_at_positions(
                snapshot.handle.clone(),
                project.id.clone(),
                "/workspace/src/index.ts",
                vec![1, 2],
            )
            .await?;
        let batch_types = client
            .get_types_at_positions(
                snapshot.handle.clone(),
                project.id.clone(),
                "/workspace/src/index.ts",
                vec![1, 2],
            )
            .await?;
        let resolved = client
            .resolve_name_at_position(
                snapshot.handle.clone(),
                project.id.clone(),
                "value",
                2,
                DocumentPosition {
                    document: "/workspace/src/index.ts".into(),
                    position: 1,
                },
                None,
            )
            .await?;
        let symbol_of_type = client
            .get_symbol_of_type(snapshot.handle.clone(), type_at_position.id.clone())
            .await?;
        let exported = client
            .get_export_symbol_of_symbol(snapshot.handle.clone(), symbol.id.clone())
            .await?;

        let result = json!({
            "projectId": project.id,
            "symbol": {
                "id": symbol.id,
                "name": symbol.name,
                "declaration": {
                    "raw": declaration,
                    "kind": parsed.kind,
                    "path": parsed.path,
                    "pos": parsed.pos,
                    "end": parsed.end,
                },
            },
            "types": {
                "atPosition": type_at_position.texts.first(),
                "atLocation": type_at_location.texts.first(),
                "declared": declared_type.texts.first(),
                "returnType": return_type.texts.first(),
                "predicateType": predicate
                    .as_ref()
                    .and_then(|item| item.r#type.as_ref())
                    .and_then(|item| item.texts.first()),
            },
            "batch": {
                "symbolNames": batch_symbols
                    .iter()
                    .map(|item| item.as_ref().map(|item| item.name.clone()))
                    .collect::<Vec<_>>(),
                "typeIds": batch_types
                    .iter()
                    .map(|item| item.as_ref().map(|item| item.id.clone()))
                    .collect::<Vec<_>>(),
            },
            "signature": {
                "id": signature.id,
                "parameterCount": signature.parameters.len(),
            },
            "properties": properties.iter().map(|item| item.name.clone()).collect::<Vec<_>>(),
            "indexInfos": index_infos
                .iter()
                .map(|item| json!({
                    "keyType": item.key_type.texts.first(),
                    "valueType": item.value_type.texts.first(),
                    "isReadonly": item.is_readonly,
                }))
                .collect::<Vec<_>>(),
            "resolvedName": resolved.as_ref().map(|item| item.name.clone()),
            "symbolOfType": symbol_of_type.as_ref().map(|item| item.name.clone()),
            "exportedName": exported.name,
        });
        snapshot.release().await?;
        client.close().await?;
        Ok::<_, corsa::CorsaError>(result)
    })?;

    support::print_json(result);
    Ok(())
}
