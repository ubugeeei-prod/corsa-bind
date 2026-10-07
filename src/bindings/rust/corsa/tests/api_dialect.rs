//! Wire-level tests for the TypeScript 7.1 "derived snapshots" dialect.
//!
//! These run against the mock's stateful emulation of that dialect, so they
//! need no Corsa build. The emulator rejects what the real runtime rejects, and
//! records every request, which lets each case assert both what the caller sees
//! and what actually went over the wire. `real_corsa_dialect.rs` holds the same
//! promises against a real runtime.

mod support;

use std::{collections::BTreeMap, fs, path::Path};

use corsa::{
    CorsaError,
    api::{
        ApiClient, ApiDialect, ApiMode, ApiSpawnConfig, DocumentIdentifier, FileChangeSummary,
        FileChanges, ManagedSnapshot, ProjectHandle, UpdateSnapshotParams,
    },
    runtime::{block_on, spawn},
};
use serde_json::{Value, json};
use tempfile::TempDir;

const MODES: [ApiMode; 2] = [ApiMode::SyncMsgpackStdio, ApiMode::AsyncJsonRpcStdio];
const APP: &str = "/workspace/app/tsconfig.json";
const LIB: &str = "/workspace/lib/tsconfig.json";
const FILE: &str = "/workspace/src/index.ts";
/// Offset the emulator resolves to a checker-owned symbol.
const CHECKER_OWNED: u32 = 1000;

/// A mock speaking the derived-snapshots dialect, with its request log.
struct Runtime {
    client: ApiClient,
    log: TempDir,
}

impl Runtime {
    async fn spawn(mode: ApiMode) -> Self {
        let log = tempfile::tempdir().unwrap();
        let client = ApiClient::spawn(config(mode, log.path())).await.unwrap();
        Self { client, log }
    }

    /// Params of every request sent for `method`, in order.
    fn sent(&self, method: &str) -> Vec<Value> {
        fs::read_to_string(self.log.path().join(format!("{method}.jsonl")))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }
}

fn config(mode: ApiMode, log: &Path) -> ApiSpawnConfig {
    support::api_config(mode)
        .with_env("CORSA_MOCK_DIALECT", "derived-snapshots")
        .with_env("CORSA_MOCK_PARAMS_DIR", log.display().to_string())
}

fn open(config: &str) -> UpdateSnapshotParams {
    UpdateSnapshotParams {
        open_project: Some(config.into()),
        file_changes: None,
        overlay_changes: None,
    }
}

fn changed(file: &str) -> UpdateSnapshotParams {
    UpdateSnapshotParams {
        open_project: None,
        file_changes: Some(FileChanges::Summary(FileChangeSummary {
            changed: vec![DocumentIdentifier::from(file)],
            created: Vec::new(),
            deleted: Vec::new(),
        })),
        overlay_changes: None,
    }
}

fn config_files(snapshot: &ManagedSnapshot) -> Vec<&str> {
    snapshot
        .projects
        .iter()
        .map(|project| project.config_file_name.as_str())
        .collect()
}

#[test]
fn handshake_names_the_dialect_behind_one_stable_response() {
    block_on(async {
        for mode in MODES {
            let session = ApiClient::spawn(support::api_config(mode)).await.unwrap();
            assert_eq!(session.dialect(), None, "unknown before the handshake");
            session.initialize().await.unwrap();
            assert_eq!(session.dialect(), Some(ApiDialect::SessionSnapshots));
            session.close().await.unwrap();

            let runtime = Runtime::spawn(mode).await;
            let initialize = runtime.client.initialize().await.unwrap();
            assert_eq!(runtime.client.dialect(), Some(ApiDialect::DerivedSnapshots));
            assert!(initialize.use_case_sensitive_file_names, "{mode:?}");
            runtime.client.close().await.unwrap();
        }
    });
}

#[test]
fn updates_derive_from_the_previous_snapshot_and_report_every_project() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let client = &runtime.client;

            let opened = client.update_snapshot(open(APP)).await.unwrap();
            assert_eq!(config_files(&opened), [APP], "{mode:?}");
            // The caller is done with the first snapshot; the next update
            // still has to build on it.
            drop(opened);
            let edited = client.update_snapshot(changed(FILE)).await.unwrap();
            assert_eq!(config_files(&edited), [APP], "{mode:?}");
            assert!(edited.changes.is_some(), "{mode:?}");
            let widened = client.update_snapshot(open(LIB)).await.unwrap();
            assert_eq!(config_files(&widened), [APP, LIB], "{mode:?}");

            assert_eq!(
                runtime.sent("createSnapshot"),
                [json!({ "openProjects": [APP], "ensurePrograms": true })],
                "{mode:?}"
            );
            assert_eq!(
                runtime.sent("updateSnapshot"),
                [
                    json!({
                        "snapshot": 1,
                        "changes": {
                            "fileNotifications": { "changed": [FILE] },
                            "ensurePrograms": true,
                        },
                    }),
                    json!({
                        "snapshot": 2,
                        "changes": { "openProjects": [LIB], "ensurePrograms": true },
                    }),
                ],
                "{mode:?}"
            );

            drop((edited, widened));
            client.close().await.unwrap();
            assert_eq!(
                released(&runtime),
                BTreeMap::from([(1, 1), (2, 1), (3, 1)]),
                "every snapshot is released exactly once ({mode:?})"
            );
        }
    });
}

#[test]
fn releasing_the_latest_snapshot_leaves_it_in_place_as_the_next_base() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let client = &runtime.client;

            let opened = client.update_snapshot(open(APP)).await.unwrap();
            opened.release().await.unwrap();
            opened.release().await.unwrap();
            assert!(runtime.sent("release").is_empty(), "{mode:?}");

            let edited = client.update_snapshot(changed(FILE)).await.unwrap();
            assert_eq!(config_files(&edited), [APP], "{mode:?}");
            // An older snapshot nothing builds on is released right away.
            let superseded = edited;
            let latest = client.update_snapshot(changed(FILE)).await.unwrap();
            superseded.release().await.unwrap();
            assert_eq!(
                released(&runtime).get(&2),
                Some(&1),
                "an explicit release of a superseded snapshot is immediate ({mode:?})"
            );

            drop(latest);
            client.close().await.unwrap();
            assert_eq!(
                released(&runtime),
                BTreeMap::from([(1, 1), (2, 1), (3, 1)]),
                "{mode:?}"
            );
        }
    });
}

#[test]
fn a_second_raw_release_cannot_take_the_next_base_away() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let client = &runtime.client;
            let opened = client.update_snapshot(open(APP)).await.unwrap();
            let handle = opened.handle.clone();
            // Bindings release through the snapshot first and fall back to the
            // raw endpoint for handles they no longer track, so releasing the
            // same handle twice ends up here.
            opened.release().await.unwrap();
            let error = client
                .raw_json_request(
                    "release",
                    json!({ "handle": handle.as_str(), "snapshot": handle.as_str() }),
                )
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("snapshot 1 not found"),
                "{mode:?}: {error}"
            );
            assert!(runtime.sent("release").is_empty(), "{mode:?}");

            let edited = client.update_snapshot(changed(FILE)).await.unwrap();
            assert_eq!(config_files(&edited), [APP], "{mode:?}");

            drop(edited);
            client.close().await.unwrap();
        }
    });
}

#[test]
fn concurrent_updates_build_on_each_other() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let first = {
                let client = runtime.client.clone();
                spawn(async move { client.update_snapshot(open(APP)).await.unwrap() })
            };
            let second = {
                let client = runtime.client.clone();
                spawn(async move { client.update_snapshot(open(LIB)).await.unwrap() })
            };
            let snapshots = [first.join().unwrap(), second.join().unwrap()];

            let mut project_counts = snapshots
                .iter()
                .map(|snapshot| snapshot.projects.len())
                .collect::<Vec<_>>();
            project_counts.sort_unstable();
            assert_eq!(
                project_counts,
                [1, 2],
                "whichever update ran second saw the first one's project ({mode:?})"
            );
            assert_eq!(runtime.sent("createSnapshot").len(), 1, "{mode:?}");
            assert_eq!(
                runtime.sent("updateSnapshot")[0]["snapshot"],
                json!(1),
                "{mode:?}"
            );

            drop(snapshots);
            runtime.client.close().await.unwrap();
        }
    });
}

#[test]
fn symbols_are_opaque_handles_that_encode_back_to_wire_references() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let client = &runtime.client;
            let snapshot = client.update_snapshot(open(APP)).await.unwrap();
            let project = snapshot.projects[0].id.clone();

            // A file-owned symbol, then a type that only mentions it.
            let value = client
                .get_symbol_at_position(snapshot.handle.clone(), project.clone(), FILE, 0)
                .await
                .unwrap()
                .unwrap();
            let value_type = type_at(client, &snapshot, &project, 0).await;
            assert_eq!(value_type.symbol.as_ref(), Some(&value.id), "{mode:?}");
            let members = client
                .get_members_of_symbol_in_project(
                    snapshot.handle.clone(),
                    project.clone(),
                    value.id.clone(),
                )
                .await
                .unwrap();
            assert_eq!(members[0].name, "greet", "{mode:?}");
            assert_eq!(
                runtime.sent("getMembersOfSymbol")[0]["symbol"]["kind"],
                json!(0),
                "{mode:?}"
            );

            // A checker-owned symbol a type only mentions is not usable until
            // the runtime has handed it out, exactly as on TypeScript 7.0.
            let promise_type = type_at(client, &snapshot, &project, CHECKER_OWNED).await;
            let promise = promise_type.symbol.clone().unwrap();
            let premature = client
                .get_type_of_symbol(snapshot.handle.clone(), project.clone(), promise.clone())
                .await
                .unwrap_err();
            assert!(
                ApiClient::is_stale_handle_error(&premature),
                "{mode:?}: {premature}"
            );
            let resolved = client
                .get_symbol_of_type_in_project(
                    snapshot.handle.clone(),
                    project.clone(),
                    promise_type.id,
                )
                .await
                .unwrap()
                .unwrap();
            assert_eq!(resolved.name, "Promise", "{mode:?}");
            assert_eq!(resolved.id, promise, "one symbol, one handle ({mode:?})");
            client
                .get_type_of_symbol(snapshot.handle.clone(), project.clone(), promise.clone())
                .await
                .unwrap()
                .unwrap();

            // Signature parameters follow the same rule, and keep their order.
            let signatures = client
                .get_signatures_of_type(
                    snapshot.handle.clone(),
                    project.clone(),
                    value_type.id.clone(),
                    0,
                )
                .await
                .unwrap();
            let parameters = client
                .get_parameters_of_signature(
                    snapshot.handle.clone(),
                    project.clone(),
                    signatures[0].id.clone(),
                )
                .await
                .unwrap();
            assert_eq!(
                signatures[0].parameters,
                parameters
                    .iter()
                    .map(|parameter| parameter.id.clone())
                    .collect::<Vec<_>>(),
                "{mode:?}"
            );
            assert!(signatures[0].this_parameter.is_some(), "{mode:?}");
            let parameter_types = client
                .get_types_of_symbols(
                    snapshot.handle.clone(),
                    project.clone(),
                    signatures[0].parameters.clone(),
                )
                .await
                .unwrap();
            assert_eq!(
                parameter_types
                    .iter()
                    .map(|found| found.as_ref().unwrap().texts[0].as_str())
                    .collect::<Vec<_>>(),
                ["parameter-21", "parameter-20"],
                "{mode:?}"
            );
            assert_eq!(
                runtime.sent("getTypesOfSymbols")[0]["symbols"],
                json!([
                    { "kind": 1, "snapshot": 1, "project": project.as_str(), "id": 21 },
                    { "kind": 1, "snapshot": 1, "project": project.as_str(), "id": 20 },
                ]),
                "{mode:?}"
            );

            // Nothing above was resolved behind the caller's back.
            assert_eq!(runtime.sent("getSymbolOfType").len(), 1, "{mode:?}");
            assert_eq!(
                runtime.sent("getParametersOfSignature").len(),
                1,
                "{mode:?}"
            );
            assert!(runtime.sent("batchRequests").is_empty(), "{mode:?}");

            // A checker-owned symbol belongs to the snapshot that registered
            // it, and using it elsewhere reads as a stale handle.
            let next = client.update_snapshot(changed(FILE)).await.unwrap();
            let error = client
                .get_type_of_symbol(next.handle.clone(), project.clone(), promise)
                .await
                .unwrap_err();
            assert!(
                ApiClient::is_stale_handle_error(&error),
                "{mode:?}: {error}"
            );
            // A file-owned one keeps working for as long as its file does.
            client
                .get_type_of_symbol(next.handle.clone(), project.clone(), value.id)
                .await
                .unwrap()
                .unwrap();

            drop((snapshot, next));
            client.close().await.unwrap();
        }
    });
}

#[test]
fn mention_of_a_file_never_seen_in_full_is_a_stale_handle_until_it_is() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let client = &runtime.client;
            let snapshot = client.update_snapshot(open(APP)).await.unwrap();
            let project = snapshot.projects[0].id.clone();

            let value_type = type_at(client, &snapshot, &project, 0).await;
            let mentioned = value_type.symbol.clone().unwrap();
            let error = client
                .get_type_of_symbol(snapshot.handle.clone(), project.clone(), mentioned.clone())
                .await
                .unwrap_err();
            assert!(
                ApiClient::is_stale_handle_error(&error),
                "{mode:?}: {error}"
            );
            assert!(
                runtime.sent("getTypeOfSymbol").is_empty(),
                "the client knows without asking ({mode:?})"
            );

            let resolved = client
                .get_symbol_of_type_in_project(
                    snapshot.handle.clone(),
                    project.clone(),
                    value_type.id,
                )
                .await
                .unwrap()
                .unwrap();
            assert_eq!(resolved.id, mentioned, "{mode:?}");
            client
                .get_type_of_symbol(snapshot.handle.clone(), project.clone(), mentioned)
                .await
                .unwrap()
                .unwrap();

            drop(snapshot);
            client.close().await.unwrap();
        }
    });
}

#[test]
fn raw_requests_get_the_same_symbol_handles_as_typed_ones() {
    block_on(async {
        for mode in MODES {
            let runtime = Runtime::spawn(mode).await;
            let client = &runtime.client;
            let snapshot = client.update_snapshot(open(APP)).await.unwrap();
            let project = snapshot.projects[0].id.clone();
            let scope =
                json!({ "snapshot": snapshot.handle.as_str(), "project": project.as_str() });
            let with = |extra: Value| {
                let mut params = scope.clone();
                params
                    .as_object_mut()
                    .unwrap()
                    .extend(extra.as_object().unwrap().clone());
                params
            };

            let typed = client
                .get_symbol_at_position(snapshot.handle.clone(), project.clone(), FILE, 0)
                .await
                .unwrap()
                .unwrap();
            let raw = client
                .raw_json_request(
                    "getSymbolAtPosition",
                    with(json!({ "file": FILE, "position": 0 })),
                )
                .await
                .unwrap();
            assert_eq!(raw["id"], json!(typed.id.as_str()), "{mode:?}");
            assert_eq!(raw.get("reference"), None, "{mode:?}");
            // Mentions the typed API does not expose keep upstream's shape.
            assert_eq!(raw["parent"], json!({ "id": 6, "file": "142" }), "{mode:?}");

            let well_known = client
                .raw_json_request("getWellKnownSymbols", scope.clone())
                .await
                .unwrap();
            let batch = client
                .raw_json_request(
                    "batchRequests",
                    json!({
                        "requests": [
                            {
                                "method": "getTypeOfSymbol",
                                "params": with(json!({ "symbol": well_known["undefined"] })),
                            },
                            {
                                "method": "getTypeAtPosition",
                                "params": with(json!({ "file": FILE, "position": CHECKER_OWNED })),
                            },
                        ],
                    }),
                )
                .await
                .unwrap();
            assert_eq!(batch["responses"][0].get("error"), None, "{mode:?}");
            assert_eq!(
                runtime.sent("batchRequests")[0]["requests"][0]["params"]["symbol"],
                json!({ "kind": 1, "snapshot": 1, "project": project.as_str(), "id": 2 }),
                "{mode:?}"
            );
            let mentioned = batch["responses"][1]["result"]["symbol"]
                .as_str()
                .unwrap_or_else(|| panic!("a handle in {batch} ({mode:?})"));
            let resolved = client
                .raw_json_request(
                    "getSymbolOfType",
                    with(json!({ "objectId": batch["responses"][1]["result"]["id"] })),
                )
                .await
                .unwrap();
            assert_eq!(resolved["id"], json!(mentioned), "{mode:?}");
            client
                .raw_json_request("getTypeOfSymbol", with(json!({ "symbol": mentioned })))
                .await
                .unwrap();

            drop(snapshot);
            client.close().await.unwrap();
        }
    });
}

#[test]
fn filesystem_callbacks_answer_in_the_runtime_dialect() {
    block_on(async {
        for mode in MODES {
            let log = tempfile::tempdir().unwrap();
            let client = ApiClient::spawn(
                config(mode, log.path())
                    .with_filesystem(support::virtual_fs(&[("/virtual/tsconfig.json", "{}")])),
            )
            .await
            .unwrap();

            let parsed = client
                .parse_config_file("/virtual/tsconfig.json")
                .await
                .unwrap();

            assert_eq!(parsed.options["virtual"], json!(true), "{mode:?}");
            client.close().await.unwrap();
        }
    });
}

#[test]
fn raw_update_snapshot_is_not_reshaped() {
    block_on(async {
        let runtime = Runtime::spawn(ApiMode::AsyncJsonRpcStdio).await;

        // The raw endpoint is upstream's shape by contract, so a 7.0-shaped
        // request fails the way the real runtime fails it.
        let error = runtime
            .client
            .raw_json_request("updateSnapshot", json!({ "openProjects": [APP] }))
            .await
            .unwrap_err();

        assert!(
            matches!(&error, CorsaError::Rpc(rpc) if rpc.message.contains("snapshot 0 not found")),
            "{error}"
        );
        runtime.client.close().await.unwrap();
    });
}

async fn type_at(
    client: &ApiClient,
    snapshot: &ManagedSnapshot,
    project: &ProjectHandle,
    position: u32,
) -> corsa::api::TypeResponse {
    client
        .get_type_at_position(snapshot.handle.clone(), project.clone(), FILE, position)
        .await
        .unwrap()
        .unwrap()
}

/// How many times each snapshot handle was released.
fn released(runtime: &Runtime) -> BTreeMap<u64, usize> {
    let mut counts = BTreeMap::new();
    for params in runtime.sent("release") {
        *counts
            .entry(params["snapshot"].as_u64().unwrap())
            .or_default() += 1;
    }
    counts
}
