mod support;

use corsa::api::{
    ApiClient, ApiMode, ApiSpawnConfig, EncodedSourceFile, SpanMapFeature, SpanMapFidelity,
    SpanMapKind, TextRange, UpdateSnapshotParams,
};
use corsa::runtime::block_on;

/// Opens the mock's project and returns the client plus its snapshot handles.
async fn open_project(mode: ApiMode) -> (ApiClient, corsa::api::ManagedSnapshot) {
    let client = ApiClient::spawn(support::api_config(mode)).await.unwrap();
    let snapshot = client
        .update_snapshot(UpdateSnapshotParams {
            open_project: Some("/workspace/tsconfig.json".into()),
            file_changes: None,
            overlay_changes: None,
        })
        .await
        .unwrap();
    (client, snapshot)
}

#[test]
fn parse_config_file_reports_declared_content_mappers() {
    block_on(async {
        let client = ApiClient::spawn(support::api_config(ApiMode::SyncMsgpackStdio))
            .await
            .unwrap();

        let config = client
            .parse_config_file("/workspace/tsconfig.json")
            .await
            .unwrap();

        assert!(config.uses_content_mappers());
        let mappers = config.content_mappers();
        assert_eq!(mappers.len(), 1);
        assert_eq!(mappers[0].package, "mock-mapper");
        assert!(mappers[0].handles_extension(".vue"));
        client.close().await.unwrap();
    });
}

#[test]
fn source_files_without_a_mapper_decode_without_mapping_state() {
    block_on(async {
        let (client, snapshot) = open_project(ApiMode::SyncMsgpackStdio).await;
        let project = snapshot.projects[0].id.clone();

        // The mock keeps the historic placeholder payload for plain files, so
        // decoding it must fail loudly rather than invent mapping state.
        let payload = client
            .get_source_file(snapshot.handle.clone(), project, "/workspace/src/index.ts")
            .await
            .unwrap()
            .unwrap();

        let error = payload
            .decode_source_file()
            .expect_err("placeholder bytes are not an encoded source file");
        assert!(
            error
                .to_string()
                .contains("shorter than the 44 byte header"),
            "unexpected error: {error}"
        );
        client.close().await.unwrap();
    });
}

#[test]
fn mapped_source_files_expose_their_mapper_and_span_map() {
    block_on(async {
        let (client, snapshot) = open_project(ApiMode::SyncMsgpackStdio).await;
        let project = snapshot.projects[0].id.clone();

        let source_file = client
            .get_encoded_source_file(snapshot.handle.clone(), project, "/workspace/src/App.vue")
            .await
            .unwrap()
            .unwrap();

        assert!(source_file.is_content_mapped());
        assert_eq!(source_file.file_name, "/workspace/src/App.vue");
        assert_eq!(source_file.text, "export const count: number = 1;\n");
        assert_eq!(
            source_file.original_text,
            "<script>\nconst count = 1;\n</script>\n"
        );

        let mapping = source_file.content_mapping().unwrap();
        assert_eq!(mapping.content_mapper, "mock-mapper@1.0.0");
        assert_eq!(mapping.virtual_file_name, "/workspace/src/App.vue.ts");
        assert!(!mapping.is_supplemental());
        assert_eq!(mapping.diagnostic_directives.len(), 1);
        assert_eq!(
            mapping.diagnostic_directives[0].original_range,
            TextRange::new(0, 9)
        );

        let segments = mapping.span_map.segments();
        assert_eq!(segments.len(), 2);
        assert_eq!(segments[0].kind, SpanMapKind::Verbatim);
        assert_eq!(segments[1].kind, SpanMapKind::Atom);
        client.close().await.unwrap();
    });
}

#[test]
fn checker_positions_map_back_into_the_authored_file() {
    block_on(async {
        let (client, snapshot) = open_project(ApiMode::SyncMsgpackStdio).await;
        let project = snapshot.projects[0].id.clone();
        let source_file = client
            .get_encoded_source_file(snapshot.handle.clone(), project, "/workspace/src/App.vue")
            .await
            .unwrap()
            .unwrap();
        let span_map = source_file.span_map().unwrap();

        // `count` sits at offset 13 of the virtual text and offset 15 of the
        // `.vue` file, which is where a diagnostic has to be reported.
        let mapped = span_map.virtual_to_original_span(TextRange::new(13, 18));
        assert_eq!(mapped.range, TextRange::new(15, 20));
        assert_eq!(mapped.fidelity, SpanMapFidelity::Exact);

        // The reverse direction is what an editor request needs.
        let projections = span_map.original_to_virtual_positions(16, SpanMapFeature::HOVER);
        assert_eq!(projections.len(), 1);
        assert_eq!(projections[0].position, 14);

        // Synthesized prologue text has no counterpart in the original file.
        assert_eq!(
            span_map.virtual_to_original_position(2).fidelity,
            SpanMapFidelity::None
        );
        client.close().await.unwrap();
    });
}

#[test]
fn mapped_source_files_decode_over_the_async_transport_too() {
    block_on(async {
        let (client, snapshot) = open_project(ApiMode::AsyncJsonRpcStdio).await;
        let project = snapshot.projects[0].id.clone();

        let source_file = client
            .get_encoded_source_file(snapshot.handle.clone(), project, "/workspace/src/App.vue")
            .await
            .unwrap()
            .unwrap();

        assert_eq!(
            source_file
                .content_mapping()
                .map(|mapping| mapping.content_mapper.as_str()),
            Some("mock-mapper@1.0.0")
        );
        client.close().await.unwrap();
    });
}

#[test]
fn external_code_stays_opt_in() {
    let config = ApiSpawnConfig::new("/opt/bin/corsa");
    assert!(
        !config.run_external_code,
        "mapper processes must not run until a workspace opts in"
    );
    assert!(
        config.with_run_external_code(true).run_external_code,
        "trusted workspaces can enable them"
    );
}

#[test]
fn encoded_source_files_reject_payloads_from_newer_protocols() {
    let mut payload = vec![0_u8; 128];
    payload[3] = 200;

    let error = EncodedSourceFile::decode(&payload).expect_err("a newer payload must not decode");

    assert!(
        error.to_string().contains("protocol version 200"),
        "unexpected error: {error}"
    );
}
