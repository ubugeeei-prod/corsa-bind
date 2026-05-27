use corsa::lsp::{VirtualChange, VirtualDocument};
use napi::Result;
use napi_derive::napi;

use crate::util::{into_napi_error, parse_json, to_json};

/// Mutable virtual document mirrored through the LSP overlay layer.
#[napi]
pub struct CorsaVirtualDocument {
    inner: VirtualDocument,
}

#[napi]
impl CorsaVirtualDocument {
    /// Creates an `untitled:` document.
    #[napi(factory)]
    pub fn untitled(path: String, language_id: String, text: String) -> Result<Self> {
        Ok(Self {
            inner: VirtualDocument::untitled(path.as_str(), language_id, text)
                .map_err(into_napi_error)?,
        })
    }

    /// Creates an in-memory `corsa://` document.
    #[napi(factory, js_name = "inMemory")]
    pub fn in_memory(
        authority: String,
        path: String,
        language_id: String,
        text: String,
    ) -> Result<Self> {
        Ok(Self {
            inner: VirtualDocument::in_memory(authority.as_str(), path.as_str(), language_id, text)
                .map_err(into_napi_error)?,
        })
    }

    /// Returns the document URI.
    #[napi(getter)]
    pub fn uri(&self) -> String {
        self.inner.uri.as_str().to_owned()
    }

    /// Returns the language identifier.
    #[napi(getter, js_name = "languageId")]
    pub fn language_id(&self) -> String {
        self.inner.language_id.to_string()
    }

    /// Returns the current version number.
    #[napi(getter)]
    pub fn version(&self) -> i32 {
        self.inner.version
    }

    /// Returns the current full text.
    #[napi(getter)]
    pub fn text(&self) -> String {
        self.inner.text.to_string()
    }

    /// Serializes the full document state.
    #[napi]
    pub fn state_json(&self) -> Result<String> {
        to_json(&self.inner)
    }

    /// Replaces the entire document text.
    #[napi]
    pub fn replace(&mut self, text: String) -> Result<()> {
        let changes = [VirtualChange::replace(text)];
        self.inner
            .apply_changes(&changes)
            .map_err(into_napi_error)?;
        Ok(())
    }

    /// Applies a batch of JSON-encoded LSP changes.
    #[napi]
    pub fn apply_changes_json(&mut self, changes_json: String) -> Result<String> {
        let changes = parse_json::<Vec<VirtualChange>>(changes_json.as_str())?;
        let events = self
            .inner
            .apply_changes(changes.as_slice())
            .map_err(into_napi_error)?;
        to_json(&events)
    }
}
