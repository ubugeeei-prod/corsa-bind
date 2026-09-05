mod support;

use corsa::{
    api::{ApiMode, NameMeaning, ProjectSession, SEMANTIC_QUERY_VERSION, SignatureKind, TypeRef},
    runtime::block_on,
};

async fn open_session() -> ProjectSession {
    ProjectSession::spawn(
        support::api_config(ApiMode::AsyncJsonRpcStdio),
        "/workspace/tsconfig.json",
        Some("/workspace/src/index.ts".into()),
    )
    .await
    .unwrap()
}

#[test]
fn semantic_query_answers_with_opaque_handles() {
    block_on(async {
        let session = open_session().await;
        let facts = session.semantics();

        let symbol = facts
            .symbol_at("/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .expect("symbol at position");
        assert_eq!(symbol.name, "value");

        let value_type = facts
            .type_of(&symbol.id)
            .await
            .unwrap()
            .expect("type of symbol");
        // The rendering Corsa already returned rides along, so the common
        // "what type is this" question costs one request, not two.
        assert_eq!(value_type.text.as_deref(), Some("type-text"));

        // Rendering on demand is still available and stays a separate step.
        assert_eq!(
            facts.type_text(&value_type.id).await.unwrap(),
            "type:string"
        );

        let properties = facts.properties_of(&value_type.id).await.unwrap();
        assert_eq!(properties.len(), 1);
        assert_eq!(properties[0].name, "value");

        let property = facts
            .property_of(&value_type.id, "value")
            .await
            .unwrap()
            .expect("named property");
        assert_eq!(property.id, properties[0].id);

        let signatures = facts
            .signatures_of(&value_type.id, SignatureKind::Call)
            .await
            .unwrap();
        assert_eq!(signatures.len(), 1);
        assert!(
            facts
                .return_type_of(&signatures[0])
                .await
                .unwrap()
                .is_some()
        );

        assert!(
            facts
                .is_assignable(&value_type.id, &value_type.id)
                .await
                .unwrap()
        );

        session.close().await.unwrap();
    });
}

#[test]
fn semantic_query_resolves_names_and_batches() {
    block_on(async {
        let session = open_session().await;
        let facts = session.semantics();

        let symbol = facts
            .resolve_symbol("value", NameMeaning::Value, "/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .expect("resolved symbol");
        assert_eq!(symbol.name, "value");

        let resolved = facts
            .resolve_type("Foo", "/workspace/src/index.ts", 1)
            .await
            .unwrap()
            .expect("resolved type");
        let declared = facts
            .declared_type_of(&symbol.id)
            .await
            .unwrap()
            .expect("declared type");
        assert_eq!(resolved.id, declared.id);

        let batched = facts
            .types_at("/workspace/src/index.ts", vec![1, 2, 3])
            .await
            .unwrap();
        assert_eq!(batched.len(), 3);
        assert!(batched.iter().all(Option::is_some));

        let of_symbols = facts
            .types_of(vec![symbol.id.clone(), symbol.id.clone()])
            .await
            .unwrap();
        assert_eq!(of_symbols.len(), 2);

        session.close().await.unwrap();
    });
}

#[test]
fn a_query_made_after_a_refresh_reads_the_new_snapshot() {
    block_on(async {
        let mut session = open_session().await;

        let before = session
            .semantics()
            .type_at("/workspace/src/index.ts", 1)
            .await
            .unwrap();
        session.refresh(None).await.unwrap();
        let after = session
            .semantics()
            .type_at("/workspace/src/index.ts", 1)
            .await
            .unwrap();

        // `semantics()` borrows the session rather than capturing a snapshot,
        // so each call reads whichever snapshot the session holds now. A query
        // cannot outlive a refresh either way: `refresh` takes `&mut self`, so
        // the borrow checker rejects holding one across it, which is what keeps
        // a query from ever answering out of a stale snapshot.
        assert_eq!(before.map(handle_of), after.map(handle_of));

        session.close().await.unwrap();
    });
}

#[test]
fn semantic_query_version_is_declared() {
    assert_eq!(SEMANTIC_QUERY_VERSION, 1);
}

#[test]
fn name_meaning_matches_upstream_symbol_flags() {
    // `internal/ast/symbolflags.go` in the pinned upstream checkout.
    assert_eq!(NameMeaning::Value.as_wire_value(), 111_551);
    assert_eq!(NameMeaning::Type.as_wire_value(), 788_968);
    assert_eq!(NameMeaning::Namespace.as_wire_value(), 1_920);
    assert_eq!(SignatureKind::Call.as_wire_value(), 0);
    assert_eq!(SignatureKind::Construct.as_wire_value(), 1);
}

fn handle_of(type_ref: TypeRef) -> corsa::api::TypeHandle {
    type_ref.id
}
