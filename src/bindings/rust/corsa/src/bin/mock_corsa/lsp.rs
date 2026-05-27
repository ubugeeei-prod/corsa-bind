use crate::{Result, jsonrpc};
use corsa::fast::{CompactString, FastMap};
use corsa::jsonrpc::{RawMessage, RequestId};
use corsa::lsp::{VirtualChange, VirtualDocument};
use lsp_types::{
    DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams,
};
use serde_json::{Value, json};
use std::io::{BufReader, BufWriter};

pub fn run() -> Result<()> {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = BufWriter::new(stdout.lock());
    let mut last_configuration = Value::Null;
    let mut documents = FastMap::<CompactString, VirtualDocument>::default();
    loop {
        let Some(message) = jsonrpc::read_message(&mut reader)? else {
            return Ok(());
        };
        let method = message.method.unwrap_or_default();
        let params = message.params.unwrap_or(Value::Null);
        match (message.id, method.as_str()) {
            (Some(id), "initialize") => {
                jsonrpc::write_message(
                    &mut writer,
                    &RawMessage::response(
                        id,
                        json!({
                            "capabilities": { "textDocumentSync": 1 },
                            "serverInfo": { "name": "mock-corsa" }
                        }),
                    ),
                )?;
                jsonrpc::write_message(
                    &mut writer,
                    &RawMessage::notification(
                        "window/logMessage",
                        json!({
                            "type": 3,
                            "message": "mock initialized"
                        }),
                    ),
                )?;
            }
            (Some(id), "custom/initializeAPISession") => {
                jsonrpc::write_message(
                    &mut writer,
                    &RawMessage::response(
                        id,
                        json!({
                            "sessionId": "session-1",
                            "pipe": "/tmp/mock-corsa.sock"
                        }),
                    ),
                )?;
            }
            (Some(id), "custom/lastConfiguration") => {
                jsonrpc::write_message(
                    &mut writer,
                    &RawMessage::response(id, last_configuration.clone()),
                )?;
            }
            (Some(id), "custom/overlayState") => {
                jsonrpc::write_message(
                    &mut writer,
                    &RawMessage::response(
                        id,
                        json!({
                            "documents": documents.values().cloned().collect::<Vec<_>>()
                        }),
                    ),
                )?;
            }
            (Some(id), _) => {
                jsonrpc::write_message(&mut writer, &RawMessage::response(id, Value::Null))?;
            }
            (None, "initialized") => {
                last_configuration = jsonrpc::send_request(
                    &mut reader,
                    &mut writer,
                    RequestId::integer(99),
                    "workspace/configuration",
                    json!({ "items": [{ "section": "typescript" }] }),
                )?;
            }
            (None, "textDocument/didOpen") => {
                let params: DidOpenTextDocumentParams = serde_json::from_value(params)?;
                let document = VirtualDocument::from_item(params.text_document);
                documents.insert(document.key(), document);
            }
            (None, "textDocument/didChange") => {
                let params: DidChangeTextDocumentParams = serde_json::from_value(params)?;
                if let Some(document) = documents.get_mut(params.text_document.uri.as_str()) {
                    let changes = params
                        .content_changes
                        .into_iter()
                        .map(VirtualChange::from)
                        .collect::<Vec<_>>();
                    document.apply_changes(&changes)?;
                }
            }
            (None, "textDocument/didClose") => {
                let params: DidCloseTextDocumentParams = serde_json::from_value(params)?;
                documents.remove(params.text_document.uri.as_str());
            }
            (None, "exit") => return Ok(()),
            (None, _) => {
                let _ = params;
            }
        }
    }
}
