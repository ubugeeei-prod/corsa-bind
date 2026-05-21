//! Tiny single-threaded executor used by the workspace.
//!
//! The goal here is not to compete with full async runtimes. Instead, this
//! module provides the minimum machinery needed to poll a future to completion
//! from synchronous code and from dedicated worker threads created by
//! [`crate::spawn`].

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Condvar, Mutex, MutexGuard},
    task::{Context, Poll, RawWaker, RawWakerVTable, Waker},
};

/// Runs a future to completion on the current thread.
///
/// The future is polled in a simple park/wake loop backed by a condition
/// variable. This works well for the workspace's usage patterns, where futures
/// are usually short-lived control flows rather than large, highly concurrent
/// task graphs.
///
/// # Safety invariants
///
/// The custom `RawWaker` implementation below relies on three invariants:
///
/// - every raw pointer stored in the waker originates from `Arc<Parker>::into_raw`
/// - `clone`, `wake`, `wake_by_ref`, and `drop` balance the `Arc` strong count
/// - the parker's notification bit is cleared only immediately before polling,
///   so wake-ups emitted during or after the poll are still observed by `park`
///
/// # Examples
///
/// ```
/// use corsa_runtime::block_on;
///
/// let value = block_on(async { 6 * 7 });
/// assert_eq!(value, 42);
/// ```
pub fn block_on<F>(future: F) -> F::Output
where
    F: Future,
{
    let parker = Arc::new(Parker::default());
    // The raw waker stores the `Arc<Parker>` pointer and reconstructs it in the
    // vtable callbacks. Every callback follows the usual `Arc::from_raw` /
    // `Arc::into_raw` ownership discipline so the strong count stays balanced.
    let waker = unsafe { Waker::from_raw(raw_waker(Arc::into_raw(parker.clone()) as *const ())) };
    let mut future = Pin::from(Box::new(future));
    let mut context = Context::from_waker(&waker);
    loop {
        // Clear the notification bit before polling so any wake emitted by the
        // future after this poll will be observed by `park`.
        parker.clear();
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
        // Wait until one of the wake callbacks flips the bit and notifies the
        // condition variable.
        parker.park();
    }
}

/// Small parking primitive paired with the custom waker.
#[derive(Default)]
struct Parker {
    notified: Mutex<bool>,
    ready: Condvar,
}

impl Parker {
    fn clear(&self) {
        *self.lock_notified() = false;
    }

    fn wake(&self) {
        let mut notified = self.lock_notified();
        *notified = true;
        self.ready.notify_one();
    }

    fn park(&self) {
        let mut notified = self.lock_notified();
        while !*notified {
            notified = self
                .ready
                .wait(notified)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn lock_notified(&self) -> MutexGuard<'_, bool> {
        self.notified
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// SAFETY: `pointer` must originate from `Arc<Parker>::into_raw`. The returned
// `RawWaker` delegates clone/wake/drop to functions that maintain the `Arc`
// reference count correctly.
unsafe fn raw_waker(pointer: *const ()) -> RawWaker {
    RawWaker::new(pointer, &VTABLE)
}

// SAFETY: `pointer` comes from `Arc<Parker>::into_raw`. Incrementing the strong
// count creates the additional ownership required by `RawWaker::clone`.
unsafe fn clone_waker(pointer: *const ()) -> RawWaker {
    unsafe {
        std::sync::Arc::<Parker>::increment_strong_count(pointer.cast::<Parker>());
        raw_waker(pointer)
    }
}

// SAFETY: `pointer` comes from `Arc<Parker>::into_raw`. Reconstructing the
// `Arc` transfers ownership of the raw pointer into this function, and dropping
// it at the end matches the semantics of `RawWaker::wake`.
unsafe fn wake_waker(pointer: *const ()) {
    let parker = unsafe { Arc::from_raw(pointer.cast::<Parker>()) };
    parker.wake();
}

// SAFETY: `pointer` comes from `Arc<Parker>::into_raw`. `wake_by_ref` must not
// consume ownership, so the `Arc` is converted back into a raw pointer after
// the wake-up signal is sent.
unsafe fn wake_by_ref_waker(pointer: *const ()) {
    let parker = unsafe { Arc::from_raw(pointer.cast::<Parker>()) };
    parker.wake();
    let _ = Arc::into_raw(parker);
}

// SAFETY: `pointer` comes from `Arc<Parker>::into_raw`, and `drop` is the final
// consumer for the corresponding raw reference.
unsafe fn drop_waker(pointer: *const ()) {
    drop(unsafe { Arc::from_raw(pointer.cast::<Parker>()) });
}

static VTABLE: RawWakerVTable =
    RawWakerVTable::new(clone_waker, wake_waker, wake_by_ref_waker, drop_waker);

#[cfg(test)]
mod tests {
    use super::block_on;
    use std::{
        future::Future,
        pin::Pin,
        sync::{
            Arc,
            atomic::{AtomicBool, Ordering},
        },
        task::{Context, Poll},
        thread,
        time::Duration,
    };

    #[test]
    fn block_on_runs_ready_future() {
        let value = block_on(async { 42 });
        assert_eq!(value, 42);
    }

    #[test]
    fn block_on_observes_cross_thread_wakes() {
        struct ThreadWakeFuture {
            started: bool,
            ready: Arc<AtomicBool>,
        }

        impl Future for ThreadWakeFuture {
            type Output = u32;

            fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
                if self.ready.load(Ordering::SeqCst) {
                    return Poll::Ready(7);
                }
                if !self.started {
                    self.started = true;
                    let ready = Arc::clone(&self.ready);
                    let waker = cx.waker().clone();
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(5));
                        ready.store(true, Ordering::SeqCst);
                        waker.wake();
                    });
                }
                Poll::Pending
            }
        }

        let value = block_on(ThreadWakeFuture {
            started: false,
            ready: Arc::new(AtomicBool::new(false)),
        });
        assert_eq!(value, 7);
    }

    #[test]
    fn block_on_handles_repeated_wake_by_ref_cycles() {
        struct SelfWakingFuture {
            remaining: usize,
        }

        impl Future for SelfWakingFuture {
            type Output = usize;

            fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
                if self.remaining == 0 {
                    return Poll::Ready(123);
                }
                self.remaining -= 1;
                cx.waker().wake_by_ref();
                Poll::Pending
            }
        }

        let value = block_on(SelfWakingFuture { remaining: 256 });
        assert_eq!(value, 123);
    }

    #[test]
    fn parker_recovers_after_notification_lock_poisoning() {
        let parker = super::Parker::default();
        thread::scope(|scope| {
            let handle = scope.spawn(|| {
                let _guard = parker.notified.lock().unwrap();
                panic!("poison parker");
            });
            let _ = handle.join();
        });

        parker.clear();
        parker.wake();
        parker.park();
    }
}
