use corsa_core::{
    CorsaError, Result,
    fast::{CompactString, compact_format},
};
use std::{path::Path, process::Command};

/// Commit metadata recorded in the lockfile and repository snapshots.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitMetadata {
    /// Commit SHA.
    pub commit: CompactString,
    /// Tree SHA for the commit.
    pub tree: CompactString,
    /// Committer timestamp in ISO-8601 form.
    pub committer_date: CompactString,
    /// Commit author name.
    pub author: CompactString,
    /// Commit subject line.
    pub subject: CompactString,
}

/// Snapshot of the current state of a repository checkout.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RepositorySnapshot {
    /// URL of the `origin` remote.
    pub remote_url: CompactString,
    /// Currently checked-out commit SHA.
    pub commit: CompactString,
    /// Tree SHA for the checked-out commit.
    pub tree: CompactString,
    /// Committer timestamp in ISO-8601 form.
    pub committer_date: CompactString,
    /// Commit author name.
    pub author: CompactString,
    /// Commit subject line.
    pub subject: CompactString,
    /// Attached branch name, or `None` when `HEAD` is detached.
    pub branch: Option<CompactString>,
    /// Whether the worktree has tracked or untracked changes.
    pub dirty: bool,
}

/// Normalizes an upstream URL into a host/path identifier.
pub fn canonical_repository_id(url: &str) -> CompactString {
    let trimmed = url.trim().trim_end_matches(".git");
    let ssh = trimmed
        .strip_prefix("git@")
        .map(|value| value.replacen(':', "/", 1));
    let normalized = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("ssh://"))
        .map(|value| {
            value
                .strip_prefix("git@")
                .map(|value| value.replacen(':', "/", 1))
                .unwrap_or_else(|| value.to_owned())
        });
    ssh.or(normalized)
        .unwrap_or_else(|| trimmed.to_owned())
        .into()
}

/// Converts a repository URL into the canonical HTTPS form used in the lockfile.
pub fn canonical_repository_url(url: &str) -> CompactString {
    let repository = canonical_repository_id(url);
    let mut canonical = CompactString::from("https://");
    canonical.push_str(repository.as_str());
    canonical.push_str(".git");
    canonical
}

/// Captures a live snapshot of a git checkout.
pub fn snapshot(path: &Path) -> Result<RepositorySnapshot> {
    let commit = run_git(path, &["rev-parse", "HEAD"])?;
    let metadata = metadata(path, "HEAD")?;
    Ok(RepositorySnapshot {
        remote_url: run_git(path, &["remote", "get-url", "origin"])?,
        commit,
        tree: metadata.tree,
        committer_date: metadata.committer_date,
        author: metadata.author,
        subject: metadata.subject,
        branch: run_git_allow_failure(path, &["symbolic-ref", "-q", "--short", "HEAD"]),
        dirty: !run_git(path, &["status", "--short", "--untracked-files=all"])?.is_empty(),
    })
}

/// Reads metadata for a specific revision.
pub fn metadata(path: &Path, revision: &str) -> Result<CommitMetadata> {
    let body = run_git(
        path,
        &[
            "show",
            "--no-patch",
            "--format=%H%n%T%n%cI%n%an%n%s",
            revision,
        ],
    )?;
    let mut lines = body.lines();
    Ok(CommitMetadata {
        commit: next_line(&mut lines, "commit")?,
        tree: next_line(&mut lines, "tree")?,
        committer_date: next_line(&mut lines, "committer date")?,
        author: next_line(&mut lines, "author")?,
        subject: next_line(&mut lines, "subject")?,
    })
}

/// Clones a repository without checking out a working tree.
pub fn clone_no_checkout(repository: &str, path: &Path) -> Result<()> {
    let status = Command::new("git")
        .args(["clone", "--origin", "origin", "--no-checkout", repository])
        .arg(path)
        .status()?;
    if status.success() {
        return Ok(());
    }
    Err(git_clone_error(repository, path, status))
}

/// Fetches a specific commit into the local repository.
pub fn fetch_commit(path: &Path, commit: &str) -> Result<()> {
    run_git_inherit(Some(path), &["fetch", "--depth", "1", "origin", commit])?;
    Ok(())
}

/// Switches the repository to a detached `HEAD` at `commit`.
pub fn switch_detached(path: &Path, commit: &str) -> Result<()> {
    run_git_inherit(Some(path), &["switch", "--detach", commit])?;
    Ok(())
}

fn next_line<'a>(lines: &mut impl Iterator<Item = &'a str>, name: &str) -> Result<CompactString> {
    lines.next().map(CompactString::from).ok_or_else(|| {
        CorsaError::Protocol(compact_format(format_args!("git output missing {name}")))
    })
}

fn run_git(path: &Path, args: &[&str]) -> Result<CompactString> {
    run_git_at(Some(path), args)
}

fn run_git_allow_failure(path: &Path, args: &[&str]) -> Option<CompactString> {
    run_git_at(Some(path), args)
        .ok()
        .filter(|value| !value.is_empty())
}

fn run_git_inherit(path: Option<&Path>, args: &[&str]) -> Result<()> {
    let status = command(path, args).status()?;
    if status.success() {
        return Ok(());
    }
    Err(git_command_error(path, args, status, None))
}

fn run_git_at(path: Option<&Path>, args: &[&str]) -> Result<CompactString> {
    let output = command(path, args).output()?;
    if !output.status.success() {
        return Err(git_command_error(
            path,
            args,
            output.status,
            Some(&output.stderr),
        ));
    }
    Ok(CompactString::from_utf8_lossy(&output.stdout).trim().into())
}

fn git_command_error(
    path: Option<&Path>,
    args: &[&str],
    status: std::process::ExitStatus,
    stderr: Option<&[u8]>,
) -> CorsaError {
    let command = git_command_line(args);
    let cwd = path
        .map(|path| compact_format(format_args!("{}", path.display())))
        .unwrap_or_else(|| CompactString::from("<current directory>"));
    let stderr = stderr
        .map(CompactString::from_utf8_lossy)
        .map(|stderr| CompactString::from(stderr.trim()))
        .filter(|stderr| !stderr.is_empty());
    let message = match stderr {
        Some(stderr) => compact_format(format_args!(
            "git command failed: {command}\n  cwd: {cwd}\n  status: {status}\n  stderr: {stderr}"
        )),
        None => compact_format(format_args!(
            "git command failed: {command}\n  cwd: {cwd}\n  status: {status}"
        )),
    };
    CorsaError::Protocol(message)
}

fn git_clone_error(repository: &str, path: &Path, status: std::process::ExitStatus) -> CorsaError {
    CorsaError::Protocol(compact_format(format_args!(
        "git command failed: git clone --origin origin --no-checkout {repository} {}\n  cwd: <current directory>\n  status: {status}",
        path.display()
    )))
}

fn git_command_line(args: &[&str]) -> CompactString {
    let mut command = CompactString::from("git");
    for arg in args {
        command.push(' ');
        command.push_str(arg);
    }
    command
}

fn command(path: Option<&Path>, args: &[&str]) -> Command {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(path) = path {
        command.current_dir(path);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::{canonical_repository_id, canonical_repository_url};

    #[test]
    fn canonicalizes_https_and_ssh_urls() {
        assert_eq!(
            canonical_repository_id("https://github.com/microsoft/typescript-go.git"),
            "github.com/microsoft/typescript-go"
        );
        assert_eq!(
            canonical_repository_id("git@github.com:microsoft/typescript-go.git"),
            "github.com/microsoft/typescript-go"
        );
        assert_eq!(
            canonical_repository_url("git@github.com:microsoft/typescript-go.git"),
            "https://github.com/microsoft/typescript-go.git"
        );
        assert_eq!(
            canonical_repository_id("ssh://git@github.com/microsoft/typescript-go.git"),
            "github.com/microsoft/typescript-go"
        );
        assert_eq!(
            canonical_repository_url("ssh://git@github.com/microsoft/typescript-go.git"),
            "https://github.com/microsoft/typescript-go.git"
        );
    }
}
