use std::{
    sync::Arc,
    task::{Context, Waker},
    time::Duration,
};

use super::{ReleaseProgress, lock_unpoisoned};
use crate::CorsaError;

#[test]
fn cancelling_drains_disconnects_their_waiters_without_accumulating_registrations() {
    let progress = ReleaseProgress::default();
    progress.submit();
    let mut context = Context::from_waker(Waker::noop());

    for _ in 0..16 {
        let mut drain = Box::pin(progress.drain(Duration::from_secs(30)));
        assert!(std::future::Future::poll(drain.as_mut(), &mut context).is_pending());
        let shared = Arc::clone(&drain.state);
        assert_eq!(lock_unpoisoned(&progress.state).waiters.len(), 1);

        drop(drain);

        assert!(lock_unpoisoned(&shared).sender.is_none());
        assert!(
            lock_unpoisoned(&progress.state).waiters[0]
                .upgrade()
                .is_none()
        );
    }
    progress.complete(Ok(()));
    assert!(lock_unpoisoned(&progress.state).waiters.is_empty());
}

#[test]
fn timed_out_drains_drop_their_senders_without_accumulating_registrations() {
    let progress = ReleaseProgress::default();
    progress.submit();

    for _ in 0..16 {
        let error = corsa_runtime::block_on(progress.drain(Duration::ZERO)).unwrap_err();
        assert!(matches!(error, CorsaError::Timeout(_)));
        let state = lock_unpoisoned(&progress.state);
        assert_eq!(state.waiters.len(), 1);
        assert!(state.waiters[0].upgrade().is_none());
    }

    progress.complete(Ok(()));
    corsa_runtime::block_on(progress.drain(Duration::ZERO)).unwrap();
}
