mod support;

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use corsa::{
    api::{ApiMode, ApiProfile, UpdateSnapshotParams},
    observability::{CorsaEvent, CorsaObserver},
    orchestrator::{ApiOrchestrator, ApiOrchestratorConfig},
    runtime::block_on,
};
use serde_json::{Value, json};

#[derive(Default)]
struct EventCollector {
    events: Mutex<Vec<CorsaEvent>>,
}

impl CorsaObserver for EventCollector {
    fn on_event(&self, event: &CorsaEvent) {
        self.events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push(event.clone());
    }
}

fn event_to_value(event: &CorsaEvent) -> Value {
    match event {
        CorsaEvent::OrchestratorSnapshotEvicted { key } => {
            json!({ "kind": "orchestratorSnapshotEvicted", "key": key })
        }
        CorsaEvent::OrchestratorResultEvicted { key } => {
            json!({ "kind": "orchestratorResultEvicted", "key": key })
        }
        other => json!({ "kind": "other", "debug": format!("{other:?}") }),
    }
}

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let observer = Arc::new(EventCollector::default());
        let orchestrator = ApiOrchestrator::new(
            ApiOrchestratorConfig {
                max_workers_per_profile: 2,
                max_cached_snapshots: 1,
                max_cached_results: 1,
                work_queue_capacity: 4,
                observer: None,
            }
            .with_observer(observer.clone()),
        );
        let profile = ApiProfile::new(
            "observability-demo",
            support::mock_api_config("observer_events", ApiMode::AsyncJsonRpcStdio)?,
        );

        let _ = orchestrator
            .cached_snapshot(
                &profile,
                "workspace-a",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/a/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await?;
        let _ = orchestrator
            .cached_snapshot(
                &profile,
                "workspace-b",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/b/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await?;
        let _: Value = orchestrator
            .cached(
                &profile,
                "ping-a",
                Some(Duration::from_secs(30)),
                |client| async move { client.raw_json_request("ping", Value::Null).await },
            )
            .await?;
        let _: Value = orchestrator
            .cached(
                &profile,
                "ping-b",
                Some(Duration::from_secs(30)),
                |client| async move { client.raw_json_request("ping", Value::Null).await },
            )
            .await?;
        let stats = orchestrator.stats();
        let events = observer
            .events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .map(event_to_value)
            .collect::<Vec<_>>();

        Ok::<_, corsa::CorsaError>(json!({
            "events": events,
            "stats": {
                "cachedSnapshotCount": stats.cached_snapshot_count,
                "cachedResultCount": stats.cached_result_count,
                "workerCount": stats.worker_count,
            },
        }))
    })?;

    support::print_json(result);
    Ok(())
}
