use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex, Weak, mpsc},
    task::{Context, Poll, Waker},
    thread,
    time::Duration,
};

use crate::{CorsaError, Result};

use super::snapshot::lock_unpoisoned;

/// Tracks releases until their RPC responses arrive, including queue overflow.
#[derive(Default)]
pub(super) struct ReleaseProgress {
    state: Mutex<ProgressState>,
}

#[derive(Default)]
struct ProgressState {
    pending: usize,
    error: Option<CorsaError>,
    waiters: Vec<Weak<mpsc::SyncSender<Result<()>>>>,
}

impl ProgressState {
    fn result(&self) -> Result<()> {
        self.error
            .as_ref()
            .map_or(Ok(()), |error| Err(error.clone_for_pending()))
    }

    fn wake_waiters(&mut self) {
        for waiter in self.waiters.drain(..) {
            if let Some(waiter) = waiter.upgrade() {
                let _ = waiter.send(
                    self.error
                        .as_ref()
                        .map_or(Ok(()), |error| Err(error.clone_for_pending())),
                );
            }
        }
    }
}

impl ReleaseProgress {
    pub(super) fn submit(&self) {
        lock_unpoisoned(&self.state).pending += 1;
    }

    pub(super) fn complete(&self, result: Result<()>) {
        let mut state = lock_unpoisoned(&self.state);
        state.pending = state.pending.saturating_sub(1);
        if let Err(error) = result {
            state.error.get_or_insert(error);
        }
        if state.pending == 0 {
            state.wake_waiters();
        }
    }

    pub(super) fn fail(&self, error: CorsaError) {
        let mut state = lock_unpoisoned(&self.state);
        state.pending = 0;
        state.error.get_or_insert(error);
        state.wake_waiters();
    }

    pub(super) fn drain(&self, timeout: Duration) -> ReleaseDrain {
        let (sender, receiver) = mpsc::sync_channel(1);
        let sender = Arc::new(sender);
        let mut state = lock_unpoisoned(&self.state);
        state.waiters.retain(|waiter| waiter.strong_count() > 0);
        if state.pending == 0 {
            let _ = sender.send(state.result());
        } else {
            state.waiters.push(Arc::downgrade(&sender));
        }
        ReleaseDrain {
            state: Arc::new(Mutex::new(DrainState {
                receiver: Some(receiver),
                sender: Some(sender),
                result: None,
                waker: None,
            })),
            timeout,
        }
    }
}

pub(super) struct ReleaseDrain {
    state: Arc<Mutex<DrainState>>,
    timeout: Duration,
}

struct DrainState {
    receiver: Option<mpsc::Receiver<Result<()>>>,
    sender: Option<Arc<mpsc::SyncSender<Result<()>>>>,
    result: Option<Result<()>>,
    waker: Option<Waker>,
}

impl Drop for ReleaseDrain {
    fn drop(&mut self) {
        // Disconnect a pending wait when its future is cancelled. Progress
        // holds only weak senders, so it cannot keep cancelled waits alive.
        lock_unpoisoned(&self.state).sender.take();
    }
}

impl Future for ReleaseDrain {
    type Output = Result<()>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = lock_unpoisoned(&self.state);
        if let Some(result) = state.result.take() {
            state.sender.take();
            return Poll::Ready(result);
        }
        state.waker = Some(cx.waker().clone());
        if let Some(receiver) = state.receiver.take() {
            match receiver.try_recv() {
                Ok(result) => {
                    state.sender.take();
                    return Poll::Ready(result);
                }
                Err(mpsc::TryRecvError::Disconnected) => {
                    return Poll::Ready(Err(CorsaError::Closed("snapshot release drain")));
                }
                Err(mpsc::TryRecvError::Empty) => {}
            }
            let shared = Arc::clone(&self.state);
            let timeout = self.timeout;
            if let Err(error) = thread::Builder::new()
                .name("corsa-snapshot-release-drain".into())
                .spawn(move || {
                    let result = match receiver.recv_timeout(timeout) {
                        Ok(result) => result,
                        Err(mpsc::RecvTimeoutError::Timeout) => {
                            Err(CorsaError::timeout("snapshot release drain", timeout))
                        }
                        Err(mpsc::RecvTimeoutError::Disconnected) => {
                            Err(CorsaError::Closed("snapshot release drain"))
                        }
                    };
                    let waker = {
                        let mut state = lock_unpoisoned(&shared);
                        state.sender.take();
                        state.result = Some(result);
                        state.waker.take()
                    };
                    if let Some(waker) = waker {
                        waker.wake();
                    }
                })
            {
                return Poll::Ready(Err(CorsaError::Io(error)));
            }
        }
        Poll::Pending
    }
}

#[cfg(test)]
#[path = "snapshot_release_drain_tests.rs"]
mod tests;
