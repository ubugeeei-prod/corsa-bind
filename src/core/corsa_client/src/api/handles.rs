use crate::{CorsaError, Result};
use corsa_core::fast::CompactString;
use serde::{Deserialize, Serialize};

macro_rules! handle_type {
    ($name:ident) => {
        /// Opaque handle returned by Corsa.
        ///
        /// Handles are lightweight string wrappers and can be passed back to
        /// follow-up requests without parsing.
        #[derive(Clone, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub CompactString);

        impl $name {
            /// Returns the raw string representation of the handle.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(CompactString::from(value))
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(CompactString::from(value))
            }
        }
    };
}

handle_type!(SnapshotHandle);
handle_type!(ProjectHandle);
handle_type!(SymbolHandle);
handle_type!(TypeHandle);
handle_type!(SignatureHandle);
handle_type!(NodeHandle);

/// Parsed representation of a [`NodeHandle`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParsedNodeHandle {
    /// Start offset in UTF-16 code units.
    pub pos: u32,
    /// End offset in UTF-16 code units.
    pub end: u32,
    /// TypeScript syntax kind numeric tag.
    pub kind: u16,
    /// Path component encoded into the handle.
    pub path: CompactString,
}

impl NodeHandle {
    /// Parses a node handle into offsets, syntax kind, and backing path.
    ///
    /// # Examples
    ///
    /// ```
    /// use corsa_client::NodeHandle;
    ///
    /// let parsed = NodeHandle::from("1.5.123./workspace/main.ts").parse()?;
    /// assert_eq!(parsed.pos, 1);
    /// assert_eq!(parsed.end, 5);
    /// assert_eq!(parsed.kind, 123);
    /// assert_eq!(parsed.path.as_str(), "/workspace/main.ts");
    /// # Ok::<(), corsa_client::CorsaError>(())
    /// ```
    pub fn parse(&self) -> Result<ParsedNodeHandle> {
        let mut parts = self.0.splitn(4, '.');
        let invalid = || CorsaError::InvalidHandle(self.0.clone());
        let pos = parts
            .next()
            .ok_or_else(&invalid)?
            .parse::<u32>()
            .map_err(|_| invalid())?;
        let end = parts
            .next()
            .ok_or_else(&invalid)?
            .parse::<u32>()
            .map_err(|_| invalid())?;
        let kind = parts
            .next()
            .ok_or_else(&invalid)?
            .parse::<u16>()
            .map_err(|_| invalid())?;
        let path = parts.next().ok_or_else(&invalid)?;
        if path.is_empty() || end < pos {
            return Err(invalid());
        }
        Ok(ParsedNodeHandle {
            pos,
            end,
            kind,
            path: path.into(),
        })
    }
}

#[cfg(test)]
#[path = "handles_tests.rs"]
mod tests;
