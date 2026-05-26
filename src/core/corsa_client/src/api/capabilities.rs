use corsa_core::fast::CompactString;
use serde::{Deserialize, Serialize};

/// Runtime capability summary returned by `describeCapabilities`.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitiesResponse {
    /// Runtime identity and transport metadata.
    #[serde(default)]
    pub runtime: RuntimeCapabilities,
    /// Overlay-related feature flags.
    #[serde(default)]
    pub overlay: OverlayCapabilities,
    /// Diagnostics API availability by scope.
    #[serde(default)]
    pub diagnostics: DiagnosticsCapabilities,
    /// Editor-style API availability by feature.
    #[serde(default)]
    pub editor: EditorCapabilities,
}

/// Runtime identity details for the active worker.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCapabilities {
    /// Human-oriented runtime kind such as `corsa`, `native-preview`, or `mock-corsa`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<CompactString>,
    /// Executable path used to spawn the worker when known locally.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executable: Option<CompactString>,
    /// Transport identifier such as `jsonrpc` or `msgpack`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<CompactString>,
    /// Whether the runtime implemented the `describeCapabilities` endpoint.
    #[serde(default)]
    pub capability_endpoint: bool,
}

/// Overlay support exposed by the runtime.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayCapabilities {
    /// Whether `updateSnapshot` accepts `overlayChanges`.
    #[serde(default)]
    pub update_snapshot_overlay_changes: bool,
}

/// Diagnostics API support grouped by scope.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCapabilities {
    /// Whether snapshot-wide diagnostics are available.
    #[serde(default)]
    pub snapshot: bool,
    /// Whether project-wide diagnostics are available.
    #[serde(default)]
    pub project: bool,
    /// Whether file-scoped diagnostics are available.
    #[serde(default)]
    pub file: bool,
}

/// Editor API support grouped by feature.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCapabilities {
    /// Whether hover information is available.
    #[serde(default)]
    pub hover: bool,
    /// Whether definition lookup is available.
    #[serde(default)]
    pub definition: bool,
    /// Whether reference lookup is available.
    #[serde(default)]
    pub references: bool,
    /// Whether rename edits are available.
    #[serde(default)]
    pub rename: bool,
    /// Whether completion items are available.
    #[serde(default)]
    pub completion: bool,
}

impl CapabilitiesResponse {
    pub(crate) fn fallback(runtime: RuntimeCapabilities) -> Self {
        Self {
            runtime,
            overlay: OverlayCapabilities::default(),
            diagnostics: DiagnosticsCapabilities::default(),
            editor: EditorCapabilities::default(),
        }
    }
}

impl RuntimeCapabilities {
    pub(crate) fn merge_with_local(mut self, local: RuntimeCapabilities) -> Self {
        if self.kind.is_none() {
            self.kind = local.kind;
        }
        if self.executable.is_none() {
            self.executable = local.executable;
        }
        if self.transport.is_none() {
            self.transport = local.transport;
        }
        self.capability_endpoint |= local.capability_endpoint;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::{CapabilitiesResponse, RuntimeCapabilities};
    use corsa_core::fast::CompactString;

    #[test]
    fn fallback_keeps_runtime_identity_and_disables_features() {
        let response = CapabilitiesResponse::fallback(RuntimeCapabilities {
            kind: Some(CompactString::from("tsgo")),
            executable: Some(CompactString::from("/tmp/tsgo")),
            transport: Some(CompactString::from("msgpack")),
            capability_endpoint: false,
        });

        assert_eq!(response.runtime.kind.as_deref(), Some("tsgo"));
        assert!(!response.overlay.update_snapshot_overlay_changes);
        assert!(!response.diagnostics.snapshot);
        assert!(!response.editor.hover);
    }
}
