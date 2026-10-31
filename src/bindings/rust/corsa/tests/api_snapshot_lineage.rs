//! Public fork plumbing in both transports, not native live-buffer semantics.

mod support;

use std::{fs, path::Path};

use corsa::{
    CorsaError,
    api::{ApiClient, ApiMode, ApiSpawnConfig, ProjectSession, UpdateSnapshotParams},
    runtime::block_on,
};
use serde_json::{Value, json};
use tempfile::TempDir;

const MODES: [ApiMode; 2] = [ApiMode::SyncMsgpackStdio, ApiMode::AsyncJsonRpcStdio];
const CONFIG: &str = "/workspace/app/tsconfig.json";
const FILE: &str = "/workspace/src/index.ts";

fn config(mode: ApiMode, log: &Path) -> ApiSpawnConfig {
    support::api_config(mode)
        .with_env("CORSA_MOCK_DIALECT", "derived-snapshots")
        .with_env("CORSA_MOCK_PARAMS_DIR", log.display().to_string())
}

fn sent(log: &Path, method: &str) -> Vec<Value> {
    fs::read_to_string(log.join(format!("{method}.jsonl")))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

#[test]
fn fork_requires_an_initialized_derived_runtime_in_both_transports() {
    block_on(async {
        for mode in MODES {
            let client = ApiClient::spawn(support::api_config(mode)).await.unwrap();
            assert!(matches!(
                client.fork_snapshot_lineage(),
                Err(CorsaError::Unsupported(_))
            ));
            client.initialize().await.unwrap();
            assert!(matches!(
                client.fork_snapshot_lineage(),
                Err(CorsaError::Unsupported(_))
            ));
            client.close().await.unwrap();
        }
    });
}

#[test]
fn public_fork_keeps_old_leases_and_uses_one_handshake_in_both_transports() {
    block_on(async {
        for mode in MODES {
            let log = TempDir::new().unwrap();
            let root = ApiClient::spawn(config(mode, log.path())).await.unwrap();
            root.initialize().await.unwrap();
            let old_client = root.fork_snapshot_lineage().unwrap();
            let old = ProjectSession::open(old_client.clone(), CONFIG, None)
                .await
                .unwrap();
            let lease = old.snapshot_lease();
            let project = old.project().clone();
            let first_handle = json!(lease.handle.as_str().parse::<u64>().unwrap());
            let fork = old_client.fork_snapshot_lineage().unwrap();
            let mut current = ProjectSession::open(fork.clone(), CONFIG, None)
                .await
                .unwrap();
            let fork_handle = json!(current.snapshot().handle.as_str().parse::<u64>().unwrap());
            let clone = fork.clone();
            let updated = clone
                .update_snapshot(UpdateSnapshotParams::default())
                .await
                .unwrap();
            assert_eq!(current.project(), &project);
            assert_eq!(updated.projects, lease.projects);
            assert_eq!(sent(log.path(), "initialize").len(), 1, "{mode:?}");
            assert_eq!(
                sent(log.path(), "createSnapshot"),
                vec![json!({"openProjects":[CONFIG],"ensurePrograms":true}); 2],
                "{mode:?}"
            );
            assert_eq!(
                sent(log.path(), "updateSnapshot")[0]["snapshot"],
                fork_handle
            );
            drop((old, old_client));
            root.drain_snapshot_releases().await.unwrap();
            assert!(
                sent(log.path(), "release")
                    .iter()
                    .all(|request| request["snapshot"] != first_handle)
            );
            let before = root
                .get_type_at_position(lease.handle.clone(), project.id.clone(), FILE, 0)
                .await
                .unwrap();
            assert!(before.is_some());
            current.refresh(None).await.unwrap();
            assert_eq!(
                root.get_type_at_position(lease.handle.clone(), project.id.clone(), FILE, 0)
                    .await
                    .unwrap(),
                before,
                "old snapshot remains queryable after the fork advances: {mode:?}"
            );
            drop(lease);
            root.drain_snapshot_releases().await.unwrap();
            assert_eq!(
                sent(log.path(), "release")
                    .iter()
                    .filter(|request| request["snapshot"] == first_handle)
                    .count(),
                1,
                "last old lease releases exactly once: {mode:?}"
            );
            assert!(
                current
                    .get_type_at_position(FILE, 0)
                    .await
                    .unwrap()
                    .is_some()
            );
            drop((updated, clone, current, fork));
            root.drain_snapshot_releases().await.unwrap();
            // Explicit close is connection-wide and is only called after all
            // sessions and leases above have been retired.
            root.close().await.unwrap();
            let releases = sent(log.path(), "release");
            assert_eq!(releases.len(), 4, "all four snapshots released: {mode:?}");
        }
    });
}
