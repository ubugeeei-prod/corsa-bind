//! Orchestration layers for coordinating one or more Corsa workers.
//!
//! This crate is where `corsa` outperforms naive CLI usage: by prewarming
//! workers, pinning a project to the worker that is already warm for it,
//! reusing snapshots, and memoizing results, higher-level workflows avoid
//! paying full initialization cost for every query.
//!
//! Upstream Corsa builds a compiler service. This crate builds the runtime
//! service on top of it — process lifecycle, pooling, affinity, caching, and
//! backpressure — without taking on any checker semantics. See
//! `docs/architecture_charter.md`.
//!
//! # Entry Points
//!
//! - [`ApiOrchestrator`] manages a local pool of API workers plus caches.
//! - [`ApiOrchestrator::acquire_project`] is the session-shaped entry point:
//!   acquire a [`ProjectLease`] for one `tsconfig`, query it, then release it.
//! - [`ApiOrchestrator::shutdown_profile`] drains a fleet when a `tsconfig` or
//!   the upstream binary changes.
//!
//! # Frozen Surfaces
//!
//! Distributed replication is gated behind the `experimental-distributed` cargo
//! feature, sits outside the production support commitment, and is **frozen**:
//! it receives no new capability and is a candidate for removal. Checker state
//! has strong affinity to a repo and its project graph, so the supported
//! scaling story is a well-tuned single-machine pool with repo-level sharding
//! above it, not consensus over snapshot state. See `docs/support_policy.md`.

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
    pub use corsa_core::{CorsaEvent, CorsaObserver, SharedObserver};
}

pub use corsa_core::{CorsaError, CorsaEvent, CorsaObserver, Result, SharedObserver};

#[path = "orchestrator/mod.rs"]
/// Local and distributed orchestration helpers.
pub mod orchestrator;

pub use orchestrator::*;
