use corsa::{
    lsp::{VirtualChange, VirtualDocument},
    orchestrator::DistributedApiOrchestrator,
};
use napi::Result;
use napi_derive::napi;
use serde_json::Value;
use std::str::FromStr;

use crate::util::{from_value, into_napi_error, to_value};

/// N-API wrapper for the distributed orchestration layer.
#[napi]
pub struct CorsaDistributedOrchestrator {
    inner: DistributedApiOrchestrator,
}

#[napi]
impl CorsaDistributedOrchestrator {
    /// Creates a new in-process Raft cluster.
    #[napi(constructor)]
    pub fn new(node_ids: Vec<String>) -> Self {
        Self {
            inner: DistributedApiOrchestrator::new(node_ids),
        }
    }

    /// Starts a leader election and returns the resulting term.
    #[napi]
    pub fn campaign(&self, node_id: String) -> Result<u32> {
        let term = self
            .inner
            .campaign(node_id.as_str())
            .map_err(into_napi_error)?;
        u32::try_from(term).map_err(into_napi_error)
    }

    /// Returns the current leader identifier.
    #[napi]
    pub fn leader_id(&self) -> Option<String> {
        self.inner.leader_id().map(|value| value.to_string())
    }

    /// Returns the leader state.
    #[napi]
    pub fn state(&self) -> Result<Option<Value>> {
        self.inner.state().map(|state| to_value(&state)).transpose()
    }

    /// Returns the state for a single node.
    #[napi]
    pub fn node_state(&self, node_id: String) -> Result<Option<Value>> {
        self.inner
            .node_state(node_id.as_str())
            .map(|state| to_value(&state))
            .transpose()
    }

    /// Returns a replicated document if it exists.
    #[napi]
    pub fn document(&self, node_id: String, uri: String) -> Result<Option<Value>> {
        let uri = lsp_types::Uri::from_str(uri.as_str()).map_err(into_napi_error)?;
        self.inner
            .document(node_id.as_str(), &uri)
            .map(|document| to_value(&document))
            .transpose()
    }

    /// Replicates an opened document and returns the state.
    #[napi]
    pub fn open_virtual_document(&self, document: Value) -> Result<Value> {
        let leader_id = self.require_leader()?;
        let document = from_value::<VirtualDocument>(document)?;
        let document = self
            .inner
            .open_virtual_document(leader_id.as_str(), document)
            .map_err(into_napi_error)?;
        to_value(&document)
    }

    /// Applies replicated incremental changes and returns the state.
    #[napi]
    pub fn change_virtual_document(&self, uri: String, changes: Value) -> Result<Value> {
        let leader_id = self.require_leader()?;
        let uri = lsp_types::Uri::from_str(uri.as_str()).map_err(into_napi_error)?;
        let changes = from_value::<Vec<VirtualChange>>(changes)?;
        let document = self
            .inner
            .change_virtual_document(leader_id.as_str(), &uri, changes)
            .map_err(into_napi_error)?;
        to_value(&document)
    }

    /// Removes a replicated document.
    #[napi]
    pub fn close_virtual_document(&self, uri: String) -> Result<()> {
        let leader_id = self.require_leader()?;
        let uri = lsp_types::Uri::from_str(uri.as_str()).map_err(into_napi_error)?;
        self.inner
            .close_virtual_document(leader_id.as_str(), &uri)
            .map_err(into_napi_error)
    }
}

impl CorsaDistributedOrchestrator {
    fn require_leader(&self) -> Result<String> {
        self.leader_id()
            .ok_or_else(|| into_napi_error("raft leader has not been elected"))
    }
}
