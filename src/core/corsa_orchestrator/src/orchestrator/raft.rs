use super::state::{ReplicatedCommand, ReplicatedState};
use crate::{CorsaError, Result};
use corsa_core::fast::{CompactString, FastMap, SmallVec, compact_format};
use parking_lot::RwLock;
use std::sync::Arc;

#[path = "raft_core.rs"]
mod raft_core;
use raft_core::{append_to_follower, apply_commits, grant_vote, log_signature, quorum_size};

/// Role of a node inside the in-process Raft cluster.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RaftRole {
    /// Node currently allowed to append commands.
    Leader,
    /// Passive replica following the leader.
    Follower,
    /// Node currently requesting votes for a new term.
    Candidate,
}

/// Minimal in-process Raft cluster used by the distributed orchestrator.
///
/// This implementation intentionally models only the pieces the workspace needs
/// today: campaigning for a leader, appending replicated commands, and applying
/// committed entries to a deterministic state machine. It is not intended to be
/// a production-grade Raft implementation.
#[derive(Clone)]
pub struct RaftCluster {
    nodes: Arc<RwLock<FastMap<CompactString, RaftNode>>>,
}

#[derive(Clone)]
pub(super) struct LogEntry {
    term: u64,
    command: ReplicatedCommand,
}

#[derive(Clone)]
pub(super) struct RaftNode {
    id: CompactString,
    current_term: u64,
    role: RaftRole,
    voted_for: Option<CompactString>,
    commit_len: usize,
    applied_len: usize,
    log: SmallVec<[LogEntry; 8]>,
    state: ReplicatedState,
}

impl RaftCluster {
    /// Creates a cluster containing the provided node identifiers.
    pub fn new<I, S>(node_ids: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<CompactString>,
    {
        let nodes = node_ids
            .into_iter()
            .map(Into::into)
            .map(|id| {
                (
                    id.clone(),
                    RaftNode {
                        id,
                        current_term: 0,
                        role: RaftRole::Follower,
                        voted_for: None,
                        commit_len: 0,
                        applied_len: 0,
                        log: SmallVec::new(),
                        state: ReplicatedState::default(),
                    },
                )
            })
            .collect();
        Self {
            nodes: Arc::new(RwLock::new(nodes)),
        }
    }

    /// Returns the current leader identifier, if one has been elected.
    pub fn leader_id(&self) -> Option<CompactString> {
        self.nodes
            .read()
            .values()
            .find(|node| node.role == RaftRole::Leader)
            .map(|node| node.id.clone())
    }

    /// Starts an election for `candidate_id` and returns the new term.
    ///
    /// Elections succeed only when the candidate reaches quorum and its log is
    /// at least as up to date as the followers' logs.
    pub fn campaign(&self, candidate_id: &str) -> Result<u64> {
        let mut nodes = self.nodes.write();
        let (last_len, last_term) = log_signature(nodes.get(candidate_id).ok_or_else(|| {
            CorsaError::Protocol(compact_format(format_args!(
                "unknown raft node: {candidate_id}"
            )))
        })?);
        let next_term = nodes
            .values()
            .map(|node| node.current_term)
            .max()
            .unwrap_or(0)
            + 1;
        let mut votes = 0;
        for node in nodes.values_mut() {
            if node.id == candidate_id {
                node.current_term = next_term;
                node.role = RaftRole::Candidate;
                node.voted_for = Some(candidate_id.into());
                votes += 1;
                continue;
            }
            if grant_vote(node, next_term, candidate_id, last_len, last_term) {
                votes += 1;
            }
        }
        if votes < quorum_size(nodes.len()) {
            if let Some(node) = nodes.get_mut(candidate_id) {
                node.role = RaftRole::Follower;
            }
            return Err(CorsaError::Protocol(
                "raft election did not reach quorum".into(),
            ));
        }
        for node in nodes.values_mut() {
            node.current_term = next_term.max(node.current_term);
            node.role = if node.id == candidate_id {
                RaftRole::Leader
            } else {
                RaftRole::Follower
            };
        }
        Ok(next_term)
    }

    /// Appends a command through the current leader and commits it on quorum.
    ///
    /// On success, returns the new committed log length as a 1-based index.
    pub fn append(&self, leader_id: &str, command: ReplicatedCommand) -> Result<u64> {
        let mut nodes = self.nodes.write();
        let (leader_term, prev_len, prev_term) = {
            let leader = nodes.get_mut(leader_id).ok_or_else(|| {
                CorsaError::Protocol(compact_format(format_args!(
                    "unknown raft node: {leader_id}"
                )))
            })?;
            if leader.role != RaftRole::Leader {
                return Err(CorsaError::Protocol(compact_format(format_args!(
                    "raft node is not leader: {leader_id}"
                ))));
            }
            let prev_term = leader.log.last().map(|entry| entry.term).unwrap_or(0);
            let prev_len = leader.log.len();
            leader.log.push(LogEntry {
                term: leader.current_term,
                command,
            });
            (leader.current_term, prev_len, prev_term)
        };
        let entry = nodes
            .get(leader_id)
            .and_then(|node| node.log.get(prev_len))
            .cloned()
            .ok_or_else(|| {
                CorsaError::Protocol(compact_format(format_args!(
                    "raft leader log entry disappeared: {leader_id}"
                )))
            })?;
        let mut acknowledgements = 1;
        for (node_id, node) in nodes.iter_mut() {
            if node_id == leader_id {
                continue;
            }
            if append_to_follower(node, leader_term, leader_id, prev_len, prev_term, &entry) {
                acknowledgements += 1;
            }
        }
        if acknowledgements < quorum_size(nodes.len()) {
            return Err(CorsaError::Protocol(
                "raft append did not reach quorum".into(),
            ));
        }
        let commit_len = prev_len + 1;
        for node in nodes.values_mut() {
            if node.log.len() >= commit_len {
                node.commit_len = commit_len;
                apply_commits(node)?;
            }
        }
        Ok(commit_len as u64)
    }

    /// Returns the leader state, or the first node state when no leader exists.
    pub fn state(&self) -> Option<ReplicatedState> {
        let nodes = self.nodes.read();
        nodes
            .values()
            .find(|node| node.role == RaftRole::Leader)
            .or_else(|| nodes.values().next())
            .map(|node| node.state.clone())
    }

    /// Returns the replicated state stored on a specific node.
    pub fn node_state(&self, node_id: &str) -> Option<ReplicatedState> {
        self.nodes
            .read()
            .get(node_id)
            .map(|node| node.state.clone())
    }
}
