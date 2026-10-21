//! Emulation of the TypeScript 7.1 "derived snapshots" wire dialect.
//!
//! The rest of the mock answers with fixed payloads in the oldest dialect the
//! client supports. This module is different on purpose: it keeps state and
//! rejects what the real runtime rejects, because the behavior under test is
//! the client's adaptation — which snapshot an update derives from, when a
//! handle is released, and whether a symbol comes back as the reference
//! upstream expects. A mock that accepted anything would prove nothing.
//!
//! Enable it with `CORSA_MOCK_DIALECT=derived-snapshots`. Methods this module
//! does not model fall through to the fixed payloads.

use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};

/// Source file node id the emulated program's only user file is known by.
const FILE_NODE_ID: &str = "142";
/// File-owned symbol declared by the emulated file.
const FILE_SYMBOL: u64 = 6;
/// Member of [`FILE_SYMBOL`], owned by the same file.
const FILE_MEMBER_SYMBOL: u64 = 7;
/// Checker-owned symbol, standing in for a lib symbol merged across files.
const CHECKER_SYMBOL: u64 = 9;
/// Checker-owned parameter symbols of the emulated signature, in order.
const PARAMETER_SYMBOLS: [(u64, &str); 2] = [(21, "name"), (20, "times")];
const THIS_PARAMETER_SYMBOL: u64 = 22;
/// Positions at or past this offset resolve to the checker-owned symbol.
const CHECKER_SYMBOL_POSITION: u64 = 1000;

const FILE_TYPE: u64 = 87;
const CHECKER_TYPE: u64 = 40;
const MEMBER_TYPE: u64 = 88;
const SIGNATURE: u64 = 5;

/// Outcome of a request the emulator handled.
pub type Outcome = std::result::Result<Value, String>;

/// Returns the emulator when the environment selects this dialect.
pub fn from_env() -> Option<State> {
    (std::env::var("CORSA_MOCK_DIALECT").as_deref() == Ok("derived-snapshots")).then(State::default)
}

#[derive(Default)]
pub struct State {
    last_snapshot: u64,
    snapshots: BTreeMap<u64, Snapshot>,
}

#[derive(Clone, Default)]
struct Snapshot {
    /// Config file names of the open projects, in the order they were opened.
    projects: Vec<String>,
    /// Checker-owned symbols a response has registered in this snapshot.
    registered: BTreeSet<u64>,
}

impl State {
    /// Handles `method`, or returns `None` to fall through to the fixed payloads.
    pub fn handle(&mut self, method: &str, params: &Value, cwd: &str) -> Option<Outcome> {
        Some(match method {
            "initialize" => Ok(json!({ "caseSensitivity": 1, "currentDirectory": cwd })),
            "createSnapshot" => self.create_snapshot(params),
            "updateSnapshot" => self.update_snapshot(params),
            "release" => self.release(params),
            "batchRequests" => Ok(self.batch(params, cwd)),
            _ => {
                // Everything else addresses a snapshot that must still be alive.
                if let Some(snapshot) = params.get("snapshot")
                    && let Err(error) = self.snapshot(snapshot)
                {
                    return Some(Err(error));
                }
                return self.query(method, params);
            }
        })
    }

    fn create_snapshot(&mut self, params: &Value) -> Outcome {
        let mut snapshot = Snapshot::default();
        let opened = open_projects(&mut snapshot, params);
        Ok(self.install(snapshot, opened, params))
    }

    fn update_snapshot(&mut self, params: &Value) -> Outcome {
        // A 7.0-shaped request carries no base and fails exactly like this
        // against the real runtime.
        let base = params.get("snapshot").unwrap_or(&Value::Null);
        let mut snapshot = self.snapshot(base)?.clone();
        // Checker-owned symbols are registered per snapshot.
        snapshot.registered.clear();
        let changes = params.get("changes").unwrap_or(&Value::Null);
        let opened = open_projects(&mut snapshot, changes);
        Ok(self.install(snapshot, opened, changes))
    }

    /// Registers `snapshot` and renders the response relative to its base.
    fn install(&mut self, snapshot: Snapshot, opened: Vec<String>, changes: &Value) -> Value {
        self.last_snapshot += 1;
        let handle = self.last_snapshot;
        let notified = changed_files(changes);
        let ensured = changes.get("ensurePrograms") == Some(&Value::Bool(true));
        // Only projects that were added or replaced are reported. A file
        // notification replaces every project, and leaves each one dirty
        // unless the request also asked for its program to be rebuilt.
        let reported = if notified.is_empty() {
            opened
        } else {
            snapshot.projects.clone()
        };
        let mut response = json!({
            "snapshot": handle,
            "projects": reported
                .iter()
                .map(|config| project(config, !notified.is_empty() && !ensured))
                .collect::<Vec<_>>(),
            "operation": {},
        });
        if !notified.is_empty() {
            response["changes"] = json!({
                "changedProjects": snapshot
                    .projects
                    .iter()
                    .map(|config| (project_id(config), json!({ "changedFiles": notified })))
                    .collect::<Map<String, Value>>(),
            });
        }
        self.snapshots.insert(handle, snapshot);
        response
    }

    fn release(&mut self, params: &Value) -> Outcome {
        let handle = params.get("snapshot").unwrap_or(&Value::Null);
        self.snapshot(handle)?;
        self.snapshots.remove(&handle.as_u64().unwrap_or_default());
        Ok(json!(true))
    }

    fn batch(&mut self, params: &Value, cwd: &str) -> Value {
        let responses = params
            .get("requests")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|request| {
                let method = request
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let params = request.get("params").unwrap_or(&Value::Null);
                match self.handle(method, params, cwd) {
                    Some(Ok(result)) => json!({ "method": method, "result": result }),
                    Some(Err(error)) => json!({ "method": method, "error": error }),
                    None => json!({ "method": method, "result": null }),
                }
            })
            .collect::<Vec<_>>();
        json!({ "responses": responses })
    }

    fn query(&mut self, method: &str, params: &Value) -> Option<Outcome> {
        let handle = params.get("snapshot").and_then(Value::as_u64);
        let project = params
            .get("project")
            .and_then(Value::as_str)
            .unwrap_or_default();
        Some(match method {
            "getSymbolAtPosition" => Ok(file_symbol(FILE_SYMBOL, "value")),
            "getTypeAtPosition" => Ok(
                if params.get("position").and_then(Value::as_u64) >= Some(CHECKER_SYMBOL_POSITION) {
                    type_response(CHECKER_TYPE, json!({ "id": CHECKER_SYMBOL }))
                } else {
                    type_response(FILE_TYPE, file_mention(FILE_SYMBOL))
                },
            ),
            "getSymbolOfType" => match params.get("objectId").and_then(Value::as_u64) {
                Some(CHECKER_TYPE) => {
                    Ok(self.checker_symbol(handle?, project, CHECKER_SYMBOL, "Promise"))
                }
                Some(FILE_TYPE) => Ok(file_symbol(FILE_SYMBOL, "value")),
                Some(MEMBER_TYPE) => Ok(file_symbol(FILE_MEMBER_SYMBOL, "greet")),
                _ => Err("api: client error: empty type handle".into()),
            },
            "getMembersOfSymbol" => self
                .resolve_symbol(params.get("symbol"), None)
                .map(|_| json!([file_symbol(FILE_MEMBER_SYMBOL, "greet")])),
            "getTypeOfSymbol" => self
                .resolve_symbol(params.get("symbol"), handle)
                .map(symbol_type),
            "getTypesOfSymbols" => params
                .get("symbols")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|symbol| self.resolve_symbol(Some(symbol), handle).map(symbol_type))
                .collect::<std::result::Result<Vec<_>, _>>()
                .map(Value::Array),
            "getSignaturesOfType" => Ok(json!([{
                "id": SIGNATURE,
                "flags": 0,
                "parameters": PARAMETER_SYMBOLS
                    .iter()
                    .map(|(id, _)| json!({ "id": id }))
                    .collect::<Vec<_>>(),
                "thisParameter": { "id": THIS_PARAMETER_SYMBOL },
            }])),
            "getParametersOfSignature" => Ok(Value::Array(
                PARAMETER_SYMBOLS
                    .iter()
                    .map(|(id, name)| {
                        self.checker_symbol(handle.unwrap_or_default(), project, *id, name)
                    })
                    .collect(),
            )),
            "getThisParameterOfSignature" => {
                Ok(self.checker_symbol(handle?, project, THIS_PARAMETER_SYMBOL, "this"))
            }
            "getWellKnownSymbols" => {
                let registered = &mut self.snapshots.get_mut(&handle?)?.registered;
                registered.extend([1, 2, 3]);
                Ok(json!({ "unknown": 1, "undefined": 2, "arguments": 3 }))
            }
            _ => return None,
        })
    }

    fn snapshot(&self, handle: &Value) -> std::result::Result<&Snapshot, String> {
        let handle = handle.as_u64().unwrap_or_default();
        self.snapshots
            .get(&handle)
            .ok_or_else(|| format!("api: client error: snapshot {handle} not found"))
    }

    /// Registers a checker-owned symbol and answers with its full reference.
    fn checker_symbol(&mut self, snapshot: u64, project: &str, id: u64, name: &str) -> Value {
        if let Some(state) = self.snapshots.get_mut(&snapshot) {
            state.registered.insert(id);
        }
        json!({
            "reference": { "kind": 1, "snapshot": snapshot, "project": project, "id": id },
            "name": name,
            "flags": 33554432,
            "checkFlags": 0,
        })
    }

    /// Resolves a `SymbolReference` the way the real runtime does, including
    /// the ways it refuses one.
    fn resolve_symbol(
        &self,
        reference: Option<&Value>,
        requested: Option<u64>,
    ) -> std::result::Result<u64, String> {
        let Some(reference) = reference.and_then(Value::as_object) else {
            return Err("api: invalid request: failed to unmarshal *api.SymbolReference".into());
        };
        let id = reference
            .get("id")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        match reference.get("kind").and_then(Value::as_u64) {
            Some(0) => {
                if reference.get("file") != Some(&descriptor())
                    || reference.contains_key("snapshot")
                    || reference.contains_key("project")
                {
                    return Err("api: client error: invalid file symbol reference".into());
                }
                Ok(id)
            }
            Some(1) => {
                let owner = reference.get("snapshot").and_then(Value::as_u64);
                if reference.contains_key("file")
                    || owner.is_none()
                    || reference
                        .get("project")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .is_empty()
                {
                    return Err("api: client error: invalid snapshot symbol reference".into());
                }
                if requested.is_some() && owner != requested {
                    return Err(
                        "api: client error: snapshot symbol reference does not match the requested checker"
                            .into(),
                    );
                }
                let registered = owner
                    .and_then(|owner| self.snapshots.get(&owner))
                    .is_some_and(|snapshot| snapshot.registered.contains(&id));
                if !registered {
                    return Err(format!(
                        "api: client error: symbol handle {id} not found in snapshot registry"
                    ));
                }
                Ok(id)
            }
            kind => Err(format!(
                "api: client error: invalid symbol reference kind {}",
                kind.unwrap_or_default()
            )),
        }
    }
}

/// Opens the projects `changes` names and returns the ones that are new.
fn open_projects(snapshot: &mut Snapshot, changes: &Value) -> Vec<String> {
    let mut opened = Vec::new();
    for config in changes
        .get("openProjects")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        if !snapshot.projects.iter().any(|known| known == config) {
            snapshot.projects.push(config.to_owned());
            opened.push(config.to_owned());
        }
    }
    opened
}

fn changed_files(changes: &Value) -> Vec<Value> {
    let Some(notifications) = changes.get("fileNotifications") else {
        return Vec::new();
    };
    if notifications.get("invalidateAll") == Some(&Value::Bool(true)) {
        return vec![json!("/workspace/src/index.ts")];
    }
    ["changed", "created", "deleted"]
        .iter()
        .filter_map(|key| notifications.get(*key).and_then(Value::as_array))
        .flatten()
        .cloned()
        .collect()
}

fn project_id(config: &str) -> String {
    config.to_lowercase()
}

fn project(config: &str, dirty: bool) -> Value {
    json!({
        "id": project_id(config),
        "configFileName": config,
        "currentDirectory": "/workspace",
        "dirty": dirty,
        "rootFiles": ["/workspace/src/index.ts"],
        "compilerOptions": { "strict": true, "module": 99 },
    })
}

fn descriptor() -> Value {
    json!({
        "fileName": "/workspace/src/index.ts",
        "path": "/workspace/src/index.ts",
        "contentHash": "e124f257e46e948e015e80de9a4d5942",
        "parseOptionsKey": "0",
        "scriptKind": 3,
        "nodeId": FILE_NODE_ID,
    })
}

fn file_mention(id: u64) -> Value {
    json!({ "id": id, "file": FILE_NODE_ID })
}

fn file_symbol(id: u64, name: &str) -> Value {
    json!({
        "reference": { "kind": 0, "file": descriptor(), "id": id },
        "name": name,
        "flags": 2,
        "checkFlags": 0,
        "declarations": ["1.3.80./workspace/src/index.ts"],
        "valueDeclaration": "1.3.80./workspace/src/index.ts",
        // Mentions outside the client's typed API, sent the way upstream sends them.
        "parent": file_mention(FILE_SYMBOL),
    })
}

fn type_response(id: u64, symbol: Value) -> Value {
    json!({
        "id": id,
        "flags": 524288,
        "objectFlags": 1,
        "symbol": symbol,
        "texts": [format!("type-of-{id}")],
    })
}

/// Renders the type the emulated checker assigns to a resolved symbol.
fn symbol_type(symbol: u64) -> Value {
    match symbol {
        FILE_MEMBER_SYMBOL => type_response(MEMBER_TYPE, file_mention(FILE_MEMBER_SYMBOL)),
        CHECKER_SYMBOL => type_response(CHECKER_TYPE, json!({ "id": CHECKER_SYMBOL })),
        id if PARAMETER_SYMBOLS
            .iter()
            .any(|(parameter, _)| *parameter == id) =>
        {
            json!({ "id": 100 + id, "flags": 4, "texts": [format!("parameter-{id}")] })
        }
        _ => type_response(FILE_TYPE, file_mention(FILE_SYMBOL)),
    }
}
