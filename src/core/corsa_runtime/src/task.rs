use crate::block_on;
use std::{future::Future, thread};

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
    JoinHandle {
        inner: thread::spawn(move || block_on(future)),
    }
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

    #[test]
    fn spawn_runs_future_on_worker_thread() {
        let handle = spawn(async { 5_u32 + 7 });
        assert_eq!(handle.join().unwrap(), 12);
    }
}
