use crate::git::{canonical_repository_url, fetch_commit, snapshot, switch_detached};
use crate::status::RepositoryProblem;
use crate::{CommitMetadata, CorsaRefLock, LockedRepository, RepositoryStatus};
use corsa_core::{CorsaError, Result, fast::compact_format};
use std::path::{Path, PathBuf};

/// High-level manager for the pinned Corsa upstream checkout.
///
/// The manager reads [`CorsaRefLock`](crate::CorsaRefLock), locates the managed
/// repository relative to that lockfile, and provides the small set of
/// operations needed by CI and contributor workflows:
///
/// - [`status`](Self::status) inspects drift
/// - [`verify`](Self::verify) fails fast when drift exists
/// - [`sync`](Self::sync) restores the checkout to the pinned commit
/// - [`pin_current`](Self::pin_current) intentionally rewrites the lockfile
pub struct CorsaRefManager {
    lock_path: PathBuf,
}

impl CorsaRefManager {
    /// Creates a new manager rooted at the given lockfile path.
    pub fn new(lock_path: impl Into<PathBuf>) -> Self {
        Self {
            lock_path: lock_path.into(),
        }
    }

    /// Computes the current status of the managed reference.
    ///
    /// The returned [`RepositoryStatus`] describes both the live repository
    /// snapshot and any problems relative to the lockfile pin.
    pub fn status(&self) -> Result<RepositoryStatus> {
        let lock = CorsaRefLock::load(&self.lock_path)?;
        let repository = lock.root();
        let repo_path = self.repository_path(repository);
        if !repo_path.exists() {
            return Err(CorsaError::Protocol(compact_format(format_args!(
                "managed ref is missing: {}",
                repo_path.display()
            ))));
        }
        Ok(RepositoryStatus::from_snapshot(
            repository,
            snapshot(&repo_path)?,
        ))
    }

    /// Verifies that the managed reference matches the lockfile exactly.
    ///
    /// This requires the expected repository, commit, detached HEAD, and a
    /// clean worktree.
    pub fn verify(&self) -> Result<()> {
        let status = self.status()?;
        if status.exact {
            return Ok(());
        }
        Err(CorsaError::Protocol(status.describe()))
    }

    /// Synchronizes the managed reference to the lockfile pin.
    ///
    /// Existing tracked drift is rejected unless the worktree is clean and the
    /// repository identity still matches the expected upstream.
    pub fn sync(&self) -> Result<()> {
        let lock = CorsaRefLock::load(&self.lock_path)?;
        let repository = lock.root();
        let repo_path = self.repository_path(repository);
        if !repo_path.exists() {
            crate::git::clone_no_checkout(&repository.repository, &repo_path)?;
        } else {
            let status = self.status()?;
            if status.snapshot.dirty {
                return Err(CorsaError::Protocol(compact_format(format_args!(
                    "managed ref is dirty: {}",
                    repo_path.display()
                ))));
            }
            if status
                .problems
                .iter()
                .any(|problem| matches!(problem, RepositoryProblem::RepositoryMismatch { .. }))
            {
                return Err(CorsaError::Protocol(status.describe()));
            }
        }
        fetch_commit(&repo_path, &repository.commit)?;
        switch_detached(&repo_path, &repository.commit)?;
        self.verify()
    }

    /// Rewrites the lockfile to pin the current managed repository state.
    ///
    /// This is an intentional action used when updating the workspace's pinned
    /// upstream reference.
    pub fn pin_current(&self) -> Result<()> {
        let existing = CorsaRefLock::load(&self.lock_path).ok();
        let path = existing
            .as_ref()
            .map(|lock| lock.corsa_upstream.path.clone())
            .unwrap_or_else(|| "ref/corsa-upstream".into());
        let repository_path = self.absolute_path(&path);
        let snapshot = snapshot(&repository_path)?;
        let metadata = CommitMetadata {
            commit: snapshot.commit,
            tree: snapshot.tree,
            committer_date: snapshot.committer_date,
            author: snapshot.author,
            subject: snapshot.subject,
        };
        let repository = existing
            .map(|lock| lock.corsa_upstream.repository)
            .unwrap_or_else(|| canonical_repository_url(&snapshot.remote_url));
        let lock = CorsaRefLock {
            version: 1,
            corsa_upstream: LockedRepository {
                path,
                repository,
                commit: metadata.commit,
                tree: metadata.tree,
                committer_date: metadata.committer_date,
                author: metadata.author,
                subject: metadata.subject,
            },
        };
        lock.save(&self.lock_path)
    }

    fn repository_path(&self, repository: &LockedRepository) -> PathBuf {
        self.absolute_path(&repository.path)
    }

    fn absolute_path(&self, path: &str) -> PathBuf {
        self.lock_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn init_repo(path: &Path) {
        fs::create_dir_all(path).unwrap();
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(path)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(path)
            .output()
            .unwrap();
    }

    #[test]
    fn pin_current_writes_lockfile_from_existing_ref() {
        let root = tempdir().unwrap();
        let repo = root.path().join("ref/corsa-upstream");
        init_repo(&repo);
        fs::write(repo.join("README.md"), "hello").unwrap();
        std::process::Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "Initial pin"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/microsoft/TypeScript.git",
            ])
            .current_dir(&repo)
            .output()
            .unwrap();
        let lock_path = root.path().join("corsa_ref.lock.toml");
        CorsaRefManager::new(&lock_path).pin_current().unwrap();
        let lock = CorsaRefLock::load(&lock_path).unwrap();
        assert_eq!(lock.corsa_upstream.path, "ref/corsa-upstream");
        assert_eq!(
            lock.corsa_upstream.repository,
            "https://github.com/microsoft/TypeScript.git"
        );
        assert_eq!(lock.version, 1);
    }

    #[test]
    fn status_errors_when_the_managed_ref_is_missing() {
        let root = tempdir().unwrap();
        let lock_path = root.path().join("corsa_ref.lock.toml");
        CorsaRefLock {
            version: 1,
            corsa_upstream: LockedRepository {
                path: "ref/corsa-upstream".into(),
                repository: "https://github.com/microsoft/TypeScript.git".into(),
                commit: "abc".into(),
                tree: "tree".into(),
                committer_date: "2026-03-30T00:00:00Z".into(),
                author: "Example".into(),
                subject: "Pinned".into(),
            },
        }
        .save(&lock_path)
        .unwrap();
        let err = CorsaRefManager::new(&lock_path).status().unwrap_err();
        assert!(
            matches!(err, CorsaError::Protocol(message) if message.contains("managed ref is missing"))
        );
    }

    #[test]
    fn verify_reports_dirty_worktree() {
        let root = tempdir().unwrap();
        let repo = root.path().join("ref/corsa-upstream");
        init_repo(&repo);
        fs::write(repo.join("README.md"), "hello").unwrap();
        std::process::Command::new("git")
            .args(["add", "README.md"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "Initial pin"])
            .current_dir(&repo)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args([
                "remote",
                "add",
                "origin",
                "https://github.com/microsoft/TypeScript.git",
            ])
            .current_dir(&repo)
            .output()
            .unwrap();
        let lock_path = root.path().join("corsa_ref.lock.toml");
        CorsaRefManager::new(&lock_path).pin_current().unwrap();
        fs::write(repo.join("README.md"), "dirty").unwrap();

        let err = CorsaRefManager::new(&lock_path).verify().unwrap_err();
        assert!(
            matches!(err, CorsaError::Protocol(message) if message.contains("worktree must be clean"))
        );
    }
}
