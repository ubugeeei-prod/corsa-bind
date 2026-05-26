mod support;

use corsa::lsp::{VirtualChange, VirtualDocument};
use lsp_types::{Position, Range};
use serde_json::json;

fn main() -> Result<(), corsa::CorsaError> {
    let mut document = VirtualDocument::in_memory(
        "overlay",
        "/main.ts",
        "typescript",
        "export const value = 1;\nexport const label = 'draft';\n",
    )?;
    let first_batch = document.apply_changes(&[
        VirtualChange::splice(Range::new(Position::new(0, 21), Position::new(0, 22)), "2"),
        VirtualChange::splice(
            Range::new(Position::new(1, 23), Position::new(1, 28)),
            "ready",
        ),
    ])?;
    let second_batch = document.apply_changes(&[VirtualChange::replace(
        "export const value = 2;\nexport const label = 'ready';\n",
    )])?;

    support::print_json(json!({
        "firstBatch": first_batch,
        "secondBatch": second_batch,
        "document": document,
    }));
    Ok(())
}
