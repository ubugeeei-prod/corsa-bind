//! Framed ownership controls; these do not model a native LSP's live buffers.

use std::{
    collections::BTreeMap,
    future::Future,
    io::BufReader,
    net::Shutdown,
    os::unix::net::UnixStream,
    sync::{Arc, Mutex},
    task::{Context, Poll, Waker},
    thread,
    time::Duration,
};

use serde_json::{Value, json};

use super::*;
use crate::{
    api::{ProjectSession, profiling::ApiProfiler},
    jsonrpc::{JsonRpcConnectionOptions, read_frame, write_frame},
};

const CONFIG: &str = "/workspace/tsconfig.json";
const FILE: &str = "/workspace/source.ts";
const DEADLINE: Duration = Duration::from_secs(5);

#[derive(Default)]
struct State {
    requests: Vec<Value>,
    snapshots: BTreeMap<u64, Vec<String>>,
    releases: BTreeMap<u64, usize>,
    next: u64,
    fail_create: bool,
    empty_create: bool,
}

fn project(config: &str) -> Value {
    json!({"id":config,"configFileName":config,"compilerOptions":{},"rootFiles":[FILE]})
}

impl State {
    fn reply(&mut self, request: &Value) -> Value {
        self.requests.push(request.clone());
        let params = &request["params"];
        let result = match request["method"].as_str().unwrap() {
            "initialize" => json!({"caseSensitivity":1,"currentDirectory":"/workspace"}),
            "createSnapshot" | "updateSnapshot" => {
                let create = request["method"] == "createSnapshot";
                if create && std::mem::take(&mut self.fail_create) {
                    return json!({"error":{"code":-32001,"message":"injected create failure"}});
                }
                let mut configs = if create {
                    Vec::new()
                } else {
                    self.snapshots
                        .get(&params["snapshot"].as_u64().unwrap())
                        .unwrap()
                        .clone()
                };
                let changes = if create { params } else { &params["changes"] };
                assert_eq!(changes["ensurePrograms"], true);
                for config in changes["openProjects"].as_array().into_iter().flatten() {
                    let config = config.as_str().unwrap().to_owned();
                    if !configs.contains(&config) {
                        configs.push(config);
                    }
                }
                if create && std::mem::take(&mut self.empty_create) {
                    configs.clear();
                }
                self.next += 1;
                let handle = self.next;
                self.snapshots.insert(handle, configs.clone());
                json!({"snapshot":handle,"projects":configs.iter().map(|p| project(p)).collect::<Vec<_>>()})
            }
            "getDefaultProjectForFile" => {
                let configs = self
                    .snapshots
                    .get(&params["snapshot"].as_u64().unwrap())
                    .unwrap();
                configs.first().map_or(Value::Null, |p| project(p))
            }
            "release" => {
                let handle = params["snapshot"].as_u64().unwrap();
                assert!(
                    self.snapshots.remove(&handle).is_some(),
                    "one release per live snapshot"
                );
                *self.releases.entry(handle).or_default() += 1;
                json!(true)
            }
            method => panic!("unexpected method {method}"),
        };
        json!({"result":result})
    }
}

struct Profiler;
impl ApiProfiler for Profiler {
    fn on_profile(&self, _: &super::super::profiling::ApiProfileEvent) {}
}

struct Harness {
    client: ApiClient,
    state: Arc<Mutex<State>>,
    socket: UnixStream,
    task: Option<thread::JoinHandle<()>>,
}

impl Harness {
    fn new() -> Self {
        let (socket, peer) = UnixStream::pair().unwrap();
        peer.set_read_timeout(Some(DEADLINE)).unwrap();
        let rpc = JsonRpcConnection::try_spawn_with_options(
            BufReader::new(socket.try_clone().unwrap()),
            socket,
            Default::default(),
            JsonRpcConnectionOptions::new().with_request_timeout(Some(DEADLINE)),
        )
        .unwrap();
        let driver = Arc::new(ClientDriver::JsonRpc {
            rpc,
            process: None,
            shutdown_timeout: DEADLINE,
        });
        let queue = Arc::new(SnapshotReleaseQueue::spawn(Arc::clone(&driver), None, 16).unwrap());
        let client = ApiClient {
            driver,
            initialized: Arc::new(SingleflightCell::default()),
            capabilities: Arc::new(SingleflightCell::default()),
            release_queue: queue,
            dialect: Arc::new(DialectCell::default()),
            symbols: Arc::new(SymbolIdentity::default()),
            lineage: Arc::new(SnapshotLineage::default()),
            runtime_capabilities: RuntimeCapabilities::default(),
            allow_unstable_upstream_calls: true,
            profiler: Some(Arc::new(Profiler)),
        };
        let socket = peer.try_clone().unwrap();
        let state = Arc::new(Mutex::new(State::default()));
        let shared = Arc::clone(&state);
        let task = thread::spawn(move || {
            let mut reader = BufReader::new(peer.try_clone().unwrap());
            let mut writer = peer;
            while let Ok(bytes) = read_frame(&mut reader) {
                let request: Value = serde_json::from_slice(&bytes).unwrap();
                let mut reply = shared.lock().unwrap().reply(&request);
                reply["jsonrpc"] = json!("2.0");
                reply["id"] = request["id"].clone();
                write_frame(&mut writer, &serde_json::to_vec(&reply).unwrap()).unwrap();
            }
        });
        Self {
            client,
            state,
            socket,
            task: Some(task),
        }
    }

    fn sent(&self, method: &str) -> Vec<Value> {
        self.state
            .lock()
            .unwrap()
            .requests
            .iter()
            .filter(|r| r["method"] == method)
            .map(|r| r["params"].clone())
            .collect()
    }

    fn finish(&mut self) {
        self.client.lineage.clear();
        corsa_runtime::block_on(self.client.drain_snapshot_releases()).unwrap();
        self.socket.shutdown(Shutdown::Both).unwrap();
        corsa_runtime::block_on(self.client.close()).unwrap();
        self.task.take().unwrap().join().unwrap();
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = self.socket.shutdown(Shutdown::Both);
        if let Some(task) = self.task.take() {
            let _ = task.join();
        }
    }
}

fn open() -> super::super::UpdateSnapshotParams {
    super::super::UpdateSnapshotParams {
        open_project: Some(CONFIG.into()),
        ..Default::default()
    }
}

#[test]
fn fork_is_local_rejects_uninitialized_and_legacy_and_shares_all_owners() {
    let mut runtime = Harness::new();
    assert!(matches!(
        runtime.client.fork_snapshot_lineage(),
        Err(CorsaError::Unsupported(_))
    ));
    runtime.client.dialect.set(ApiDialect::SessionSnapshots);
    assert!(matches!(
        runtime.client.fork_snapshot_lineage(),
        Err(CorsaError::Unsupported(_))
    ));
    runtime.client.dialect.set(ApiDialect::DerivedSnapshots);
    let fork = runtime.client.fork_snapshot_lineage().unwrap();
    assert!(Arc::ptr_eq(&runtime.client.driver, &fork.driver));
    assert!(Arc::ptr_eq(
        &runtime.client.release_queue,
        &fork.release_queue
    ));
    assert!(Arc::ptr_eq(&runtime.client.initialized, &fork.initialized));
    assert!(Arc::ptr_eq(
        &runtime.client.capabilities,
        &fork.capabilities
    ));
    assert!(Arc::ptr_eq(&runtime.client.dialect, &fork.dialect));
    assert!(Arc::ptr_eq(&runtime.client.symbols, &fork.symbols));
    assert!(Arc::ptr_eq(
        runtime.client.profiler.as_ref().unwrap(),
        fork.profiler.as_ref().unwrap()
    ));
    assert_eq!(
        runtime.client.allow_unstable_upstream_calls,
        fork.allow_unstable_upstream_calls
    );
    assert_eq!(
        runtime.client.runtime_capabilities,
        fork.runtime_capabilities
    );
    assert!(!Arc::ptr_eq(&runtime.client.lineage, &fork.lineage));
    assert!(Arc::ptr_eq(
        &runtime.client.lineage,
        &runtime.client.clone().lineage
    ));
    assert!(runtime.state.lock().unwrap().requests.is_empty());
    drop(fork);
    runtime.finish();
}

#[test]
fn clone_advances_parent_but_fork_starts_create_and_keeps_its_own_head() {
    let mut runtime = Harness::new();
    corsa_runtime::block_on(async {
        let first = runtime.client.update_snapshot(open()).await.unwrap();
        let clone = runtime.client.clone();
        let second = clone.update_snapshot(Default::default()).await.unwrap();
        let fork = runtime.client.fork_snapshot_lineage().unwrap();
        let third = fork.update_snapshot(open()).await.unwrap();
        let fourth = fork.update_snapshot(Default::default()).await.unwrap();
        let fifth = runtime
            .client
            .update_snapshot(Default::default())
            .await
            .unwrap();
        assert_eq!(runtime.sent("initialize").len(), 1);
        assert_eq!(
            runtime.sent("createSnapshot"),
            vec![json!({"openProjects":[CONFIG],"ensurePrograms":true}); 2]
        );
        let updates = runtime.sent("updateSnapshot");
        assert_eq!(
            updates
                .iter()
                .map(|p| p["snapshot"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            [1, 3, 2]
        );
        assert_eq!(fifth.projects, first.projects);
        drop((first, second, third, fourth, fifth, clone, fork));
    });
    runtime.finish();
    assert_eq!(
        runtime.state.lock().unwrap().releases,
        BTreeMap::from([(1, 1), (2, 1), (3, 1), (4, 1), (5, 1)])
    );
}

#[test]
fn old_lease_remains_queryable_after_original_session_drops_and_fork_advances() {
    let mut runtime = Harness::new();
    corsa_runtime::block_on(async {
        let old_client = runtime.client.fork_snapshot_lineage();
        assert!(old_client.is_err(), "explicit handshake is required");
        runtime.client.initialize().await.unwrap();
        let old_client = runtime.client.fork_snapshot_lineage().unwrap();
        let old = ProjectSession::open(old_client.clone(), CONFIG, None)
            .await
            .unwrap();
        let lease = old.snapshot_lease();
        let old_project = old.project().clone();
        let fork = old_client.fork_snapshot_lineage().unwrap();
        let current = ProjectSession::open(fork.clone(), CONFIG, None)
            .await
            .unwrap();
        drop((old, old_client));
        fork.drain_snapshot_releases().await.unwrap();
        assert!(!runtime.state.lock().unwrap().releases.contains_key(&1));
        assert_eq!(
            lease.get_default_project_for_file(FILE).await.unwrap(),
            Some(old_project.clone())
        );
        assert_eq!(current.project(), &old_project);
        drop(lease);
        fork.drain_snapshot_releases().await.unwrap();
        assert_eq!(runtime.state.lock().unwrap().releases.get(&1), Some(&1));
        assert_eq!(
            current
                .snapshot()
                .get_default_project_for_file(FILE)
                .await
                .unwrap(),
            Some(old_project)
        );
        drop((current, fork));
    });
    runtime.finish();
}

#[test]
fn failed_create_and_failed_project_resolution_do_not_advance_original_lineage() {
    let mut runtime = Harness::new();
    corsa_runtime::block_on(async {
        let old = runtime.client.update_snapshot(open()).await.unwrap();
        let fork = runtime.client.fork_snapshot_lineage().unwrap();
        runtime.state.lock().unwrap().fail_create = true;
        assert!(fork.update_snapshot(open()).await.is_err());
        let resumed = runtime
            .client
            .update_snapshot(Default::default())
            .await
            .unwrap();
        assert_eq!(runtime.sent("updateSnapshot")[0]["snapshot"], 1);
        runtime.state.lock().unwrap().empty_create = true;
        assert!(
            ProjectSession::open(fork.clone(), CONFIG, None)
                .await
                .is_err()
        );
        drop(fork);
        runtime.client.drain_snapshot_releases().await.unwrap();
        assert_eq!(runtime.state.lock().unwrap().releases.get(&3), Some(&1));
        let latest = runtime
            .client
            .update_snapshot(Default::default())
            .await
            .unwrap();
        assert_eq!(runtime.sent("updateSnapshot")[1]["snapshot"], 2);
        assert_eq!(
            old.get_default_project_for_file(FILE).await.unwrap(),
            old.projects.first().cloned()
        );
        drop((old, resumed, latest));
    });
    runtime.finish();
}

#[test]
fn forks_have_independent_gates_and_each_lineage_serializes_updates() {
    let mut runtime = Harness::new();
    corsa_runtime::block_on(runtime.client.initialize()).unwrap();
    let fork = runtime.client.fork_snapshot_lineage().unwrap();
    let first = corsa_runtime::block_on(fork.lineage.advance());
    let mut same = Box::pin(fork.lineage.advance());
    let mut other = Box::pin(runtime.client.lineage.advance());
    let mut context = Context::from_waker(Waker::noop());
    assert!(same.as_mut().poll(&mut context).is_pending());
    let Poll::Ready(parent) = other.as_mut().poll(&mut context) else {
        panic!("parent gate is independent");
    };
    drop(parent);
    drop(first);
    assert!(same.as_mut().poll(&mut context).is_ready());
    drop(same);
    drop(other);
    drop(fork);
    runtime.finish();
}

#[test]
fn canceling_a_fork_update_before_the_gate_leaves_both_heads_usable() {
    let mut runtime = Harness::new();
    corsa_runtime::block_on(async {
        let original = runtime.client.update_snapshot(open()).await.unwrap();
        let fork = runtime.client.fork_snapshot_lineage().unwrap();
        let permit = fork.lineage.advance().await;
        let mut pending = Box::pin(fork.update_snapshot(open()));
        let mut context = Context::from_waker(Waker::noop());
        assert!(pending.as_mut().poll(&mut context).is_pending());
        assert_eq!(runtime.sent("createSnapshot").len(), 1);
        drop(pending);
        drop(permit);
        let fresh = fork.update_snapshot(open()).await.unwrap();
        let resumed = runtime
            .client
            .update_snapshot(Default::default())
            .await
            .unwrap();
        assert_eq!(runtime.sent("updateSnapshot")[0]["snapshot"], 1);
        assert_eq!(fresh.projects, original.projects);
        assert_eq!(resumed.projects, original.projects);
        drop((original, fresh, resumed, fork));
    });
    runtime.finish();
}
