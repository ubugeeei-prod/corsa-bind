//! Project addressing for runtimes that name projects by handle.
//!
//! TypeScript 7.1 development builds give every project a numeric `handle`
//! next to its logical `id`. The handle names one lifetime of the project: it
//! survives snapshot clones, and a project that is torn down and recreated
//! gets a new one. Every project-scoped request now addresses the project by
//! that handle, while snapshot change lists (`changedProjects`,
//! `removedProjects`) keep naming projects by `id`.
//!
//! [`ProjectResponse::id`](super::ProjectResponse::id) stays the logical id
//! on every runtime, so it still matches those change lists and callers keep
//! passing it back as a [`ProjectHandle`](super::ProjectHandle). The client
//! remembers which handle each project had in each snapshot it was reported
//! in, and swaps the id for that handle when a request is sent. A runtime that
//! reports no handles (TypeScript 7.1 beta, tsrs) is addressed by id as before.

use corsa_core::fast::{CompactString, FastMap};
use serde_json::{Map, Value};

/// `(snapshot, project id)` pairs remembered per generation; see [`ProjectMemo`].
const PROJECT_MEMO_GENERATION: usize = 4_096;

/// Marks the error for a project id this connection never saw a handle for.
pub(crate) const UNKNOWN_PROJECT: &str = "project is unknown to this connection";

/// Project handles one connection has learned, by snapshot.
///
/// Entries live in two generations, like the file memo of symbol identity: a
/// lookup in the old generation promotes the entry, and the old generation is
/// dropped when the young one fills. `latest` answers for a snapshot the
/// client never saw projects for, such as one a raw call created.
#[derive(Default)]
pub(crate) struct ProjectMemo {
    young: FastMap<(u64, CompactString), u64>,
    old: FastMap<(u64, CompactString), u64>,
    latest: FastMap<CompactString, u64>,
    /// Set once the runtime has reported any project handle.
    uses_handles: bool,
}

impl ProjectMemo {
    /// Learns the handles of every project `response` reports.
    ///
    /// Snapshot responses list their projects next to the snapshot they
    /// belong to; anything else reports projects of the request's snapshot.
    pub(crate) fn learn(&mut self, response: &Value, request_snapshot: Option<u64>) {
        match response {
            Value::Object(fields) => {
                if let Some((id, handle)) = project_handle(fields) {
                    self.remember(request_snapshot, id, handle);
                    return;
                }
                let snapshot = fields
                    .get("snapshot")
                    .and_then(Value::as_u64)
                    .or(request_snapshot);
                if let Some(Value::Array(projects)) = fields.get("projects") {
                    for project in projects {
                        if let Some((id, handle)) = project.as_object().and_then(project_handle) {
                            self.remember(snapshot, id, handle);
                        }
                    }
                }
            }
            Value::Array(items) => {
                for item in items {
                    self.learn(item, request_snapshot);
                }
            }
            Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
        }
    }

    /// Returns the wire value that addresses `project` in `snapshot`.
    ///
    /// `Ok(None)` leaves the value as the caller wrote it: a number is
    /// already a handle, and a runtime without handles takes the id.
    pub(crate) fn resolve(
        &mut self,
        project: &Value,
        snapshot: Option<u64>,
    ) -> std::result::Result<Option<u64>, CompactString> {
        let Value::String(id) = project else {
            return Ok(None);
        };
        if !self.uses_handles || id.is_empty() {
            return Ok(None);
        }
        if let Some(snapshot) = snapshot {
            let key = (snapshot, CompactString::from(id.as_str()));
            if let Some(handle) = self.young.get(&key) {
                return Ok(Some(*handle));
            }
            if let Some(handle) = self.old.remove(&key) {
                self.insert(key, handle);
                return Ok(Some(handle));
            }
        }
        self.latest
            .get(id.as_str())
            .copied()
            .map(Some)
            .ok_or_else(|| CompactString::from(id.as_str()))
    }

    fn remember(&mut self, snapshot: Option<u64>, id: &str, handle: u64) {
        self.uses_handles = true;
        let id = CompactString::from(id);
        self.latest.insert(id.clone(), handle);
        if let Some(snapshot) = snapshot {
            self.insert((snapshot, id), handle);
        }
    }

    fn insert(&mut self, key: (u64, CompactString), handle: u64) {
        if self.young.len() >= PROJECT_MEMO_GENERATION && !self.young.contains_key(&key) {
            self.old = std::mem::take(&mut self.young);
        }
        self.young.insert(key, handle);
    }
}

/// Recognizes a `ProjectResponse` that carries a handle.
fn project_handle(fields: &Map<String, Value>) -> Option<(&str, u64)> {
    if !fields.contains_key("parsedCommandLine") {
        return None;
    }
    let id = fields.get("id").and_then(Value::as_str)?;
    let handle = fields.get("handle").and_then(Value::as_u64)?;
    Some((id, handle))
}

#[cfg(test)]
#[path = "project_identity_tests.rs"]
mod tests;
