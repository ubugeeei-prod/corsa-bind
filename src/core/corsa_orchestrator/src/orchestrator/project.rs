use std::ops::{Deref, DerefMut};

use crate::Result;
use crate::api::{ApiProfile, DocumentIdentifier, ProjectSession};

use super::api::ApiOrchestrator;

/// A project session borrowed from an [`ApiOrchestrator`] worker pool.
///
/// This is the unit the orchestration layer is actually built around:
///
/// ```text
/// acquire_project
///   query
///   query
///   refresh
///   query
/// release
/// ```
///
/// Acquiring pins the project to one warm worker (see
/// [`ApiOrchestrator::lease_for_project`]), so repeated acquires for the same
/// `tsconfig` reuse a process that already has the program graph built.
///
/// Dropping a lease returns the worker to the pool. It deliberately does *not*
/// shut the worker down — that is the whole point of pooling — so use
/// [`ApiOrchestrator::shutdown_profile`] when you really want the processes
/// gone.
pub struct ProjectLease {
    session: ProjectSession,
}

impl ProjectLease {
    pub(super) fn new(session: ProjectSession) -> Self {
        Self { session }
    }

    /// Returns the underlying session.
    pub fn session(&self) -> &ProjectSession {
        &self.session
    }

    /// Returns the underlying session mutably, for snapshot refreshes.
    pub fn session_mut(&mut self) -> &mut ProjectSession {
        &mut self.session
    }

    /// Returns the lease to the pool.
    ///
    /// This is exactly what dropping the lease does; the method exists so
    /// release can be an explicit step in code that reads as a lifecycle.
    pub fn release(self) {}

    /// Unwraps the lease into a plain session.
    ///
    /// The caller takes over responsibility for the worker, including the fact
    /// that [`ProjectSession::close`] on a pooled worker shuts it down for
    /// every other lease of the same profile.
    pub fn into_session(self) -> ProjectSession {
        self.session
    }
}

impl Deref for ProjectLease {
    type Target = ProjectSession;

    fn deref(&self) -> &Self::Target {
        &self.session
    }
}

impl DerefMut for ProjectLease {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.session
    }
}

impl ApiOrchestrator {
    /// Acquires a snapshot-backed session for one project on a pinned worker.
    ///
    /// `open_project` is the `tsconfig` path Corsa should open, and doubles as
    /// the affinity key. `preferred_document` picks which project to settle on
    /// when the config resolves to more than one.
    ///
    /// # Examples
    ///
    /// ```no_run
    /// use corsa_orchestrator::{ApiOrchestrator, api::{ApiProfile, ApiSpawnConfig}};
    ///
    /// # async fn example() -> corsa_orchestrator::Result<()> {
    /// let orchestrator = ApiOrchestrator::default();
    /// let profile = ApiProfile::new("editor", ApiSpawnConfig::new("corsa"));
    ///
    /// let project = orchestrator
    ///     .acquire_project(&profile, "/repo/tsconfig.json", None)
    ///     .await?;
    ///
    /// let facts = project.semantics();
    /// let symbol = facts.symbol_at("/repo/src/index.ts", 42).await?;
    ///
    /// project.release();
    /// # Ok(())
    /// # }
    /// ```
    pub async fn acquire_project(
        &self,
        profile: &ApiProfile,
        open_project: impl Into<String>,
        preferred_document: Option<DocumentIdentifier>,
    ) -> Result<ProjectLease> {
        let open_project = open_project.into();
        let client = self
            .lease_for_project(profile, open_project.as_str())
            .await?;
        let session = ProjectSession::open(client, open_project, preferred_document).await?;
        Ok(ProjectLease::new(session))
    }
}
