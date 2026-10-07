//! Contract tests that must hold on every wire dialect the client adapts.
//!
//! Each case states what the public API promises and runs it against whichever
//! real runtime the workspace resolved. Point `CORSA_EXECUTABLE` at a
//! TypeScript 7.0 runtime and at a TypeScript 7.1 one to exercise both
//! adapters with the same assertions.

mod support;

use std::{fs, path::Path, sync::Arc};

use corsa::{
    api::{
        ApiClient, ApiFileSystem, ApiMode, ApiSpawnConfig, DocumentIdentifier, FileChangeSummary,
        FileChanges, FileSystemCapabilities, ManagedSnapshot, ProjectHandle, ReadFileResult,
        SymbolHandle, TypeHandle, UpdateSnapshotParams,
    },
    runtime::block_on,
};
use tempfile::tempdir;

const MODES: [ApiMode; 2] = [ApiMode::SyncMsgpackStdio, ApiMode::AsyncJsonRpcStdio];

const TSCONFIG: &str = r#"{
  "compilerOptions": { "strict": true, "target": "ES2022", "module": "ESNext", "noEmit": true },
  "include": ["src/**/*.ts"]
}"#;

#[test]
fn snapshot_updates_accumulate_and_observe_reported_file_changes() {
    block_on(async {
        let Some(binary) = support::resolved_real_corsa_binary() else {
            return;
        };
        for mode in MODES {
            let project = fixture(&[
                ("tsconfig.json", TSCONFIG),
                ("src/index.ts", "export const answer = 42;\n"),
            ]);
            let file = project.path().join("src/index.ts");
            let client = spawn(&binary, mode, project.path()).await;

            let opened = open(&client, &project.path().join("tsconfig.json")).await;
            assert_eq!(opened.projects.len(), 1, "{mode:?}");
            let project_id = opened.projects[0].id.clone();
            assert_eq!(
                render_type_at(&client, &opened, &project_id, &file, "answer").await,
                "42",
                "{mode:?}"
            );

            fs::write(&file, "export const answer = \"changed\";\n").unwrap();
            // Nothing holds the first snapshot any more. The update below must
            // still build on it rather than start from an empty session.
            drop(opened);
            let updated = client
                .update_snapshot(UpdateSnapshotParams {
                    open_project: None,
                    file_changes: Some(FileChanges::Summary(FileChangeSummary {
                        changed: vec![DocumentIdentifier::from(wire(&file))],
                        created: Vec::new(),
                        deleted: Vec::new(),
                    })),
                    overlay_changes: None,
                })
                .await
                .unwrap();

            assert_eq!(
                updated
                    .projects
                    .iter()
                    .map(|project| &project.id)
                    .collect::<Vec<_>>(),
                [&project_id],
                "an update that opens nothing still lists every open project ({mode:?})"
            );
            assert_eq!(
                render_type_at(&client, &updated, &project_id, &file, "answer").await,
                "\"changed\"",
                "{mode:?}"
            );

            client.close().await.unwrap();
        }
    });
}

#[test]
fn opening_another_project_keeps_the_ones_already_open() {
    block_on(async {
        let Some(binary) = support::resolved_real_corsa_binary() else {
            return;
        };
        for mode in MODES {
            let workspace = fixture(&[
                ("app/tsconfig.json", TSCONFIG),
                ("app/src/index.ts", "export const app = 1;\n"),
                ("lib/tsconfig.json", TSCONFIG),
                ("lib/src/index.ts", "export const lib = \"lib\";\n"),
            ]);
            let client = spawn(&binary, mode, workspace.path()).await;

            let app = open(&client, &workspace.path().join("app/tsconfig.json")).await;
            let both = open(&client, &workspace.path().join("lib/tsconfig.json")).await;

            assert_eq!(app.projects.len(), 1, "{mode:?}");
            assert_eq!(both.projects.len(), 2, "{mode:?}");
            assert!(
                both.projects
                    .iter()
                    .any(|project| project.id == app.projects[0].id),
                "{mode:?}"
            );
            // Both snapshots stay queryable side by side.
            let app_file = workspace.path().join("app/src/index.ts");
            let lib_file = workspace.path().join("lib/src/index.ts");
            let lib_project = both
                .projects
                .iter()
                .find(|project| project.id != app.projects[0].id)
                .unwrap()
                .id
                .clone();
            assert_eq!(
                render_type_at(&client, &app, &app.projects[0].id, &app_file, "app").await,
                "1",
                "{mode:?}"
            );
            assert_eq!(
                render_type_at(&client, &both, &lib_project, &lib_file, "lib").await,
                "\"lib\"",
                "{mode:?}"
            );

            // Releasing explicitly is idempotent, whether or not the client
            // still pins the snapshot as the base of the next update.
            both.release().await.unwrap();
            both.release().await.unwrap();
            app.release().await.unwrap();

            client.close().await.unwrap();
        }
    });
}

#[test]
fn symbol_handles_are_comparable_and_usable_across_responses() {
    block_on(async {
        let Some(binary) = support::resolved_real_corsa_binary() else {
            return;
        };
        for mode in MODES {
            let project = fixture(&[
                ("tsconfig.json", TSCONFIG),
                (
                    "src/index.ts",
                    r#"export class Greeter {
  greet(name: string, times: number): string {
    return name.repeat(times);
  }
}
export const greeter = new Greeter();
export const pending = Promise.resolve(1);
"#,
                ),
            ]);
            let file = project.path().join("src/index.ts");
            let text = fs::read_to_string(&file).unwrap();
            let client = spawn(&binary, mode, project.path()).await;
            let snapshot = open(&client, &project.path().join("tsconfig.json")).await;
            let project_id = snapshot.projects[0].id.clone();

            // A symbol looked up directly can be sent straight back.
            let greeter = client
                .get_symbol_at_position(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    wire(&file),
                    offset(&text, "greeter ="),
                )
                .await
                .unwrap()
                .expect("symbol for `greeter`");
            assert_eq!(greeter.name, "greeter", "{mode:?}");
            let greeter_type = client
                .get_type_of_symbol(snapshot.handle.clone(), project_id.clone(), greeter.id)
                .await
                .unwrap()
                .expect("type of `greeter`");

            // A symbol a type only mentions is the same handle the dedicated
            // endpoint answers with, and once answered it is usable as-is.
            let mentioned = greeter_type
                .symbol
                .clone()
                .expect("class instance type mentions its symbol");
            let resolved = client
                .get_symbol_of_type_in_project(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    greeter_type.id.clone(),
                )
                .await
                .unwrap()
                .expect("symbol of the class instance type");
            assert_eq!(resolved.name, "Greeter", "{mode:?}");
            assert_eq!(mentioned, resolved.id, "{mode:?}");
            let members = client
                .get_members_of_symbol_in_project(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    mentioned,
                )
                .await
                .unwrap();
            let greet = members
                .iter()
                .find(|member| member.name == "greet")
                .unwrap_or_else(|| panic!("`greet` among {members:?} ({mode:?})"));

            // The parameters a signature mentions are the symbols its own
            // endpoint answers with, in order, and resolve to their types.
            let greet_type = client
                .get_type_of_symbol(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    greet.id.clone(),
                )
                .await
                .unwrap()
                .expect("type of `greet`");
            let signatures = client
                .get_signatures_of_type(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    greet_type.id,
                    0,
                )
                .await
                .unwrap();
            assert_eq!(signatures.len(), 1, "{mode:?}");
            let parameters = client
                .get_parameters_of_signature(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    signatures[0].id.clone(),
                )
                .await
                .unwrap();
            assert_eq!(
                parameters
                    .iter()
                    .map(|parameter| parameter.name.as_str())
                    .collect::<Vec<_>>(),
                ["name", "times"],
                "{mode:?}"
            );
            assert_eq!(
                signatures[0].parameters,
                parameters
                    .iter()
                    .map(|parameter| parameter.id.clone())
                    .collect::<Vec<_>>(),
                "{mode:?}"
            );
            assert_eq!(
                render_symbol_types(
                    &client,
                    &snapshot,
                    &project_id,
                    signatures[0].parameters.clone()
                )
                .await,
                ["string", "number"],
                "{mode:?}"
            );

            // `Promise` is merged from several lib files, so the checker owns
            // its symbol rather than any one source file.
            let pending_type =
                type_at(&client, &snapshot, &project_id, &file, &text, "pending =").await;
            let promise = pending_type
                .symbol
                .clone()
                .expect("promise type mentions its symbol");
            let promise_symbol = client
                .get_symbol_of_type_in_project(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    pending_type.id,
                )
                .await
                .unwrap()
                .expect("symbol of the promise type");
            assert_eq!(promise_symbol.name, "Promise", "{mode:?}");
            assert_eq!(promise, promise_symbol.id, "{mode:?}");
            let promise_members = client
                .get_members_of_symbol_in_project(
                    snapshot.handle.clone(),
                    project_id.clone(),
                    promise,
                )
                .await
                .unwrap();
            assert!(
                promise_members.iter().any(|member| member.name == "then"),
                "`then` among {promise_members:?} ({mode:?})"
            );

            client.close().await.unwrap();
        }
    });
}

#[test]
fn filesystem_callbacks_shadow_files_on_disk() {
    block_on(async {
        let Some(binary) = support::resolved_real_corsa_binary() else {
            return;
        };
        for mode in MODES {
            let project = fixture(&[
                ("tsconfig.json", TSCONFIG),
                ("src/index.ts", "export const answer = 42;\n"),
            ]);
            let file = project.path().join("src/index.ts");
            let client = ApiClient::spawn(
                ApiSpawnConfig::new(binary.clone())
                    .with_mode(mode)
                    .with_cwd(project.path())
                    .with_filesystem(Arc::new(ShadowFile {
                        suffix: "src/index.ts",
                        contents: "export const answer = \"virtual\";\n",
                    })),
            )
            .await
            .unwrap();
            let snapshot = open(&client, &project.path().join("tsconfig.json")).await;

            assert_eq!(
                render_type_at(
                    &client,
                    &snapshot,
                    &snapshot.projects[0].id,
                    &file,
                    "answer"
                )
                .await,
                "\"virtual\"",
                "{mode:?}"
            );

            client.close().await.unwrap();
        }
    });
}

/// Serves one file from memory and defers everything else to the runtime.
struct ShadowFile {
    suffix: &'static str,
    contents: &'static str,
}

impl ApiFileSystem for ShadowFile {
    fn capabilities(&self) -> FileSystemCapabilities {
        FileSystemCapabilities {
            read_file: true,
            ..FileSystemCapabilities::default()
        }
    }

    fn read_file(&self, path: &str) -> ReadFileResult {
        if path.replace('\\', "/").ends_with(self.suffix) {
            ReadFileResult::Content(self.contents.into())
        } else {
            ReadFileResult::Fallback
        }
    }
}

async fn spawn(binary: &Path, mode: ApiMode, cwd: &Path) -> ApiClient {
    ApiClient::spawn(ApiSpawnConfig::new(binary).with_mode(mode).with_cwd(cwd))
        .await
        .unwrap()
}

async fn open(client: &ApiClient, config: &Path) -> ManagedSnapshot {
    client
        .update_snapshot(UpdateSnapshotParams {
            open_project: Some(config.display().to_string()),
            file_changes: None,
            overlay_changes: None,
        })
        .await
        .unwrap()
}

async fn type_at(
    client: &ApiClient,
    snapshot: &ManagedSnapshot,
    project: &ProjectHandle,
    file: &Path,
    text: &str,
    needle: &str,
) -> corsa::api::TypeResponse {
    client
        .get_type_at_position(
            snapshot.handle.clone(),
            project.clone(),
            wire(file),
            offset(text, needle),
        )
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("type at `{needle}`"))
}

/// Renders the type of the declaration named `name` in `file`.
async fn render_type_at(
    client: &ApiClient,
    snapshot: &ManagedSnapshot,
    project: &ProjectHandle,
    file: &Path,
    name: &str,
) -> String {
    let text = fs::read_to_string(file).unwrap();
    let needle = format!("{name} =");
    let found = type_at(client, snapshot, project, file, &text, &needle).await;
    render(client, snapshot, project, found.id).await
}

async fn render(
    client: &ApiClient,
    snapshot: &ManagedSnapshot,
    project: &ProjectHandle,
    found: TypeHandle,
) -> String {
    client
        .type_to_string(snapshot.handle.clone(), project.clone(), found, None, None)
        .await
        .unwrap()
}

async fn render_symbol_types(
    client: &ApiClient,
    snapshot: &ManagedSnapshot,
    project: &ProjectHandle,
    symbols: Vec<SymbolHandle>,
) -> Vec<String> {
    let types = client
        .get_types_of_symbols(snapshot.handle.clone(), project.clone(), symbols)
        .await
        .unwrap();
    let mut rendered = Vec::with_capacity(types.len());
    for found in types {
        let found = found.expect("type for every symbol");
        rendered.push(render(client, snapshot, project, found.id).await);
    }
    rendered
}

/// Renders a path the way the tests hand documents to the API.
fn wire(path: &Path) -> String {
    path.display().to_string()
}

fn offset(text: &str, needle: &str) -> u32 {
    u32::try_from(
        text.find(needle)
            .unwrap_or_else(|| panic!("`{needle}` in fixture")),
    )
    .unwrap()
}

fn fixture(files: &[(&str, &str)]) -> tempfile::TempDir {
    let project = tempdir().unwrap();
    for (relative, contents) in files {
        let path = project.path().join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }
    project
}
