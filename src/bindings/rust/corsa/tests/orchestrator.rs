mod support;

use corsa::{
    api::{ApiClient, ApiMode, ApiProfile, UpdateSnapshotParams},
    observability::{CorsaEvent, CorsaObserver},
    orchestrator::{ApiOrchestrator, ApiOrchestratorConfig},
    runtime::block_on,
};
use serde_json::{Value, json};
use std::{
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::Duration,
};

#[derive(Default)]
struct EventCollector {
    events: Mutex<Vec<CorsaEvent>>,
}

impl CorsaObserver for EventCollector {
    fn on_event(&self, event: &CorsaEvent) {
        self.events.lock().unwrap().push(event.clone());
    }
}

fn run_async_test<F>(future: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    let handle = thread::Builder::new()
        .name("orchestrator-test".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || block_on(future))
        .unwrap();
    if let Err(panic) = handle.join() {
        std::panic::resume_unwind(panic);
    }
}

#[test]
fn orchestrator_caches_snapshots_and_results() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("async-cache", ApiMode::AsyncJsonRpcStdio);
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
            .await
            .unwrap();
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
            .await
            .unwrap();
        assert!(Arc::ptr_eq(&snapshot_a, &snapshot_b));

        let calls = Arc::new(AtomicUsize::new(0));
        let first = orchestrator
            .cached(&profile, "ping", Some(Duration::from_secs(30)), {
                let calls = calls.clone();
                move |client| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    client.raw_json_request("ping", Value::Null).await
                }
            })
            .await
            .unwrap();
        let second = orchestrator
            .cached(&profile, "ping", Some(Duration::from_secs(30)), {
                let calls = calls.clone();
                move |client| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    client.raw_json_request("ping", Value::Null).await
                }
            })
            .await
            .unwrap();
        assert_eq!(first, json!("pong"));
        assert_eq!(second, json!("pong"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn orchestrator_executes_parallel_batches() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("async-batch", ApiMode::AsyncJsonRpcStdio);
        let values = orchestrator
            .execute_all(&profile, 2, [1_u32, 2, 3, 4], |client, value| async move {
                let echoed = client
                    .raw_json_request("echo", json!({ "value": value }))
                    .await?;
                Ok::<_, corsa::CorsaError>(echoed["value"].as_u64().unwrap() as u32)
            })
            .await
            .unwrap();
        assert_eq!(values.as_slice(), &[1, 2, 3, 4]);
    });
}

#[test]
fn orchestrator_executes_batches_larger_than_work_queue_capacity() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::new(ApiOrchestratorConfig {
            work_queue_capacity: 1,
            ..ApiOrchestratorConfig::default()
        });
        let profile = support::api_profile("async-batch-backpressure", ApiMode::AsyncJsonRpcStdio);
        let values = orchestrator
            .execute_all(&profile, 2, 0_u32..8, |_, value| async move {
                Ok::<_, corsa::CorsaError>(value)
            })
            .await
            .unwrap();
        assert_eq!(values.as_slice(), &[0, 1, 2, 3, 4, 5, 6, 7]);
    });
}

#[test]
fn orchestrator_reports_batch_task_panics() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("async-batch-panic", ApiMode::AsyncJsonRpcStdio);
        let error = orchestrator
            .execute_all(&profile, 1, [1_u32], |_, _| async move {
                panic!("batch task exploded");
                #[allow(unreachable_code)]
                Ok::<_, corsa::CorsaError>(0_u32)
            })
            .await
            .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("orchestrator batch worker panicked: batch task exploded"),
            "{error}"
        );
    });
}

#[test]
fn orchestrator_skips_worker_start_for_empty_batches() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("async-empty-batch", ApiMode::AsyncJsonRpcStdio);
        let values = orchestrator
            .execute_all(
                &profile,
                4,
                std::iter::empty::<u32>(),
                |_, value| async move { Ok::<_, corsa::CorsaError>(value) },
            )
            .await
            .unwrap();
        assert!(values.is_empty());
        assert_eq!(orchestrator.stats().worker_count, 0);
    });
}

#[test]
fn orchestrator_recomputes_expired_cached_values() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("async-expiring-cache", ApiMode::AsyncJsonRpcStdio);
        let calls = Arc::new(AtomicUsize::new(0));

        let _: Value = orchestrator
            .cached(&profile, "expiring", Some(Duration::from_millis(5)), {
                let calls = calls.clone();
                move |client| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    client.raw_json_request("ping", Value::Null).await
                }
            })
            .await
            .unwrap();

        std::thread::sleep(Duration::from_millis(20));

        let _: Value = orchestrator
            .cached(&profile, "expiring", Some(Duration::from_millis(5)), {
                let calls = calls.clone();
                move |client| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    client.raw_json_request("ping", Value::Null).await
                }
            })
            .await
            .unwrap();

        assert_eq!(calls.load(Ordering::SeqCst), 2);
    });
}

#[test]
fn orchestrator_enforces_cache_limits() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::new(ApiOrchestratorConfig {
            max_workers_per_profile: 2,
            max_cached_snapshots: 1,
            max_cached_results: 1,
            work_queue_capacity: 2,
            observer: None,
        });
        let profile = support::api_profile("limited-cache", ApiMode::AsyncJsonRpcStdio);

        let snapshot_a = orchestrator
            .cached_snapshot(
                &profile,
                "workspace-a",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/a/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await
            .unwrap();
        let _snapshot_b = orchestrator
            .cached_snapshot(
                &profile,
                "workspace-b",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/b/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await
            .unwrap();
        let snapshot_a_again = orchestrator
            .cached_snapshot(
                &profile,
                "workspace-a",
                UpdateSnapshotParams {
                    open_project: Some("/workspace/a/tsconfig.json".into()),
                    file_changes: None,
                    overlay_changes: None,
                },
            )
            .await
            .unwrap();
        assert!(!Arc::ptr_eq(&snapshot_a, &snapshot_a_again));

        let calls = Arc::new(AtomicUsize::new(0));
        let compute = |calls: Arc<AtomicUsize>, key: &'static str| {
            move |client: ApiClient| async move {
                calls.fetch_add(1, Ordering::SeqCst);
                client
                    .raw_json_request("echo", json!({ "value": key }))
                    .await
            }
        };
        let _: Value = orchestrator
            .cached(
                &profile,
                "result-a",
                Some(Duration::from_secs(30)),
                compute(calls.clone(), "a"),
            )
            .await
            .unwrap();
        let _: Value = orchestrator
            .cached(
                &profile,
                "result-b",
                Some(Duration::from_secs(30)),
                compute(calls.clone(), "b"),
            )
            .await
            .unwrap();
        let _: Value = orchestrator
            .cached(
                &profile,
                "result-a",
                Some(Duration::from_secs(30)),
                compute(calls.clone(), "a"),
            )
            .await
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 3);

        let stats = orchestrator.stats();
        assert_eq!(stats.cached_snapshot_count, 1);
        assert_eq!(stats.cached_result_count, 1);
    });
}

#[test]
fn orchestrator_emits_eviction_events() {
    run_async_test(async {
        let observer = Arc::new(EventCollector::default());
        let orchestrator = ApiOrchestrator::new(
            ApiOrchestratorConfig {
                max_workers_per_profile: 2,
                max_cached_snapshots: 1,
                max_cached_results: 1,
                work_queue_capacity: 2,
                observer: None,
            }
            .with_observer(observer.clone()),
        );
        let profile = support::api_profile("observed-cache", ApiMode::AsyncJsonRpcStdio);

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
            .await
            .unwrap();
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
            .await
            .unwrap();
        let _: Value = orchestrator
            .cached(
                &profile,
                "ping-a",
                Some(Duration::from_secs(30)),
                |client| async move { client.raw_json_request("ping", Value::Null).await },
            )
            .await
            .unwrap();
        let _: Value = orchestrator
            .cached(
                &profile,
                "ping-b",
                Some(Duration::from_secs(30)),
                |client| async move { client.raw_json_request("ping", Value::Null).await },
            )
            .await
            .unwrap();

        let events = observer.events.lock().unwrap().clone();
        assert!(events.contains(&CorsaEvent::OrchestratorSnapshotEvicted {
            key: "workspace-a".into(),
        }));
        assert!(events.contains(&CorsaEvent::OrchestratorResultEvicted {
            key: "ping-a".into(),
        }));
    });
}

#[test]
fn orchestrator_rejects_worker_requests_above_limit() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::new(ApiOrchestratorConfig {
            max_workers_per_profile: 1,
            max_cached_snapshots: 4,
            max_cached_results: 4,
            work_queue_capacity: 4,
            observer: None,
        });
        let profile = support::api_profile("limited-workers", ApiMode::AsyncJsonRpcStdio);
        let error = orchestrator.prewarm(&profile, 2).await.unwrap_err();
        assert!(matches!(
            error,
            corsa::CorsaError::Protocol(message) if message.contains("exceeds the configured maximum")
        ));
    });
}

fn count_lines(path: impl AsRef<std::path::Path>) -> usize {
    std::fs::read_to_string(path)
        .map(|text| text.lines().count())
        .unwrap_or(0)
}

#[test]
fn orchestrator_pins_a_project_to_one_warm_worker() {
    let pinned_dir = tempfile::tempdir().unwrap();
    let round_robin_dir = tempfile::tempdir().unwrap();

    run_async_test({
        let pinned = pinned_dir.path().display().to_string();
        let round_robin = round_robin_dir.path().display().to_string();
        async move {
            let orchestrator = ApiOrchestrator::default();

            let pinned_profile = ApiProfile::new(
                "pinned",
                support::api_config(ApiMode::AsyncJsonRpcStdio)
                    .with_env("CORSA_MOCK_COUNT_DIR", pinned),
            );
            orchestrator.prewarm(&pinned_profile, 3).await.unwrap();
            for _ in 0..4 {
                let project = orchestrator
                    .acquire_project(
                        &pinned_profile,
                        "/workspace/tsconfig.json",
                        Some("/workspace/src/index.ts".into()),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    project.project().config_file_name,
                    "/workspace/tsconfig.json"
                );
                project.release();
            }

            // The same project keeps landing on the worker that is already warm
            // for it, so only one of the three ever runs `initialize`.
            let round_robin_profile = ApiProfile::new(
                "round-robin",
                support::api_config(ApiMode::AsyncJsonRpcStdio)
                    .with_env("CORSA_MOCK_COUNT_DIR", round_robin),
            );
            orchestrator.prewarm(&round_robin_profile, 3).await.unwrap();
            for _ in 0..4 {
                let client = orchestrator.lease(&round_robin_profile).await.unwrap();
                client
                    .update_snapshot(UpdateSnapshotParams {
                        open_project: Some("/workspace/tsconfig.json".into()),
                        file_changes: None,
                        overlay_changes: None,
                    })
                    .await
                    .unwrap();
            }

            orchestrator
                .shutdown_profile(&pinned_profile)
                .await
                .unwrap();
            orchestrator
                .shutdown_profile(&round_robin_profile)
                .await
                .unwrap();
        }
    });

    assert_eq!(count_lines(pinned_dir.path().join("initialize.count")), 1);
    assert_eq!(
        count_lines(round_robin_dir.path().join("initialize.count")),
        3
    );
}

#[test]
fn concurrent_first_leases_for_one_project_agree_on_one_worker() {
    let count_dir = tempfile::tempdir().unwrap();

    run_async_test({
        let count_path = count_dir.path().display().to_string();
        async move {
            let orchestrator = Arc::new(ApiOrchestrator::default());
            let profile = ApiProfile::new(
                "affinity-race",
                support::api_config(ApiMode::AsyncJsonRpcStdio)
                    .with_env("CORSA_MOCK_COUNT_DIR", count_path),
            );
            // Three workers, so a lost race hands the same project to a
            // different one instead of silently agreeing.
            orchestrator.prewarm(&profile, 3).await.unwrap();

            let racers = (0..8)
                .map(|_| {
                    let orchestrator = orchestrator.clone();
                    let profile = profile.clone();
                    thread::spawn(move || {
                        block_on(async move {
                            let client = orchestrator
                                .lease_for_project(&profile, "/workspace/tsconfig.json")
                                .await
                                .unwrap();
                            client
                                .update_snapshot(UpdateSnapshotParams {
                                    open_project: Some("/workspace/tsconfig.json".into()),
                                    file_changes: None,
                                    overlay_changes: None,
                                })
                                .await
                                .unwrap();
                        })
                    })
                })
                .collect::<Vec<_>>();
            for racer in racers {
                racer.join().unwrap();
            }

            assert_eq!(orchestrator.project_affinity_count(&profile), 1);
            orchestrator.shutdown_profile(&profile).await.unwrap();
        }
    });

    // One worker initialized means all eight leases landed on it. Before the
    // lookup-and-insert was made atomic, racing first leases could each pick a
    // different worker and build the project graph more than once.
    assert_eq!(count_lines(count_dir.path().join("initialize.count")), 1);
}

#[test]
fn orchestrator_tracks_and_releases_project_affinities() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("affinity-bookkeeping", ApiMode::AsyncJsonRpcStdio);

        assert_eq!(orchestrator.project_affinity_count(&profile), 0);

        orchestrator
            .lease_for_project(&profile, "/workspace/tsconfig.json")
            .await
            .unwrap();
        orchestrator
            .lease_for_project(&profile, "/other/tsconfig.json")
            .await
            .unwrap();
        assert_eq!(orchestrator.project_affinity_count(&profile), 2);

        orchestrator.release_project_affinity(&profile, "/other/tsconfig.json");
        assert_eq!(orchestrator.project_affinity_count(&profile), 1);

        orchestrator.shutdown_profile(&profile).await.unwrap();
        assert_eq!(orchestrator.stats().worker_count, 0);
        assert_eq!(orchestrator.project_affinity_count(&profile), 0);
    });
}

#[test]
fn project_lease_exposes_the_stable_semantic_query_surface() {
    run_async_test(async {
        let orchestrator = ApiOrchestrator::default();
        let profile = support::api_profile("lease-semantics", ApiMode::AsyncJsonRpcStdio);

        let mut project = orchestrator
            .acquire_project(
                &profile,
                "/workspace/tsconfig.json",
                Some("/workspace/src/index.ts".into()),
            )
            .await
            .unwrap();

        let symbol = project
            .semantics()
            .symbol_at("/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(symbol.name, "value");

        project.session_mut().refresh(None).await.unwrap();
        assert!(
            project
                .semantics()
                .type_of(&symbol.id)
                .await
                .unwrap()
                .is_some()
        );

        project.release();
        orchestrator.shutdown_profile(&profile).await.unwrap();
    });
}
