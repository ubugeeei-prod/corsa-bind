//! Orchestration layers for coordinating one or more Corsa workers.
//!
//! The orchestration crates are where `corsa` can outperform naive CLI usage:
//! by prewarming workers, reusing snapshots, memoizing results, and replicating
//! editor state, higher-level workflows avoid paying full initialization cost
//! for every query.
//!
//! # Entry Points
//!
//! - [`ApiOrchestrator`] manages a local pool of API workers plus caches.
//! - distributed replication is available only with the
//!   `experimental-distributed` cargo feature.
//! - `DistributedApiOrchestrator` mirrors that state through an in-process
//!   Raft implementation for multi-node experiments and tests.

/// Re-exports the typed stdio API client layer used by the orchestrators.
pub mod api {
    pub use corsa_client::*;
}

/// Re-exports the LSP overlay types used for replicated virtual documents.
pub mod lsp {
    pub use corsa_lsp::*;
}

/// Re-exports structured operational events used by the orchestrator configs.
pub mod observability {
    pub use corsa_core::{SharedObserver, TsgoEvent, TsgoObserver};
}

pub use corsa_core::{Result, SharedObserver, TsgoError, TsgoEvent, TsgoObserver};

#[path = "orchestrator/mod.rs"]
/// Local and distributed orchestration helpers.
pub mod orchestrator;

pub use orchestrator::*;
