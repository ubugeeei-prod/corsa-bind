mod support;

use std::time::Duration;

use corsa::{
    api::{ApiMode, ApiProfile},
    lsp::{VirtualChange, VirtualDocument},
    orchestrator::DistributedApiOrchestrator,
    runtime::block_on,
};
use serde_json::{Value, json};

fn main() -> Result<(), corsa::CorsaError> {
    let result = block_on(async {
        let orchestrator = DistributedApiOrchestrator::new(["n1", "n2", "n3"]);
        let profile = ApiProfile::new(
            "distributed-demo",
            support::mock_api_config("distributed_orchestrator", ApiMode::AsyncJsonRpcStdio)?,
        );
        let term = orchestrator.campaign("n1")?;
        let document =
            VirtualDocument::in_memory("cluster", "/main.ts", "typescript", "let value = 1;")?;
        orchestrator.open_virtual_document("n1", document.clone())?;
        let updated = orchestrator.change_virtual_document(
            "n1",
            &document.uri,
            [VirtualChange::splice(
                lsp_types::Range::new(
                    lsp_types::Position::new(0, 12),
                    lsp_types::Position::new(0, 13),
                ),
                "2",
            )],
        )?;
        let cached_ping: Value = orchestrator
            .cached(
                &profile,
                "n1",
                "ping",
                Some(Duration::from_secs(30)),
                |client| async move { client.raw_json_request("ping", Value::Null).await },
            )
            .await?;
        let follower_document = orchestrator.document("n2", &document.uri).ok_or_else(|| {
            corsa::CorsaError::Protocol(
                "distributed orchestrator example did not replicate to follower".into(),
            )
        })?;

        Ok::<_, corsa::CorsaError>(json!({
            "leaderId": orchestrator.leader_id(),
            "term": term,
            "cachedPing": cached_ping,
            "updatedDocument": updated,
            "followerDocument": follower_document,
        }))
    })?;

    support::print_json(result);
    Ok(())
}
