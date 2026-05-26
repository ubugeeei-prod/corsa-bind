mod support;

use std::time::Duration;

use corsa::{
    jsonrpc::InboundEvent,
    lsp::{InitializeApiSessionParams, LspClient, VirtualChange, VirtualDocument},
    runtime::block_on,
};
use serde_json::{Value, json};

struct InitializeRequest;

impl lsp_types::request::Request for InitializeRequest {
    type Params = Value;
    type Result = Value;
    const METHOD: &'static str = "initialize";
}

struct OverlayStateRequest;

impl lsp_types::request::Request for OverlayStateRequest {
    type Params = Value;
    type Result = Value;
    const METHOD: &'static str = "custom/overlayState";
}

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let client = LspClient::spawn(support::mock_lsp_config("lsp_overlay")?).await?;
        let events = client.subscribe();
        let initialize = client.request::<InitializeRequest>(json!({})).await?;
        let first_event = match events.recv_timeout(Duration::from_secs(1)).map_err(|err| {
            corsa::CorsaError::Protocol(
                format!("timed out waiting for first LSP event: {err}").into(),
            )
        })? {
            InboundEvent::Notification { method, params } => json!({
                "method": method,
                "message": params["message"],
            }),
            InboundEvent::Request { method, .. } => json!({
                "method": method,
                "message": "received request unexpectedly",
            }),
        };
        let session = client
            .initialize_api_session(InitializeApiSessionParams::default())
            .await?;
        let overlay = client.overlay();
        let document =
            VirtualDocument::untitled("/virtual/demo.ts", "typescript", "const value = 1;\n")?;
        overlay.open(document.clone())?;
        let updated = overlay.change(
            &document.uri,
            [VirtualChange::splice(
                lsp_types::Range::new(
                    lsp_types::Position::new(0, 14),
                    lsp_types::Position::new(0, 15),
                ),
                "2",
            )],
        )?;
        let state = client.request::<OverlayStateRequest>(json!({})).await?;
        overlay.close(&document.uri)?;
        client.close().await?;
        Ok::<_, corsa::CorsaError>(json!({
            "textDocumentSync": initialize["capabilities"]["textDocumentSync"],
            "firstEvent": first_event,
            "apiSessionId": session.session_id,
            "updatedDocument": updated,
            "overlayState": state,
        }))
    })?;

    support::print_json(result);
    Ok(())
}
