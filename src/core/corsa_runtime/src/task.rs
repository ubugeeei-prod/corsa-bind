use crate::block_on;
use std::{future::Future, io, thread};

/// Join handle returned by [`spawn`].
///
/// Unlike async task handles from full runtimes, this always represents a
/// dedicated OS thread.
pub struct JoinHandle<T> {
    inner: thread::JoinHandle<T>,
}

/// Spawns a future onto a dedicated worker thread.
///
/// The spawned thread immediately runs [`crate::block_on`] on the provided
/// future and exits when the future resolves.
///
/// Use [`try_spawn`] when the caller needs to handle operating-system thread
/// creation failures instead of panicking.
///
/// # Examples
///
/// ```
/// use corsa_runtime::spawn;
///
/// let handle = spawn(async { String::from("corsa") });
/// assert_eq!(handle.join().unwrap(), "corsa");
/// ```
pub fn spawn<F>(future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    try_spawn(future).expect("failed to spawn corsa runtime task")
}

/// Tries to spawn a future onto a dedicated worker thread.
///
/// The returned error is the operating-system thread creation failure reported
/// by [`std::thread::Builder::spawn`].
pub fn try_spawn<F>(future: F) -> io::Result<JoinHandle<F::Output>>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    thread::Builder::new()
        .spawn(move || block_on(future))
        .map(|inner| JoinHandle { inner })
}

impl<T> JoinHandle<T> {
    /// Waits for the worker thread to finish and returns its output.
    ///
    /// Panics from the worker thread are reported through the standard
    /// [`thread::Result`] error payload.
    pub fn join(self) -> thread::Result<T> {
        self.inner.join()
    }
}

#[cfg(test)]
mod tests {
    use super::spawn;
    use super::try_spawn;

    #[test]
    fn spawn_runs_future_on_worker_thread() {
        let handle = spawn(async { 5_u32 + 7 });
        assert_eq!(handle.join().unwrap(), 12);
    }

    #[test]
    fn try_spawn_reports_successful_worker_thread() {
        let handle = try_spawn(async { 11_u32 + 31 }).unwrap();
        assert_eq!(handle.join().unwrap(), 42);
    }
}
