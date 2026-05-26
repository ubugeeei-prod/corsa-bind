use corsa_core::{
    Result, TsgoError,
    fast::{CompactString, compact_format},
};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

/// Lockfile describing the pinned Corsa upstream repository.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TsgoRefLock {
    /// Lockfile schema version.
    pub version: u32,
    /// Pinned upstream repository entry.
    pub typescript_go: LockedRepository,
}

/// Repository pin stored inside [`TsgoRefLock`].
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct LockedRepository {
    /// Relative path to the managed checkout.
    pub path: CompactString,
    /// Canonical upstream repository URL.
    pub repository: CompactString,
    /// Pinned commit SHA.
    pub commit: CompactString,
    /// Tree SHA for the pinned commit.
    pub tree: CompactString,
    /// Committer timestamp in ISO-8601 form.
    pub committer_date: CompactString,
    /// Commit author name.
    pub author: CompactString,
    /// Commit subject line.
    pub subject: CompactString,
}

impl TsgoRefLock {
    /// Loads and parses the lockfile from disk.
    pub fn load(path: &Path) -> Result<Self> {
        let body = fs::read_to_string(path)?;
        toml::from_str(&body).map_err(|err| {
            TsgoError::Protocol(compact_format(format_args!("invalid lockfile: {err}")))
        })
    }

    /// Serializes and writes the lockfile to disk.
    pub fn save(&self, path: &Path) -> Result<()> {
        let body = toml::to_string_pretty(self).map_err(|err| {
            TsgoError::Protocol(compact_format(format_args!(
                "failed to serialize lockfile: {err}"
            )))
        })?;
        fs::write(path, body)?;
        Ok(())
    }

    /// Returns the primary managed repository entry.
    pub fn root(&self) -> &LockedRepository {
        &self.typescript_go
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lockfile_roundtrips() {
        let lock = TsgoRefLock {
            version: 1,
            typescript_go: LockedRepository {
                path: "ref/typescript-go".into(),
                repository: "https://github.com/microsoft/typescript-go.git".into(),
                commit: "abc".into(),
                tree: "def".into(),
                committer_date: "2026-03-30T00:00:00Z".into(),
                author: "Example".into(),
                subject: "Pinned".into(),
            },
        };
        let encoded = toml::to_string(&lock).unwrap();
        let decoded: TsgoRefLock = toml::from_str(&encoded).unwrap();
        assert_eq!(decoded, lock);
    }
}
