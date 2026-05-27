use corsa::{
    lsp::{VirtualChange, VirtualDocument},
    orchestrator::DistributedApiOrchestrator,
};
use napi::Result;
use napi_derive::napi;
use std::str::FromStr;

use crate::util::{into_napi_error, parse_json, to_json};

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

    /// Serializes the leader state.
    #[napi]
    pub fn state_json(&self) -> Result<Option<String>> {
        self.inner.state().map(|state| to_json(&state)).transpose()
    }

    /// Serializes the state for a single node.
    #[napi]
    pub fn node_state_json(&self, node_id: String) -> Result<Option<String>> {
        self.inner
            .node_state(node_id.as_str())
            .map(|state| to_json(&state))
            .transpose()
    }

    /// Serializes a replicated document if it exists.
    #[napi]
    pub fn document_json(&self, node_id: String, uri: String) -> Result<Option<String>> {
        let uri = lsp_types::Uri::from_str(uri.as_str()).map_err(into_napi_error)?;
        self.inner
            .document(node_id.as_str(), &uri)
            .map(|document| to_json(&document))
            .transpose()
    }

    /// Replicates an opened document and returns the serialized state.
    #[napi]
    pub fn open_virtual_document_json(
        &self,
        leader_id: String,
        document_json: String,
    ) -> Result<String> {
        let document = parse_json::<VirtualDocument>(document_json.as_str())?;
        let document = self
            .inner
            .open_virtual_document(leader_id.as_str(), document)
            .map_err(into_napi_error)?;
        to_json(&document)
    }

    /// Applies replicated incremental changes and returns the serialized state.
    #[napi]
    pub fn change_virtual_document_json(
        &self,
        leader_id: String,
        uri: String,
        changes_json: String,
    ) -> Result<String> {
        let uri = lsp_types::Uri::from_str(uri.as_str()).map_err(into_napi_error)?;
        let changes = parse_json::<Vec<VirtualChange>>(changes_json.as_str())?;
        let document = self
            .inner
            .change_virtual_document(leader_id.as_str(), &uri, changes)
            .map_err(into_napi_error)?;
        to_json(&document)
    }

    /// Removes a replicated document.
    #[napi]
    pub fn close_virtual_document(&self, leader_id: String, uri: String) -> Result<()> {
        let uri = lsp_types::Uri::from_str(uri.as_str()).map_err(into_napi_error)?;
        self.inner
            .close_virtual_document(leader_id.as_str(), &uri)
            .map_err(into_napi_error)
    }
}
