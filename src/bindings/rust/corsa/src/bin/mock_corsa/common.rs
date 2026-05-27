use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

pub fn project(config_file_name: &str) -> Value {
    json!({
        "id": "p./workspace/tsconfig.json",
        "configFileName": config_file_name,
        "compilerOptions": { "strict": true, "module": "esnext" },
        "rootFiles": ["/workspace/src/index.ts"],
    })
}

pub fn snapshot_from_update_params(config_file_name: &str, params: &Value) -> Value {
    let changed_files = extract_changed_files(params);
    snapshot_with_changed_files(
        config_file_name,
        if changed_files.is_empty() {
            vec!["/workspace/src/index.ts".to_owned()]
        } else {
            changed_files
        },
    )
}

fn snapshot_with_changed_files(config_file_name: &str, changed_files: Vec<String>) -> Value {
    json!({
        "snapshot": "n0000000000000001",
        "projects": [project(config_file_name)],
        "changes": {
            "changedProjects": {
                "p./workspace/tsconfig.json": {
                    "changedFiles": changed_files,
                    "deletedFiles": []
                }
            },
            "removedProjects": []
        }
    })
}

pub fn symbol(name: &str) -> Value {
    json!({
        "id": "s0000000000000001",
        "name": name,
        "flags": 2,
        "checkFlags": 0,
        "declarations": ["1.3.80./workspace/src/index.ts"],
        "valueDeclaration": "1.3.80./workspace/src/index.ts",
    })
}

pub fn type_response(id: &str) -> Value {
    json!({
        "id": id,
        "flags": 262144,
        "objectFlags": 16,
        "symbol": "s0000000000000001",
        "texts": ["type-text"],
    })
}

pub fn signature() -> Value {
    json!({
        "id": "g0000000000000001",
        "flags": 1,
        "declaration": "1.3.80./workspace/src/index.ts",
        "typeParameters": ["t0000000000000002"],
        "parameters": ["s0000000000000001"],
        "thisParameter": "s0000000000000002",
    })
}

pub fn type_predicate() -> Value {
    json!({
        "kind": 1,
        "parameterIndex": 0,
        "parameterName": "value",
        "type": type_response("t0000000000000003"),
    })
}

pub fn index_info() -> Value {
    json!({
        "keyType": type_response("t0000000000000004"),
        "valueType": type_response("t0000000000000005"),
        "isReadonly": true,
    })
}

pub fn encoded(bytes: &[u8]) -> Value {
    json!({ "data": STANDARD.encode(bytes) })
}

pub fn capabilities() -> Value {
    json!({
        "overlay": {
            "updateSnapshotOverlayChanges": true
        },
        "diagnostics": {
            "snapshot": true,
            "project": true,
            "file": true
        },
        "editor": {
            "hover": true,
            "definition": true,
            "references": true,
            "rename": true,
            "completion": true
        }
    })
}

pub fn file_diagnostics(file: Value) -> Value {
    json!({
        "file": file,
        "syntactic": [diagnostic("TS1005", "expected ';'")],
        "semantic": [diagnostic("TS2322", "type mismatch")],
        "suggestion": [diagnostic("TS80006", "convert to shorthand")]
    })
}

pub fn project_diagnostics(file: Value) -> Value {
    json!({
        "project": "p./workspace/tsconfig.json",
        "files": [file_diagnostics(file)]
    })
}

pub fn snapshot_diagnostics(file: Value) -> Value {
    json!({
        "snapshot": "n0000000000000001",
        "projects": [project_diagnostics(file)]
    })
}

pub fn hover() -> Value {
    json!({
        "contents": {
            "kind": "markdown",
            "value": "`value`: string"
        },
        "range": range()
    })
}

pub fn definition() -> Value {
    json!([location()])
}

pub fn references() -> Value {
    json!([location(), secondary_location()])
}

pub fn rename(new_name: &str) -> Value {
    json!({
        "changes": {
            "file:///workspace/src/index.ts": [
                {
                    "range": range(),
                    "newText": new_name
                }
            ]
        }
    })
}

pub fn completion() -> Value {
    json!({
        "isIncomplete": false,
        "items": [
            {
                "label": "value",
                "kind": 6,
                "detail": "const value: string"
            }
        ]
    })
}

fn extract_changed_files(params: &Value) -> Vec<String> {
    let mut files = Vec::new();
    if let Some(file_changes) = params.get("fileChanges") {
        push_documents(
            &mut files,
            file_changes
                .get("changed")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );
        push_documents(
            &mut files,
            file_changes
                .get("created")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );
        push_documents(
            &mut files,
            file_changes
                .get("deleted")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );
    }
    if let Some(overlay_changes) = params.get("overlayChanges") {
        push_documents(
            &mut files,
            overlay_changes
                .get("upsert")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|entry| entry.get("document")),
        );
        push_documents(
            &mut files,
            overlay_changes
                .get("delete")
                .and_then(Value::as_array)
                .into_iter()
                .flatten(),
        );
    }
    files
}

fn push_documents<'a>(files: &mut Vec<String>, documents: impl IntoIterator<Item = &'a Value>) {
    for document in documents {
        if let Some(path) = document.as_str() {
            files.push(path.to_owned());
        } else if let Some(uri) = document.get("uri").and_then(Value::as_str) {
            files.push(uri.to_owned());
        }
    }
}

fn diagnostic(code: &str, message: &str) -> Value {
    json!({
        "range": range(),
        "severity": 1,
        "code": code,
        "source": "mock-corsa",
        "message": message
    })
}

fn location() -> Value {
    json!({
        "uri": "file:///workspace/src/index.ts",
        "range": range()
    })
}

fn secondary_location() -> Value {
    json!({
        "uri": "file:///workspace/src/other.ts",
        "range": range()
    })
}

fn range() -> Value {
    json!({
        "start": { "line": 0, "character": 0 },
        "end": { "line": 0, "character": 5 }
    })
}
