//! Managed-reference utilities for the pinned Corsa upstream checkout.
//!
//! The workspace keeps a Corsa upstream checkout under
//! `ref/typescript-go` and treats it as a reproducible input for regression
//! tests, benchmarks, and CI. This crate owns the lockfile format and the logic
//! that verifies the checkout really matches that pin.
//!
//! Typical consumers use [`TsgoRefManager`] to:
//!
//! - inspect the current managed reference
//! - fail fast when the checkout drifts
//! - synchronize the checkout back to the pinned commit
//! - refresh the lockfile from the current checkout intentionally

mod git;
mod lockfile;
mod manager;
mod status;

/// Git metadata for commits and repository snapshots.
pub use git::{
    CommitMetadata, RepositorySnapshot, canonical_repository_id, canonical_repository_url,
};
/// Lockfile structures describing the pinned upstream repository.
pub use lockfile::{LockedRepository, TsgoRefLock};
/// High-level entry point for syncing and verifying the managed ref.
pub use manager::TsgoRefManager;
/// Drift diagnostics emitted when the managed ref diverges from the lockfile.
pub use status::{RepositoryProblem, RepositoryStatus};
