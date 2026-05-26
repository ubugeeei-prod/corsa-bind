mod support;

use std::{sync::Arc, time::Duration};

use corsa::{
    api::{ApiMode, ApiProfile, UpdateSnapshotParams},
    fast::compact_format,
    orchestrator::ApiOrchestrator,
    runtime::block_on,
};
use serde_json::{Value, json};

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = ApiProfile::new(
            "orchestrator-demo",
            support::mock_api_config("orchestrator_cache", ApiMode::AsyncJsonRpcStdio)?,
        );
        orchestrator.prewarm(&profile, 2).await?;

        let snapshot_a = orchestrator
            .cached_snapshot(
                &profile,
                "workspace",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await?;
        let snapshot_b = orchestrator
            .cached_snapshot(
                &profile,
                "workspace",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await?;
        let ping: Value = orchestrator
            .cached(
                &profile,
                "ping",
                Some(Duration::from_secs(30)),
                |client| async move { client.raw_json_request("ping", Value::Null).await },
            )
            .await?;
        let echoed_values = orchestrator
            .execute_all(&profile, 2, [1_u32, 2, 3, 4], |client, value| async move {
                let echoed = client
                    .raw_json_request("echo", json!({ "value": value }))
                    .await?;
                let Some(echoed_value) = echoed.get("value").and_then(Value::as_u64) else {
                    return Err(corsa::CorsaError::Protocol(compact_format(format_args!(
                        "echo response did not contain a numeric `value`: {echoed}"
                    ))));
                };
                let echoed_value = u32::try_from(echoed_value).map_err(|_| {
                    corsa::CorsaError::Protocol(compact_format(format_args!(
                        "echo response value is outside u32 range: {echoed_value}"
                    )))
                })?;
                Ok::<_, corsa::CorsaError>(echoed_value)
            })
            .await?;
        let stats = orchestrator.stats();

        Ok::<_, corsa::CorsaError>(json!({
            "snapshotCacheHit": Arc::ptr_eq(&snapshot_a, &snapshot_b),
            "snapshotHandle": snapshot_a.handle,
            "cachedPing": ping,
            "echoedValues": echoed_values,
            "stats": {
                "profileCount": stats.profile_count,
                "workerCount": stats.worker_count,
                "cachedSnapshotCount": stats.cached_snapshot_count,
                "cachedResultCount": stats.cached_result_count,
            },
        }))
    })?;

    support::print_json(result);
    Ok(())
}
