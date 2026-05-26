mod support;

use corsa::{
    jsonrpc::RequestId,
    lsp::{VirtualChange, VirtualDocument},
    runtime::block_on,
};
use lsp_types::{Position, Range};
use serde_json::json;

fn main() -> Result<(), corsa::CorsaError> {
    let doubled = block_on(async { 21 * 2 });
    let mut document =
        VirtualDocument::untitled("/examples/minimal.ts", "typescript", "const answer = 41;\n")?;
    let events = document.apply_changes(&[VirtualChange::splice(
        Range::new(Position::new(0, 15), Position::new(0, 17)),
        "42",
    )])?;

    support::print_json(json!({
        "requestId": RequestId::integer(7).to_string(),
        "runtimeValue": doubled,
        "emittedEvents": events,
        "document": document,
    }));
    Ok(())
}
