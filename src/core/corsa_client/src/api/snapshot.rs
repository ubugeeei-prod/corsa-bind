use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};

use crate::{Result, TsgoError};
use corsa_core::fast::CompactString;
use log::warn;

use super::{
    ApiClient, DocumentIdentifier, ProjectResponse, SnapshotChanges, SnapshotHandle,
    changes::UpdateSnapshotResponse, driver::ClientDriver, profiling::SharedProfiler,
};

const DEFAULT_RELEASE_QUEUE_CAPACITY: usize = 256;
type WorkerResult = thread::Result<()>;

/// Bounded background release worker shared by all snapshots from one client.
pub(crate) struct SnapshotReleaseQueue {
    driver: Arc<ClientDriver>,
    profiler: Option<SharedProfiler>,
    sender: Mutex<Option<mpsc::SyncSender<SnapshotHandle>>>,
    done: Mutex<Option<mpsc::Receiver<WorkerResult>>>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl SnapshotReleaseQueue {
    pub(crate) fn spawn(
        driver: Arc<ClientDriver>,
        profiler: Option<SharedProfiler>,
        capacity: usize,
    ) -> Self {
        let (tx, rx) =
            mpsc::sync_channel::<SnapshotHandle>(capacity.clamp(1, DEFAULT_RELEASE_QUEUE_CAPACITY));
        let (done_tx, done_rx) = mpsc::sync_channel(1);
        let worker_driver = Arc::clone(&driver);
        let worker_profiler = profiler.clone();
        let worker = thread::Builder::new()
            .name("corsa-snapshot-release".into())
            .spawn(move || {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    while let Ok(handle) = rx.recv() {
                        release_handle(&worker_driver, worker_profiler.as_ref(), handle);
                    }
                }));
                let _ = done_tx.send(result);
            })
            .expect("failed to spawn snapshot release worker");
        Self {
            driver,
            profiler,
            sender: Mutex::new(Some(tx)),
            done: Mutex::new(Some(done_rx)),
            worker: Mutex::new(Some(worker)),
        }
    }

    pub(crate) fn enqueue(&self, handle: SnapshotHandle) {
        let Some(sender) = self.sender.lock().unwrap().as_ref().cloned() else {
            warn!(
                "failed to release tsgo snapshot `{}`: release queue is closed",
                handle.as_str()
            );
            return;
        };
        match sender.try_send(handle) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(handle)) => {
                warn!(
                    "snapshot release queue is full; releasing `{}` on the current thread",
                    handle.as_str()
                );
                release_handle(&self.driver, self.profiler.as_ref(), handle);
            }
            Err(mpsc::TrySendError::Disconnected(handle)) => {
                warn!(
                    "failed to release tsgo snapshot `{}`: release queue is disconnected",
                    handle.as_str()
                );
            }
        }
    }

    pub(crate) async fn close(&self, timeout: Duration) -> Result<()> {
        self.sender.lock().unwrap().take();
        wait_for_worker(self, timeout, "snapshot release queue")
    }
}

fn release_handle(
    driver: &ClientDriver,
    profiler: Option<&SharedProfiler>,
    handle: SnapshotHandle,
) {
    if let Err(error) = corsa_runtime::block_on(driver.release_handle(handle.as_str(), profiler)) {
        warn!(
            "failed to release tsgo snapshot `{}`: {error}",
            handle.as_str()
        );
    }
}

fn wait_for_worker(
    queue: &SnapshotReleaseQueue,
    timeout: Duration,
    operation: &'static str,
) -> Result<()> {
    let done = queue.done.lock().unwrap();
    let Some(done_rx) = done.as_ref() else {
        return Ok(());
    };
    match done_rx.recv_timeout(timeout) {
        Ok(result) => {
            drop(done);
            queue.done.lock().unwrap().take();
            if let Some(worker) = queue.worker.lock().unwrap().take() {
                let _ = worker.join();
            }
            result
                .map_err(|_| TsgoError::Join(CompactString::from(format!("{operation} panicked"))))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            warn!("{operation} did not stop within {} ms", timeout.as_millis());
            Ok(())
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(TsgoError::Closed(operation)),
    }
}

/// Live snapshot handle with automatic release-on-drop semantics.
///
/// A managed snapshot bundles the opaque remote handle together with the
/// project list and optional change summary returned by `updateSnapshot`. When
/// the wrapper is dropped, it schedules a best-effort handle release so callers
/// do not leak server-side snapshot state accidentally.
pub struct ManagedSnapshot {
    client: ApiClient,
    release_queue: Arc<SnapshotReleaseQueue>,
    released: AtomicBool,
    /// Opaque snapshot handle used by follow-up API requests.
    pub handle: SnapshotHandle,
    /// Projects visible inside the snapshot at creation time.
    pub projects: Vec<ProjectResponse>,
    /// Optional project-level delta information returned by `tsgo`.
    pub changes: Option<SnapshotChanges>,
}

impl ManagedSnapshot {
    pub(crate) fn new(
        client: ApiClient,
        release_queue: Arc<SnapshotReleaseQueue>,
        response: UpdateSnapshotResponse,
    ) -> Self {
        Self {
            client,
            release_queue,
            released: AtomicBool::new(false),
            handle: response.snapshot,
            projects: response.projects,
            changes: response.changes,
        }
    }

    /// Looks up a project by its `tsconfig` path.
    ///
    /// This is a convenience helper for the common "find the project that owns
    /// this config file" flow after snapshot creation.
    pub fn project(&self, config_file_name: &str) -> Option<&ProjectResponse> {
        self.projects
            .iter()
            .find(|project| project.config_file_name == config_file_name)
    }

    /// Delegates to [`ApiClient::get_default_project_for_file`] using this snapshot.
    pub async fn get_default_project_for_file(
        &self,
        file: impl Into<DocumentIdentifier>,
    ) -> Result<Option<ProjectResponse>> {
        self.client
            .get_default_project_for_file(self.handle.clone(), file)
            .await
    }

    /// Releases the snapshot handle if it has not already been released.
    ///
    /// Calling this eagerly can reduce remote memory usage in long-lived
    /// processes when the snapshot is known to be dead before Rust drop runs.
    pub async fn release(&self) -> Result<()> {
        if self.released.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        self.client.release_handle(self.handle.as_str()).await
    }
}

impl Drop for ManagedSnapshot {
    fn drop(&mut self) {
        if self.released.load(Ordering::SeqCst) {
            return;
        }
        let snapshot = self.handle.clone();
        self.released.store(true, Ordering::SeqCst);
        self.release_queue.enqueue(snapshot);
    }
}
