use crate::{LockedRepository, RepositorySnapshot, canonical_repository_id};
use corsa_core::fast::{CompactString, SmallVec, compact_format};

/// Specific kinds of drift that can make the managed ref invalid.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RepositoryProblem {
    /// The lockfile and checkout point at different upstream repositories.
    RepositoryMismatch {
        /// Repository normalized from the lockfile.
        expected: CompactString,
        /// Repository normalized from the checkout's `origin` remote.
        actual: CompactString,
    },
    /// The checkout points at a different commit than the lockfile pin.
    CommitMismatch {
        /// Commit recorded in the lockfile.
        expected: CompactString,
        /// Commit currently checked out.
        actual: CompactString,
    },
    /// The checkout still has a named branch checked out.
    AttachedHead {
        /// Branch currently attached to `HEAD`.
        branch: CompactString,
    },
    /// The worktree contains uncommitted or untracked changes.
    DirtyWorktree,
}

/// Combined live snapshot and drift diagnostics for the managed ref.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositoryStatus {
    /// Whether the checkout matches the lockfile exactly.
    pub exact: bool,
    /// Collected drift problems, empty when [`exact`](Self::exact) is `true`.
    pub problems: SmallVec<[RepositoryProblem; 4]>,
    /// Raw repository metadata captured from the checkout.
    pub snapshot: RepositorySnapshot,
}

impl RepositoryStatus {
    /// Builds a status object by comparing a lockfile entry with a live snapshot.
    pub fn from_snapshot(lock: &LockedRepository, snapshot: RepositorySnapshot) -> Self {
        let mut problems = SmallVec::<[RepositoryProblem; 4]>::new();
        let expected_repository = canonical_repository_id(&lock.repository);
        let actual_repository = canonical_repository_id(&snapshot.remote_url);
        if expected_repository != actual_repository {
            problems.push(RepositoryProblem::RepositoryMismatch {
                expected: expected_repository,
                actual: actual_repository,
            });
        }
        if lock.commit != snapshot.commit {
            problems.push(RepositoryProblem::CommitMismatch {
                expected: lock.commit.as_str().into(),
                actual: snapshot.commit.as_str().into(),
            });
        }
        if let Some(branch) = &snapshot.branch {
            problems.push(RepositoryProblem::AttachedHead {
                branch: branch.as_str().into(),
            });
        }
        if snapshot.dirty {
            problems.push(RepositoryProblem::DirtyWorktree);
        }
        Self {
            exact: problems.is_empty(),
            problems,
            snapshot,
        }
    }

    /// Returns a human-readable multi-line description of the status.
    pub fn describe(&self) -> CompactString {
        if self.exact {
            return compact_format(format_args!(
                "corsa_upstream is pinned exactly at {} ({})",
                self.snapshot.commit, self.snapshot.subject
            ));
        }
        let mut description = CompactString::default();
        for (index, problem) in self.problems.iter().enumerate() {
            if index != 0 {
                description.push('\n');
            }
            description.push_str(problem_text(problem).as_str());
        }
        description
    }
}

fn problem_text(problem: &RepositoryProblem) -> CompactString {
    match problem {
        RepositoryProblem::RepositoryMismatch { expected, actual } => compact_format(format_args!(
            "repository mismatch: expected {expected}, got {actual}"
        )),
        RepositoryProblem::CommitMismatch { expected, actual } => compact_format(format_args!(
            "commit mismatch: expected {expected}, got {actual}"
        )),
        RepositoryProblem::AttachedHead { branch } => {
            compact_format(format_args!("HEAD must be detached, found {branch}"))
        }
        RepositoryProblem::DirtyWorktree => CompactString::from("worktree must be clean"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lock() -> LockedRepository {
        LockedRepository {
            path: "ref/corsa-upstream".into(),
            repository: "https://github.com/microsoft/TypeScript.git".into(),
            commit: "abc".into(),
            tree: "tree".into(),
            committer_date: "2026-03-30T00:00:00Z".into(),
            author: "Example".into(),
            subject: "Pinned".into(),
        }
    }

    fn snapshot() -> RepositorySnapshot {
        RepositorySnapshot {
            remote_url: "git@github.com:microsoft/TypeScript.git".into(),
            commit: "abc".into(),
            tree: "tree".into(),
            committer_date: "2026-03-30T00:00:00Z".into(),
            author: "Example".into(),
            subject: "Pinned".into(),
            branch: None,
            dirty: false,
        }
    }

    #[test]
    fn exact_status_requires_detached_clean_exact_commit() {
        let status = RepositoryStatus::from_snapshot(&lock(), snapshot());
        assert!(status.exact);
        assert!(status.problems.is_empty());
    }

    #[test]
    fn status_collects_drift_problems() {
        let mut drifted = snapshot();
        drifted.commit = "def".into();
        drifted.branch = Some("main".into());
        drifted.dirty = true;
        let status = RepositoryStatus::from_snapshot(&lock(), drifted);
        assert!(!status.exact);
        assert_eq!(status.problems.len(), 3);
    }

    #[test]
    fn exact_status_has_human_readable_description() {
        let status = RepositoryStatus::from_snapshot(&lock(), snapshot());
        assert_eq!(
            status.describe(),
            "corsa_upstream is pinned exactly at abc (Pinned)"
        );
    }

    #[test]
    fn drift_description_lists_each_problem_on_its_own_line() {
        let mut drifted = snapshot();
        drifted.remote_url = "https://example.com/other/repo.git".into();
        drifted.commit = "def".into();
        drifted.branch = Some("main".into());
        drifted.dirty = true;
        let status = RepositoryStatus::from_snapshot(&lock(), drifted);
        let description = status.describe();
        assert!(description.contains("repository mismatch"));
        assert!(description.contains("commit mismatch"));
        assert!(description.contains("HEAD must be detached"));
        assert!(description.contains("worktree must be clean"));
        assert_eq!(description.matches('\n').count(), 3);
    }
}
