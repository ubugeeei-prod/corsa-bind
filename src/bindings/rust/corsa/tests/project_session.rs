mod support;

use corsa::{
    api::{ApiMode, OverlayChanges, OverlayUpdate, ProjectSession, TypeProbeOptions},
    fast::CompactString,
    runtime::block_on,
};

#[test]
fn project_session_reuses_snapshot_and_project_handles() {
    block_on(async {
        let mut session = ProjectSession::spawn(
            support::api_config(ApiMode::AsyncJsonRpcStdio),
            "/workspace/tsconfig.json",
            Some("/workspace/src/index.ts".into()),
        )
        .await
        .unwrap();

        let project_id = session.project().id.clone();
        let symbol = session
            .get_symbol_at_position("/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(symbol.name, "value");

        let type_response = session
            .get_type_of_symbol(symbol.id)
            .await
            .unwrap()
            .unwrap();
        let rendered = session
            .type_to_string(type_response.id, None, None)
            .await
            .unwrap();
        assert_eq!(rendered, "type:string");

        session.refresh(None).await.unwrap();
        assert_eq!(session.project().id, project_id);
        assert!(
            session
                .get_type_at_position("/workspace/src/index.ts", 1)
                .await
                .unwrap()
                .is_some()
        );

        session.close().await.unwrap();
    });
}

#[test]
fn project_session_builds_checker_probe_views() {
    block_on(async {
        let session = ProjectSession::spawn(
            support::api_config(ApiMode::AsyncJsonRpcStdio),
            "/workspace/tsconfig.json",
            Some("/workspace/src/index.ts".into()),
        )
        .await
        .unwrap();

        let probe = session
            .probe_type_at_position(
                "/workspace/src/index.ts",
                1,
                TypeProbeOptions {
                    load_property_types: true,
                    load_signatures: true,
                },
            )
            .await
            .unwrap()
            .unwrap();

        assert_eq!(probe.type_texts, vec![CompactString::from("type-text")]);
        assert_eq!(probe.property_names, vec![CompactString::from("value")]);
        assert_eq!(
            probe.property_types,
            vec![vec![CompactString::from("type-text")]]
        );
        assert_eq!(
            probe.call_signatures,
            vec![vec![vec![CompactString::from("type-text")]]]
        );
        assert_eq!(
            probe.return_types,
            vec![vec![CompactString::from("type-text")]]
        );

        session.close().await.unwrap();
    });
}

#[test]
fn project_session_supports_capabilities_diagnostics_and_editor_helpers() {
    block_on(async {
        let mut session = ProjectSession::spawn(
            support::api_config(ApiMode::AsyncJsonRpcStdio),
            "/workspace/tsconfig.json",
            Some("/workspace/src/index.ts".into()),
        )
        .await
        .unwrap();

        let capabilities = session.describe_capabilities().await.unwrap();
        assert!(capabilities.editor.completion);
        assert!(capabilities.lsp.available);
        assert!(!capabilities.lsp.editor.completion);

        session
            .refresh_with_overlay_changes(
                None,
                Some(OverlayChanges {
                    upsert: vec![OverlayUpdate {
                        document: "/workspace/src/virtual.ts".into(),
                        text: "export const value = 1;".into(),
                        version: Some(2),
                        language_id: Some("typescript".into()),
                    }],
                    delete: Vec::new(),
                }),
            )
            .await
            .unwrap();

        let project_diagnostics = session.get_diagnostics_for_project().await.unwrap();
        assert_eq!(project_diagnostics.files.len(), 1);
        let file_diagnostics = session
            .get_diagnostics_for_file("/workspace/src/index.ts")
            .await
            .unwrap();
        assert_eq!(file_diagnostics.semantic.len(), 1);
        let snapshot_diagnostics = session.get_diagnostics_for_snapshot().await.unwrap();
        assert_eq!(snapshot_diagnostics.projects.len(), 1);

        let hover = session
            .get_hover_at_position("/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .unwrap();
        assert!(
            serde_json::to_value(&hover).unwrap()["contents"]["value"]
                .as_str()
                .unwrap()
                .contains("value")
        );
        let definition = session
            .get_definition_at_position("/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(&definition)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            session
                .get_references_at_position("/workspace/src/index.ts", 1)
                .await
                .unwrap()
                .len(),
            2
        );
        let rename = session
            .get_rename_at_position("/workspace/src/index.ts", 1, "renamedValue")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(&rename).unwrap()["changes"]["file:///workspace/src/index.ts"][0]
                ["newText"],
            serde_json::json!("renamedValue")
        );
        let completion = session
            .get_completion_at_position("/workspace/src/index.ts", 1, None)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(&completion).unwrap()["items"][0]["label"],
            serde_json::json!("value")
        );

        session.close().await.unwrap();
    });
}

#[cfg(unix)]
mod snapshot_leases {
    use std::{
        io::{BufReader, BufWriter},
        os::unix::net::UnixListener,
        sync::mpsc,
        thread,
        time::Duration,
    };

    use corsa::{
        api::{ApiClient, ProjectSession},
        jsonrpc::{RawMessage, RequestId, read_frame, write_frame},
        runtime::block_on,
    };
    use serde_json::{Value, json};

    const CONFIG: &str = "/workspace/tsconfig.json";
    const FILE: &str = "/workspace/src/index.ts";
    const OLD: &str = "n0000000000000001";
    const NEW: &str = "n0000000000000002";
    const BOUND: Duration = Duration::from_secs(10);

    struct Server {
        _directory: tempfile::TempDir,
        client: ApiClient,
        entered: mpsc::Receiver<()>,
        worker: thread::JoinHandle<Vec<String>>,
    }

    impl Server {
        fn start(hold_old_diagnostics: bool) -> Self {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("lease.sock");
            let listener = UnixListener::bind(&path).unwrap();
            let (entered, receiver) = mpsc::sync_channel(1);
            let worker = thread::spawn(move || {
                let (stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(BOUND)).unwrap();
                stream.set_write_timeout(Some(BOUND)).unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut writer = BufWriter::new(stream);
                let mut generation = 0;
                let mut pending: Option<RequestId> = None;
                let mut released = Vec::new();
                loop {
                    let body = match read_frame(&mut reader) {
                        Ok(body) => body,
                        Err(corsa::CorsaError::Closed(_)) => return released,
                        Err(error) => panic!("lease server transport: {error}"),
                    };
                    let request: RawMessage = serde_json::from_slice(&body).unwrap();
                    let id = request.id.unwrap();
                    let params = request.params.unwrap_or(Value::Null);
                    let result = match request.method.as_deref().unwrap() {
                        "initialize" => json!({
                            "useCaseSensitiveFileNames": true,
                            "currentDirectory": "/workspace",
                        }),
                        "updateSnapshot" => {
                            generation += 1;
                            json!({
                                "snapshot": if generation == 1 { OLD } else { NEW },
                                "projects": [project()],
                                "changes": {"changedProjects": {}, "removedProjects": []},
                            })
                        }
                        "getDefaultProjectForFile" => project(),
                        "getDiagnosticsForFile" => {
                            assert_eq!(params["file"], FILE);
                            assert_eq!(params["project"], "p./workspace/tsconfig.json");
                            assert!(params["snapshot"] == OLD || params["snapshot"] == NEW);
                            let old = params["snapshot"] == OLD;
                            let handle = if old { OLD } else { NEW };
                            assert!(!released.iter().any(|released| released == handle));
                            if old && hold_old_diagnostics {
                                assert!(pending.replace(id).is_none());
                                entered.send(()).unwrap();
                                continue;
                            }
                            json!({"file": FILE})
                        }
                        "release" => {
                            let handle = params["handle"].as_str().unwrap().to_owned();
                            assert!(handle != OLD || pending.is_none());
                            assert!(!released.contains(&handle));
                            released.push(handle);
                            Value::Null
                        }
                        "test/finishOldDiagnostics" => {
                            let old_id = pending.take().unwrap();
                            respond(&mut writer, old_id, json!({"file": FILE}));
                            Value::Null
                        }
                        method => panic!("unexpected lease test method: {method}"),
                    };
                    respond(&mut writer, id, result);
                    if released.len() == if hold_old_diagnostics { 2 } else { 1 } {
                        return released;
                    }
                }
            });
            let client = block_on(ApiClient::connect_pipe(path)).unwrap();
            Self {
                _directory: directory,
                client,
                entered: receiver,
                worker,
            }
        }

        fn open(&self) -> ProjectSession {
            block_on(ProjectSession::open(
                self.client.clone(),
                CONFIG,
                Some(FILE.into()),
            ))
            .unwrap()
        }

        fn finish(self) -> Vec<String> {
            block_on(self.client.close()).unwrap();
            self.worker.join().unwrap()
        }
    }

    fn project() -> Value {
        json!({
            "id": "p./workspace/tsconfig.json",
            "configFileName": CONFIG,
            "compilerOptions": {"strict": true},
            "rootFiles": [FILE],
        })
    }

    fn respond(writer: &mut impl std::io::Write, id: RequestId, result: Value) {
        let body = serde_json::to_vec(&RawMessage::response(id, result)).unwrap();
        write_frame(writer, &body).unwrap();
    }

    #[test]
    fn detached_snapshot_survives_session_drop_until_last_lease() {
        let server = Server::start(false);
        let session = server.open();
        let project = session.project_handle();
        let lease = session.snapshot_lease();
        let duplicate = session.snapshot_lease();
        assert!(std::sync::Arc::ptr_eq(&lease, &duplicate));
        let weak = std::sync::Arc::downgrade(&lease);
        drop(session);
        drop(duplicate);
        let diagnostics = block_on(server.client.get_diagnostics_for_file(
            lease.handle.clone(),
            project,
            FILE,
        ))
        .unwrap();
        assert_eq!(
            serde_json::to_value(diagnostics).unwrap(),
            json!({"file": FILE})
        );
        assert_eq!(lease.handle.as_str(), OLD);
        drop(lease);
        assert!(weak.upgrade().is_none());
        assert_eq!(server.finish(), vec![OLD]);
    }

    #[test]
    fn refresh_and_foreground_query_finish_while_old_read_owns_its_lease() {
        let server = Server::start(true);
        let mut session = server.open();
        let lease = session.snapshot_lease();
        let weak = std::sync::Arc::downgrade(&lease);
        let old_project = session.project_handle();
        let client = server.client.clone();
        let worker = thread::spawn(move || {
            let diagnostics =
                block_on(client.get_diagnostics_for_file(lease.handle.clone(), old_project, FILE))
                    .unwrap();
            assert_eq!(lease.handle.as_str(), OLD);
            serde_json::to_value(diagnostics).unwrap()
        });
        server.entered.recv_timeout(BOUND).unwrap();
        block_on(session.refresh(None)).unwrap();
        assert_eq!(session.snapshot().handle.as_str(), NEW);
        assert_eq!(weak.upgrade().unwrap().handle.as_str(), OLD);
        let foreground = block_on(session.get_diagnostics_for_file(FILE)).unwrap();
        assert_eq!(
            serde_json::to_value(foreground).unwrap(),
            json!({"file": FILE})
        );
        // Retiring the caller/session must not release an old worker's snapshot.
        drop(session);
        assert!(weak.upgrade().is_some());
        block_on(
            server
                .client
                .raw_json_request("test/finishOldDiagnostics", Value::Null),
        )
        .unwrap();
        assert_eq!(worker.join().unwrap(), json!({"file": FILE}));
        assert!(weak.upgrade().is_none());
        let mut released = server.finish();
        released.sort();
        assert_eq!(released, vec![OLD, NEW]);
    }

    #[test]
    fn explicit_release_is_not_extended_by_an_owned_lease() {
        let server = Server::start(false);
        let session = server.open();
        let lease = session.snapshot_lease();
        block_on(lease.release()).unwrap();
        drop(session);
        drop(lease);
        assert_eq!(server.finish(), vec![OLD]);
    }
}
