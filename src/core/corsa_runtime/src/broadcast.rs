//! Small broadcast channel used for fan-out notifications inside the workspace.
//!
//! This implementation intentionally optimizes for simplicity over perfect
//! fairness or backpressure support:
//!
//! - each subscriber gets its own `std::sync::mpsc` queue
//! - sending clones the payload once per live subscriber
//! - dropped receivers are pruned lazily on the next send
//!
//! That trade-off is a good fit for low-volume control-plane messages such as
//! JSON-RPC inbound events.

use smallvec::SmallVec;
use std::{
    sync::{Arc, Mutex, MutexGuard, mpsc},
    time::Duration,
};

/// Broadcast sender that clones each message for all active subscribers.
///
/// Cloning the sender keeps all subscribers attached to the same shared list.
#[derive(Clone)]
pub struct Sender<T> {
    inner: Arc<Mutex<SmallVec<[mpsc::Sender<T>; 4]>>>,
}

/// Receiving side of a broadcast channel.
///
/// Each receiver owns a dedicated queue and therefore observes every message
/// independently of other receivers.
pub struct Receiver<T> {
    inner: mpsc::Receiver<T>,
}

/// Creates a broadcast channel and returns the first receiver.
///
/// # Examples
///
/// ```
/// use std::time::Duration;
/// use corsa_runtime::broadcast;
///
/// let (sender, first) = broadcast();
/// let second = sender.subscribe();
///
/// assert_eq!(sender.send(7_u32), 2);
/// assert_eq!(first.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
/// assert_eq!(second.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
/// ```
pub fn channel<T>() -> (Sender<T>, Receiver<T>) {
    let inner = Arc::new(Mutex::new(SmallVec::<[mpsc::Sender<T>; 4]>::new()));
    let sender = Sender { inner };
    let receiver = sender.subscribe();
    (sender, receiver)
}

impl<T> Sender<T> {
    /// Creates a new receiver subscribed to future messages.
    ///
    /// Previously sent values are not replayed.
    pub fn subscribe(&self) -> Receiver<T> {
        let (tx, rx) = mpsc::channel();
        self.subscribers().push(tx);
        Receiver { inner: rx }
    }

    fn subscribers(&self) -> MutexGuard<'_, SmallVec<[mpsc::Sender<T>; 4]>> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl<T> Sender<T>
where
    T: Clone,
{
    /// Sends a value to all active subscribers and returns the delivery count.
    ///
    /// Receivers that have been dropped are removed from the subscriber list as
    /// part of this send operation.
    pub fn send(&self, value: T) -> usize {
        let mut subscribers = self.subscribers();
        let mut delivered = 0;
        subscribers.retain(|subscriber| match subscriber.send(value.clone()) {
            Ok(()) => {
                delivered += 1;
                true
            }
            Err(_) => false,
        });
        delivered
    }
}

impl<T> Receiver<T> {
    /// Blocks until the next value arrives.
    ///
    /// Returns [`mpsc::RecvError`] after all senders have been dropped and the
    /// queue has been drained.
    pub fn recv(&self) -> Result<T, mpsc::RecvError> {
        self.inner.recv()
    }

    /// Blocks until the next value arrives or the timeout expires.
    ///
    /// This is primarily useful in tests and in integration code that must
    /// avoid waiting forever for control-plane events.
    pub fn recv_timeout(&self, timeout: Duration) -> Result<T, mpsc::RecvTimeoutError> {
        self.inner.recv_timeout(timeout)
    }
}

#[cfg(test)]
mod tests {
    use super::channel;
    use std::{thread, time::Duration};

    #[test]
    fn broadcast_delivers_to_multiple_receivers() {
        let (sender, first) = channel::<u32>();
        let second = sender.subscribe();
        assert_eq!(sender.send(7_u32), 2);
        assert_eq!(first.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
        assert_eq!(second.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
    }

    #[test]
    fn send_prunes_dropped_receivers() {
        let (sender, first) = channel::<u32>();
        let second = sender.subscribe();
        drop(second);
        assert_eq!(sender.send(7_u32), 1);
        assert_eq!(first.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
        assert_eq!(sender.send(8_u32), 1);
    }

    #[test]
    fn recv_reports_disconnect_when_all_senders_are_gone() {
        let (sender, receiver) = channel::<u32>();
        drop(sender);
        assert!(receiver.recv().is_err());
    }

    #[test]
    fn sender_recovers_after_subscriber_list_poisoning() {
        let (sender, first) = channel::<u32>();
        let inner = sender.inner.clone();
        let _ = thread::spawn(move || {
            let _guard = inner.lock().unwrap();
            panic!("poison subscriber list");
        })
        .join();

        let second = sender.subscribe();
        assert_eq!(sender.send(7_u32), 2);
        assert_eq!(first.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
        assert_eq!(second.recv_timeout(Duration::from_millis(50)).unwrap(), 7);
    }
}
