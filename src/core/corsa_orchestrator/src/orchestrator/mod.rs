//! Orchestrator implementations for the local worker pool.

mod api;
mod panic_payload;
mod project;

/// Local worker-pool orchestrator with snapshot and result caches.
pub use api::{ApiOrchestrator, ApiOrchestratorConfig, ApiOrchestratorStats};
/// Project session leased from a pinned worker in the local pool.
pub use project::ProjectLease;
