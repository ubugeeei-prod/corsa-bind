use std::{
    fs,
    sync::{Arc, Mutex},
};

use corsa::{
    CorsaError,
    api::{
        ApiClient, ManagedSnapshot, NodeHandle, ProjectHandle, SignatureResponse, SnapshotHandle,
        SymbolHandle, SymbolResponse, TypeHandle, TypeResponse, UpdateSnapshotParams,
    },
    fast::{CompactString, FastMap},
    runtime::block_on,
};
use napi::{
    Env, Result, ScopedTask, Task,
    bindgen_prelude::{AsyncTask, Buffer, Unknown},
};
use napi_derive::napi;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::util::{
    SpawnOptions, build_spawn_config, from_optional_value, from_value, into_napi_error,
    optional_value, to_value,
};

const OBJECT_FLAGS_REFERENCE: u32 = 1 << 2;
const OBJECT_FLAGS_MAPPED: u32 = 1 << 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotState<'a> {
    snapshot: &'a SnapshotHandle,
    projects: &'a [corsa::api::ProjectResponse],
    #[serde(skip_serializing_if = "Option::is_none")]
    changes: &'a Option<corsa::api::SnapshotChanges>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeProjectParams {
    snapshot: String,
    project: String,
    #[serde(rename = "type")]
    type_handle: String,
    #[serde(default)]
    texts: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TypeOnlyParams {
    snapshot: String,
    #[serde(rename = "type")]
    type_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignatureOfTypeParams {
    snapshot: String,
    project: String,
    #[serde(rename = "type")]
    type_handle: String,
    kind: i32,
    file: Option<String>,
    source_text: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallSignatureFactsParams {
    snapshot: String,
    project: String,
    #[serde(rename = "type")]
    type_handle: String,
    kind: i32,
    file: Option<String>,
    source_text: Option<String>,
    #[serde(default)]
    argument_type_texts: Vec<Vec<String>>,
    #[serde(default)]
    explicit_type_argument_texts: Vec<String>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallSignatureFactsResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<SignatureResponse>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    expected_argument_type_texts: Vec<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    explicit_type_arguments_required: Option<bool>,
}

struct SignatureSourceOverride {
    file: String,
    source_text: String,
}

struct CallSignatureFactsLookup<'a> {
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    r#type: TypeHandle,
    kind: i32,
    source_override: Option<&'a SignatureSourceOverride>,
    argument_type_texts: Vec<Vec<String>>,
    explicit_type_argument_texts: Vec<String>,
}

fn signature_source_override(
    file: Option<String>,
    source_text: Option<String>,
) -> Option<SignatureSourceOverride> {
    Some(SignatureSourceOverride {
        file: file?,
        source_text: source_text?,
    })
}

struct SourceRangeLookup {
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    file: String,
    start: u32,
    end: u32,
    source_text: String,
    kind: Option<String>,
}

struct TypeArgumentsSourceRangeLookup {
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    type_handle: TypeHandle,
    object_flags: Option<u32>,
    file: String,
    start: u32,
    end: u32,
    source_text: String,
}

type SnapshotStore = Arc<Mutex<FastMap<CompactString, ManagedSnapshot>>>;

pub struct SpawnApiClientTask {
    options: Option<SpawnOptions>,
}

#[napi]
impl Task for SpawnApiClientTask {
    type Output = CorsaApiClient;
    type JsValue = CorsaApiClient;

    fn compute(&mut self) -> Result<Self::Output> {
        let options = self
            .options
            .take()
            .ok_or_else(|| into_napi_error("spawn options were already consumed"))?;
        let inner =
            block_on(ApiClient::spawn(build_spawn_config(options)?)).map_err(into_napi_error)?;
        Ok(CorsaApiClient {
            inner,
            snapshots: Arc::new(Mutex::new(FastMap::default())),
        })
    }

    fn resolve(&mut self, _: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

enum JsonTaskKind {
    Initialize,
    ParseConfigFile {
        file: String,
    },
    UpdateSnapshot {
        params: Option<Value>,
        snapshots: SnapshotStore,
    },
    GetStringType {
        snapshot: String,
        project: String,
    },
    GetTypeAtPosition {
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    },
    GetTypeAtSourceRange {
        snapshot: String,
        project: String,
        file: String,
        start: u32,
        end: u32,
        source_text: String,
        kind: Option<String>,
    },
    GetSymbolAtPosition {
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    },
    GetSymbolOfType {
        snapshot: String,
        type_handle: String,
    },
    GetTypeArguments {
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
    },
    GetTypeArgumentsAtSourceRange {
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
        file: String,
        start: u32,
        end: u32,
        source_text: String,
    },
    GetTypeOfSymbol {
        snapshot: String,
        project: String,
        symbol: String,
    },
    GetDeclaredTypeOfSymbol {
        snapshot: String,
        project: String,
        symbol: String,
    },
    GetConstraintOfType {
        snapshot: String,
        project: String,
        type_handle: String,
    },
    TypeToString {
        snapshot: String,
        project: String,
        type_handle: String,
        location: Option<String>,
        flags: Option<i32>,
    },
    CallJson {
        method: String,
        params: Option<Value>,
    },
}

pub struct JsonApiTask {
    client: ApiClient,
    kind: JsonTaskKind,
}

impl<'task> ScopedTask<'task> for JsonApiTask {
    type Output = Value;
    type JsValue = Unknown<'task>;

    fn compute(&mut self) -> Result<Self::Output> {
        match &mut self.kind {
            JsonTaskKind::Initialize => {
                let response = block_on(self.client.initialize()).map_err(into_napi_error)?;
                to_value(response.as_ref())
            }
            JsonTaskKind::ParseConfigFile { file } => {
                let response = block_on(self.client.parse_config_file(file.clone()))
                    .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::UpdateSnapshot { params, snapshots } => {
                let params = from_optional_value::<UpdateSnapshotParams>(params.take())?;
                let snapshot =
                    block_on(self.client.update_snapshot(params)).map_err(into_napi_error)?;
                let handle = snapshot.handle.clone();
                let state = to_value(&SnapshotState {
                    snapshot: &snapshot.handle,
                    projects: snapshot.projects.as_slice(),
                    changes: &snapshot.changes,
                })?;
                snapshots
                    .lock()
                    .map_err(into_napi_error)?
                    .insert(CompactString::from(handle.as_str()), snapshot);
                Ok(state)
            }
            JsonTaskKind::GetStringType { snapshot, project } => {
                let response = block_on(self.client.get_string_type(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetTypeAtPosition {
                snapshot,
                project,
                file,
                position,
            } => {
                let response = block_on(self.client.get_type_at_position(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    file.clone(),
                    *position,
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetTypeAtSourceRange {
                snapshot,
                project,
                file,
                start,
                end,
                source_text,
                kind,
            } => {
                let response = block_on(get_type_at_source_range(
                    &self.client,
                    SourceRangeLookup {
                        snapshot: SnapshotHandle::from(snapshot.as_str()),
                        project: ProjectHandle::from(project.as_str()),
                        file: file.clone(),
                        start: *start,
                        end: *end,
                        source_text: source_text.clone(),
                        kind: kind.clone(),
                    },
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetSymbolAtPosition {
                snapshot,
                project,
                file,
                position,
            } => {
                let response = block_on(self.client.get_symbol_at_position(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    file.clone(),
                    *position,
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetSymbolOfType {
                snapshot,
                type_handle,
            } => {
                let response = block_on(self.client.get_symbol_of_type(
                    SnapshotHandle::from(snapshot.as_str()),
                    TypeHandle::from(type_handle.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetTypeArguments {
                snapshot,
                project,
                type_handle,
                object_flags,
            } => {
                if object_flags.unwrap_or_default() & (OBJECT_FLAGS_REFERENCE | OBJECT_FLAGS_MAPPED)
                    == 0
                {
                    return to_value(&Vec::<corsa::api::TypeResponse>::new());
                }
                let response = block_on(self.client.get_type_arguments(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    TypeHandle::from(type_handle.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetTypeArgumentsAtSourceRange {
                snapshot,
                project,
                type_handle,
                object_flags,
                file,
                start,
                end,
                source_text,
            } => {
                let response = block_on(get_type_arguments_at_source_range(
                    &self.client,
                    TypeArgumentsSourceRangeLookup {
                        snapshot: SnapshotHandle::from(snapshot.as_str()),
                        project: ProjectHandle::from(project.as_str()),
                        type_handle: TypeHandle::from(type_handle.as_str()),
                        object_flags: *object_flags,
                        file: file.clone(),
                        start: *start,
                        end: *end,
                        source_text: source_text.clone(),
                    },
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetTypeOfSymbol {
                snapshot,
                project,
                symbol,
            } => {
                let response = block_on(self.client.get_type_of_symbol(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    SymbolHandle::from(symbol.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetDeclaredTypeOfSymbol {
                snapshot,
                project,
                symbol,
            } => {
                let response = block_on(self.client.get_declared_type_of_symbol(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    SymbolHandle::from(symbol.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::GetConstraintOfType {
                snapshot,
                project,
                type_handle,
            } => {
                let response = block_on(self.client.get_constraint_of_type(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    TypeHandle::from(type_handle.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_value(&response)
            }
            JsonTaskKind::TypeToString {
                snapshot,
                project,
                type_handle,
                location,
                flags,
            } => {
                let text = block_on(
                    self.client.type_to_string(
                        SnapshotHandle::from(snapshot.as_str()),
                        ProjectHandle::from(project.as_str()),
                        TypeHandle::from(type_handle.as_str()),
                        location
                            .as_ref()
                            .map(|value| corsa::api::NodeHandle::from(value.as_str())),
                        *flags,
                    ),
                )
                .map_err(into_napi_error)?;
                Ok(Value::String(text))
            }
            JsonTaskKind::CallJson { method, params } => {
                call_json_blocking(&self.client, method.as_str(), params.take())
            }
        }
    }

    fn resolve(&mut self, env: &'task Env, output: Self::Output) -> Result<Self::JsValue> {
        env.to_js_value(&output)
    }
}

enum BinaryTaskKind {
    GetSourceFile {
        snapshot: String,
        project: String,
        file: String,
    },
    CallBinary {
        method: String,
        params: Option<Value>,
    },
}

pub struct BinaryApiTask {
    client: ApiClient,
    kind: BinaryTaskKind,
}

#[napi]
impl Task for BinaryApiTask {
    type Output = Option<Vec<u8>>;
    type JsValue = Option<Buffer>;

    fn compute(&mut self) -> Result<Self::Output> {
        match &mut self.kind {
            BinaryTaskKind::GetSourceFile {
                snapshot,
                project,
                file,
            } => Ok(block_on(self.client.get_source_file(
                SnapshotHandle::from(snapshot.as_str()),
                ProjectHandle::from(project.as_str()),
                file.clone(),
            ))
            .map_err(into_napi_error)?
            .map(|payload| payload.into_bytes())),
            BinaryTaskKind::CallBinary { method, params } => {
                let params = optional_value(params.take());
                Ok(
                    block_on(self.client.raw_binary_request(method.as_str(), params))
                        .map_err(into_napi_error)?
                        .map(|payload| payload.into_bytes()),
                )
            }
        }
    }

    fn resolve(&mut self, _: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.map(Buffer::from))
    }
}

enum UnitTaskKind {
    ReleaseHandle {
        snapshots: SnapshotStore,
        handle: String,
    },
    Close {
        snapshots: SnapshotStore,
    },
}

pub struct UnitApiTask {
    client: ApiClient,
    kind: UnitTaskKind,
}

#[napi]
impl Task for UnitApiTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        match &mut self.kind {
            UnitTaskKind::ReleaseHandle { snapshots, handle } => {
                if let Some(snapshot) = snapshots
                    .lock()
                    .map_err(into_napi_error)?
                    .remove(handle.as_str())
                {
                    return block_on(snapshot.release()).map_err(into_napi_error);
                }
                let params = serde_json::json!({ "handle": handle });
                let _ = block_on(self.client.raw_json_request("release", params))
                    .map_err(into_napi_error)?;
                Ok(())
            }
            UnitTaskKind::Close { snapshots } => {
                let snapshots = std::mem::take(&mut *snapshots.lock().map_err(into_napi_error)?);
                for (_, snapshot) in snapshots {
                    block_on(snapshot.release()).map_err(into_napi_error)?;
                }
                block_on(self.client.close()).map_err(into_napi_error)
            }
        }
    }

    fn resolve(&mut self, _: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Spawns a new client on a libuv worker thread.
#[napi]
pub fn spawn_corsa_api_client_async(options: Value) -> Result<AsyncTask<SpawnApiClientTask>> {
    Ok(AsyncTask::new(SpawnApiClientTask {
        options: Some(from_value::<SpawnOptions>(options)?),
    }))
}

/// Thin synchronous wrapper around the Rust stdio API client.
#[napi]
pub struct CorsaApiClient {
    inner: ApiClient,
    snapshots: SnapshotStore,
}

#[napi]
impl CorsaApiClient {
    /// Spawns a new client from a JavaScript spawn config.
    #[napi(factory)]
    pub fn spawn(options: Value) -> Result<Self> {
        let options = from_value::<SpawnOptions>(options)?;
        let inner =
            block_on(ApiClient::spawn(build_spawn_config(options)?)).map_err(into_napi_error)?;
        Ok(Self {
            inner,
            snapshots: Arc::new(Mutex::new(FastMap::default())),
        })
    }

    /// Spawns a new client without blocking the JavaScript event loop.
    #[napi]
    pub fn spawn_async(options: Value) -> Result<AsyncTask<SpawnApiClientTask>> {
        spawn_corsa_api_client_async(options)
    }

    /// Calls `initialize` and returns the response object.
    #[napi]
    pub fn initialize(&self) -> Result<Value> {
        let response = block_on(self.inner.initialize()).map_err(into_napi_error)?;
        to_value(response.as_ref())
    }

    /// Calls `initialize` without blocking the JavaScript event loop.
    #[napi]
    pub fn initialize_async(&self) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::Initialize,
        })
    }

    /// Parses a `tsconfig` through corsa and returns the response object.
    #[napi]
    pub fn parse_config_file(&self, file: String) -> Result<Value> {
        let response = block_on(self.inner.parse_config_file(file)).map_err(into_napi_error)?;
        to_value(&response)
    }

    /// Parses a `tsconfig` on a libuv worker thread.
    #[napi]
    pub fn parse_config_file_async(&self, file: String) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::ParseConfigFile { file },
        })
    }

    /// Applies file changes and returns a snapshot record.
    #[napi]
    pub fn update_snapshot(&self, params: Option<Value>) -> Result<Value> {
        let params = from_optional_value::<UpdateSnapshotParams>(params)?;
        let snapshot = block_on(self.inner.update_snapshot(params)).map_err(into_napi_error)?;
        let handle = snapshot.handle.clone();
        let state = to_value(&SnapshotState {
            snapshot: &snapshot.handle,
            projects: snapshot.projects.as_slice(),
            changes: &snapshot.changes,
        })?;
        self.snapshots
            .lock()
            .map_err(into_napi_error)?
            .insert(CompactString::from(handle.as_str()), snapshot);
        Ok(state)
    }

    /// Applies file changes on a libuv worker thread.
    #[napi]
    pub fn update_snapshot_async(&self, params: Option<Value>) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::UpdateSnapshot {
                params,
                snapshots: self.snapshots.clone(),
            },
        })
    }

    /// Fetches a source file through the binary endpoint.
    #[napi]
    pub fn get_source_file(
        &self,
        snapshot: String,
        project: String,
        file: String,
    ) -> Result<Option<Buffer>> {
        let payload = block_on(self.inner.get_source_file(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
        ))
        .map_err(into_napi_error)?;
        Ok(payload.map(|payload| Buffer::from(payload.into_bytes())))
    }

    /// Fetches a source file on a libuv worker thread.
    #[napi]
    pub fn get_source_file_async(
        &self,
        snapshot: String,
        project: String,
        file: String,
    ) -> AsyncTask<BinaryApiTask> {
        AsyncTask::new(BinaryApiTask {
            client: self.inner.clone(),
            kind: BinaryTaskKind::GetSourceFile {
                snapshot,
                project,
                file,
            },
        })
    }

    /// Resolves the intrinsic string type for a project.
    #[napi]
    pub fn get_string_type(&self, snapshot: String, project: String) -> Result<Value> {
        let response = block_on(self.inner.get_string_type(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_string_type_async(
        &self,
        snapshot: String,
        project: String,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetStringType { snapshot, project },
        })
    }

    /// Resolves the checker type visible at a file position.
    #[napi]
    pub fn get_type_at_position(
        &self,
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    ) -> Result<Value> {
        let response = block_on(self.inner.get_type_at_position(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
            position,
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_type_at_position_async(
        &self,
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetTypeAtPosition {
                snapshot,
                project,
                file,
                position,
            },
        })
    }

    /// Resolves the checker type for a source range using Rust-side lookup hints.
    #[allow(clippy::too_many_arguments)]
    #[napi]
    pub fn get_type_at_source_range(
        &self,
        snapshot: String,
        project: String,
        file: String,
        start: u32,
        end: u32,
        source_text: String,
        kind: Option<String>,
    ) -> Result<Value> {
        let response = block_on(get_type_at_source_range(
            &self.inner,
            SourceRangeLookup {
                snapshot: SnapshotHandle::from(snapshot.as_str()),
                project: ProjectHandle::from(project.as_str()),
                file,
                start,
                end,
                source_text,
                kind,
            },
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[allow(clippy::too_many_arguments)]
    #[napi]
    pub fn get_type_at_source_range_async(
        &self,
        snapshot: String,
        project: String,
        file: String,
        start: u32,
        end: u32,
        source_text: String,
        kind: Option<String>,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetTypeAtSourceRange {
                snapshot,
                project,
                file,
                start,
                end,
                source_text,
                kind,
            },
        })
    }

    /// Resolves the checker symbol visible at a file position.
    #[napi]
    pub fn get_symbol_at_position(
        &self,
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    ) -> Result<Value> {
        let response = block_on(self.inner.get_symbol_at_position(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
            position,
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_symbol_at_position_async(
        &self,
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetSymbolAtPosition {
                snapshot,
                project,
                file,
                position,
            },
        })
    }

    /// Resolves the symbol attached to a checker type.
    #[napi]
    pub fn get_symbol_of_type(&self, snapshot: String, type_handle: String) -> Result<Value> {
        let response = block_on(self.inner.get_symbol_of_type(
            SnapshotHandle::from(snapshot.as_str()),
            TypeHandle::from(type_handle.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_symbol_of_type_async(
        &self,
        snapshot: String,
        type_handle: String,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetSymbolOfType {
                snapshot,
                type_handle,
            },
        })
    }

    /// Resolves type arguments for type-reference and mapped objects, and returns [] otherwise.
    #[napi]
    pub fn get_type_arguments(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
    ) -> Result<Value> {
        if object_flags.unwrap_or_default() & (OBJECT_FLAGS_REFERENCE | OBJECT_FLAGS_MAPPED) == 0 {
            return to_value(&Vec::<corsa::api::TypeResponse>::new());
        }
        let response = block_on(self.inner.get_type_arguments(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            TypeHandle::from(type_handle.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    /// Resolves type arguments and prefers structural handles from source locations when available.
    #[allow(clippy::too_many_arguments)]
    #[napi]
    pub fn get_type_arguments_at_source_range(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
        file: String,
        start: u32,
        end: u32,
        source_text: String,
    ) -> Result<Value> {
        let response = block_on(get_type_arguments_at_source_range(
            &self.inner,
            TypeArgumentsSourceRangeLookup {
                snapshot: SnapshotHandle::from(snapshot.as_str()),
                project: ProjectHandle::from(project.as_str()),
                type_handle: TypeHandle::from(type_handle.as_str()),
                object_flags,
                file,
                start,
                end,
                source_text,
            },
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_type_arguments_async(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetTypeArguments {
                snapshot,
                project,
                type_handle,
                object_flags,
            },
        })
    }

    #[allow(clippy::too_many_arguments)]
    #[napi]
    pub fn get_type_arguments_at_source_range_async(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
        file: String,
        start: u32,
        end: u32,
        source_text: String,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetTypeArgumentsAtSourceRange {
                snapshot,
                project,
                type_handle,
                object_flags,
                file,
                start,
                end,
                source_text,
            },
        })
    }

    /// Resolves a type constraint using Corsa relation endpoints.
    #[napi]
    pub fn get_constraint_of_type(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
    ) -> Result<Value> {
        let response = block_on(self.inner.get_constraint_of_type(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            TypeHandle::from(type_handle.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_constraint_of_type_async(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetConstraintOfType {
                snapshot,
                project,
                type_handle,
            },
        })
    }

    /// Resolves the apparent checker type of a symbol.
    #[napi]
    pub fn get_type_of_symbol(
        &self,
        snapshot: String,
        project: String,
        symbol: String,
    ) -> Result<Value> {
        let response = block_on(self.inner.get_type_of_symbol(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            SymbolHandle::from(symbol.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_type_of_symbol_async(
        &self,
        snapshot: String,
        project: String,
        symbol: String,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetTypeOfSymbol {
                snapshot,
                project,
                symbol,
            },
        })
    }

    /// Resolves the declared checker type of a symbol.
    #[napi]
    pub fn get_declared_type_of_symbol(
        &self,
        snapshot: String,
        project: String,
        symbol: String,
    ) -> Result<Value> {
        let response = block_on(self.inner.get_declared_type_of_symbol(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            SymbolHandle::from(symbol.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_value(&response)
    }

    #[napi]
    pub fn get_declared_type_of_symbol_async(
        &self,
        snapshot: String,
        project: String,
        symbol: String,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::GetDeclaredTypeOfSymbol {
                snapshot,
                project,
                symbol,
            },
        })
    }

    /// Renders a type back to a string representation.
    #[napi]
    pub fn type_to_string(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        location: Option<String>,
        flags: Option<i32>,
    ) -> Result<String> {
        block_on(self.inner.type_to_string(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            TypeHandle::from(type_handle.as_str()),
            location.map(|value| corsa::api::NodeHandle::from(value.as_str())),
            flags,
        ))
        .map_err(into_napi_error)
    }

    #[napi]
    pub fn type_to_string_async(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        location: Option<String>,
        flags: Option<i32>,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::TypeToString {
                snapshot,
                project,
                type_handle,
                location,
                flags,
            },
        })
    }

    /// Sends an arbitrary JSON endpoint request.
    #[napi]
    pub fn call_json(&self, method: String, params: Option<Value>) -> Result<Value> {
        call_json_blocking(&self.inner, method.as_str(), params)
    }

    /// Sends an arbitrary JSON endpoint request on a libuv worker thread.
    #[napi]
    pub fn call_json_async(&self, method: String, params: Option<Value>) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::CallJson { method, params },
        })
    }

    /// Sends an arbitrary binary endpoint request.
    #[napi]
    pub fn call_binary(&self, method: String, params: Option<Value>) -> Result<Option<Buffer>> {
        let params = optional_value(params);
        let payload = block_on(self.inner.raw_binary_request(method.as_str(), params))
            .map_err(into_napi_error)?;
        Ok(payload.map(|payload| Buffer::from(payload.into_bytes())))
    }

    /// Sends an arbitrary binary endpoint request on a libuv worker thread.
    #[napi]
    pub fn call_binary_async(
        &self,
        method: String,
        params: Option<Value>,
    ) -> AsyncTask<BinaryApiTask> {
        AsyncTask::new(BinaryApiTask {
            client: self.inner.clone(),
            kind: BinaryTaskKind::CallBinary { method, params },
        })
    }

    /// Releases a corsa handle explicitly.
    #[napi]
    pub fn release_handle(&self, handle: String) -> Result<()> {
        if let Some(snapshot) = self
            .snapshots
            .lock()
            .map_err(into_napi_error)?
            .remove(handle.as_str())
        {
            return block_on(snapshot.release()).map_err(into_napi_error);
        }
        let params = serde_json::json!({ "handle": handle });
        let _ =
            block_on(self.inner.raw_json_request("release", params)).map_err(into_napi_error)?;
        Ok(())
    }

    /// Releases a corsa handle on a libuv worker thread.
    #[napi]
    pub fn release_handle_async(&self, handle: String) -> AsyncTask<UnitApiTask> {
        AsyncTask::new(UnitApiTask {
            client: self.inner.clone(),
            kind: UnitTaskKind::ReleaseHandle {
                snapshots: self.snapshots.clone(),
                handle,
            },
        })
    }

    /// Closes the underlying worker process.
    #[napi]
    pub fn close(&self) -> Result<()> {
        let snapshots = std::mem::take(&mut *self.snapshots.lock().map_err(into_napi_error)?);
        for (_, snapshot) in snapshots {
            block_on(snapshot.release()).map_err(into_napi_error)?;
        }
        block_on(self.inner.close()).map_err(into_napi_error)
    }

    /// Closes the underlying worker process on a libuv worker thread.
    #[napi]
    pub fn close_async(&self) -> AsyncTask<UnitApiTask> {
        AsyncTask::new(UnitApiTask {
            client: self.inner.clone(),
            kind: UnitTaskKind::Close {
                snapshots: self.snapshots.clone(),
            },
        })
    }
}

async fn get_type_at_source_range(
    client: &ApiClient,
    params: SourceRangeLookup,
) -> corsa::Result<Option<TypeResponse>> {
    let direct = client
        .get_type_at_position(
            params.snapshot.clone(),
            params.project.clone(),
            params.file.clone(),
            params.start,
        )
        .await?;

    let direct_is_specific = direct
        .as_ref()
        .map(|r#type| !is_any_type(r#type))
        .unwrap_or(false);
    for position in fallback_type_lookup_positions(
        params.kind.as_deref(),
        params.start,
        params.end,
        params.source_text.as_str(),
    ) {
        if position == params.start && direct_is_specific {
            continue;
        }
        let candidate = get_type_or_symbol_type_at_position(
            client,
            params.snapshot.clone(),
            params.project.clone(),
            params.file.clone(),
            position,
        )
        .await?;
        if candidate.is_some() {
            return Ok(candidate);
        }
    }

    Ok(direct)
}

async fn get_type_arguments_at_source_range(
    client: &ApiClient,
    params: TypeArgumentsSourceRangeLookup,
) -> corsa::Result<Vec<TypeResponse>> {
    if params.object_flags.unwrap_or_default() & (OBJECT_FLAGS_REFERENCE | OBJECT_FLAGS_MAPPED) == 0
    {
        return Ok(Vec::new());
    }

    let arguments_from_api = client
        .get_type_arguments(
            params.snapshot.clone(),
            params.project.clone(),
            params.type_handle.clone(),
        )
        .await?;
    let arguments_from_source = type_arguments_from_source_range(client, &params).await?;
    if arguments_from_source.is_empty() {
        return Ok(arguments_from_api);
    }
    if arguments_from_api.is_empty() {
        return Ok(arguments_from_source);
    }
    if arguments_from_api.len() != arguments_from_source.len() {
        return Ok(arguments_from_api);
    }

    let mut structural = Vec::with_capacity(arguments_from_api.len());
    for (api_argument, source_argument) in arguments_from_api.into_iter().zip(arguments_from_source)
    {
        if same_type_text_for_source_argument(
            client,
            params.snapshot.clone(),
            params.project.clone(),
            &api_argument,
            &source_argument,
        )
        .await?
        {
            structural.push(source_argument);
        } else {
            structural.push(api_argument);
        }
    }
    Ok(structural)
}

async fn type_arguments_from_source_range(
    client: &ApiClient,
    params: &TypeArgumentsSourceRangeLookup,
) -> corsa::Result<Vec<TypeResponse>> {
    let positions =
        type_argument_positions_for_source_range(params.start, params.end, &params.source_text);
    let mut arguments = Vec::with_capacity(positions.len());
    for position in positions {
        if let Some(argument) = get_type_or_symbol_type_at_position(
            client,
            params.snapshot.clone(),
            params.project.clone(),
            params.file.clone(),
            position,
        )
        .await?
        {
            arguments.push(argument);
        }
    }
    Ok(arguments)
}

async fn same_type_text_for_source_argument(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    left: &TypeResponse,
    right: &TypeResponse,
) -> corsa::Result<bool> {
    if left.id == right.id || type_response_texts_overlap(left, right) {
        return Ok(true);
    }
    let Some(left_text) =
        type_response_text_or_none(client, snapshot.clone(), project.clone(), left).await?
    else {
        return Ok(false);
    };
    let Some(right_text) = type_response_text_or_none(client, snapshot, project, right).await?
    else {
        return Ok(false);
    };
    Ok(left_text == right_text)
}

async fn type_response_text_or_none(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    r#type: &TypeResponse,
) -> corsa::Result<Option<String>> {
    if let Some(text) = r#type.texts.iter().find(|text| !text.is_empty()) {
        return Ok(Some(text.clone()));
    }
    match client
        .type_to_string(snapshot, project, r#type.id.clone(), None, None)
        .await
    {
        Ok(text) => Ok(Some(text)),
        Err(error) if is_stale_handle_error(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

fn type_response_texts_overlap(left: &TypeResponse, right: &TypeResponse) -> bool {
    left.texts
        .iter()
        .filter(|text| !text.is_empty())
        .any(|left_text| right.texts.iter().any(|right_text| left_text == right_text))
}

async fn get_type_or_symbol_type_at_position(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    file: String,
    position: u32,
) -> corsa::Result<Option<TypeResponse>> {
    let direct = client
        .get_type_at_position(snapshot.clone(), project.clone(), file.clone(), position)
        .await?;
    if direct
        .as_ref()
        .map(|r#type| !is_any_type(r#type))
        .unwrap_or(false)
    {
        return Ok(direct);
    }

    let Some(symbol) = client
        .get_symbol_at_position(snapshot.clone(), project.clone(), file, position)
        .await?
    else {
        return Ok(direct);
    };
    if let Some(declared) = client
        .get_declared_type_of_symbol(snapshot.clone(), project.clone(), symbol.id.clone())
        .await?
    {
        return Ok(Some(declared));
    }
    if let Some(apparent) = client
        .get_type_of_symbol(snapshot, project, symbol.id)
        .await?
    {
        return Ok(Some(apparent));
    }
    Ok(direct)
}

fn is_any_type(r#type: &TypeResponse) -> bool {
    (r#type.flags & 1) != 0 || corsa::utils::is_any_like_type_texts(&r#type.texts)
}

fn fallback_type_lookup_positions(
    kind: Option<&str>,
    start: u32,
    end: u32,
    source_text: &str,
) -> Vec<u32> {
    let Some(kind) = kind else {
        return Vec::new();
    };
    let Some((start_byte, end_byte)) = utf16_byte_range(source_text, start, end) else {
        return Vec::new();
    };
    if start_byte >= end_byte {
        return Vec::new();
    }

    let slice = &source_text[start_byte..end_byte];
    let mut positions = Vec::new();
    match kind {
        "ClassBody" => {
            push_utf16_position(
                &mut positions,
                source_text,
                class_name_before(source_text, start_byte),
            );
        }
        "MemberExpression" => {
            push_utf16_position(
                &mut positions,
                source_text,
                member_property_offset(slice).map(|offset| start_byte + offset),
            );
        }
        "MethodDefinition" => {
            let member_name = first_member_name_range(slice);
            if member_name
                .map(|(start, end)| &slice[start..end] == "constructor")
                .unwrap_or(false)
            {
                push_utf16_position(
                    &mut positions,
                    source_text,
                    class_name_before(source_text, start_byte),
                );
            } else {
                push_utf16_position(
                    &mut positions,
                    source_text,
                    member_name.map(|(offset, _)| start_byte + offset),
                );
            }
        }
        "PropertyDefinition" | "TSAbstractMethodDefinition" | "TSParameterProperty" => {
            push_utf16_position(
                &mut positions,
                source_text,
                first_member_name_range(slice).map(|(offset, _)| start_byte + offset),
            );
        }
        "TSAsExpression" => {
            push_utf16_position(
                &mut positions,
                source_text,
                type_assertion_as_offset(slice).map(|offset| start_byte + offset),
            );
        }
        "TSTypeAssertion" => {
            push_utf16_position(
                &mut positions,
                source_text,
                type_assertion_angle_offset(slice).map(|offset| start_byte + offset),
            );
        }
        "TSTypeReference" => {
            push_utf16_position(
                &mut positions,
                source_text,
                first_identifier_after(slice, 0).map(|offset| start_byte + offset),
            );
        }
        "Identifier" if identifier_looks_like_type_reference_name(source_text, start_byte) => {
            push_utf16_position(&mut positions, source_text, Some(start_byte));
        }
        _ => {}
    }
    positions
}

fn identifier_looks_like_type_reference_name(source_text: &str, start_byte: usize) -> bool {
    previous_non_whitespace(source_text, start_byte)
        .map(|ch| matches!(ch, ':' | '<' | '|' | '&' | ','))
        .unwrap_or(false)
}

fn previous_non_whitespace(text: &str, index: usize) -> Option<char> {
    text.get(..index)?
        .chars()
        .rev()
        .find(|ch| !ch.is_whitespace())
}

fn type_argument_positions_for_source_range(start: u32, end: u32, source_text: &str) -> Vec<u32> {
    let Some((start_byte, end_byte)) = utf16_byte_range(source_text, start, end) else {
        return Vec::new();
    };
    if start_byte >= end_byte {
        return Vec::new();
    }
    let slice = &source_text[start_byte..end_byte];
    let type_start = first_top_level_index_of_any(slice, &[':', '='])
        .and_then(|index| char_len_at(slice, index).map(|len| index + len))
        .unwrap_or(0);
    let Some(open_in_type) = first_top_level_opening_angle(&slice[type_start..]) else {
        return Vec::new();
    };
    let open = type_start + open_in_type;
    let Some(close) = matching_angle_close(slice, open) else {
        return Vec::new();
    };
    let arguments_text = &slice[open + 1..close];
    let mut positions = Vec::new();
    for range in split_top_level_ranges(arguments_text, ',') {
        let raw = &arguments_text[range.start..range.end];
        let Some(leading) = first_non_whitespace(raw) else {
            continue;
        };
        push_utf16_position(
            &mut positions,
            source_text,
            Some(start_byte + open + 1 + range.start + leading),
        );
    }
    positions
}

fn first_top_level_index_of_any(text: &str, needles: &[char]) -> Option<usize> {
    let mut angle_depth = 0usize;
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let ch = char_at(text, index)?;
        match ch {
            '<' => angle_depth += 1,
            '>' => angle_depth = angle_depth.saturating_sub(1),
            '(' => paren_depth += 1,
            ')' => paren_depth = paren_depth.saturating_sub(1),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            _ if needles.contains(&ch)
                && angle_depth == 0
                && paren_depth == 0
                && bracket_depth == 0
                && brace_depth == 0 =>
            {
                return Some(index);
            }
            _ => {}
        }
        index += ch.len_utf8();
    }
    None
}

fn first_top_level_opening_angle(text: &str) -> Option<usize> {
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let ch = char_at(text, index)?;
        match ch {
            '(' => paren_depth += 1,
            ')' => paren_depth = paren_depth.saturating_sub(1),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            '<' if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 => {
                return Some(index);
            }
            _ => {}
        }
        index += ch.len_utf8();
    }
    None
}

struct ByteRange {
    start: usize,
    end: usize,
}

fn split_top_level_ranges(text: &str, delimiter: char) -> Vec<ByteRange> {
    let mut ranges = Vec::new();
    let mut angle_depth = 0usize;
    let mut paren_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut start = 0usize;
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let Some(ch) = char_at(text, index) else {
            break;
        };
        match ch {
            '<' => angle_depth += 1,
            '>' => angle_depth = angle_depth.saturating_sub(1),
            '(' => paren_depth += 1,
            ')' => paren_depth = paren_depth.saturating_sub(1),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            _ if ch == delimiter
                && angle_depth == 0
                && paren_depth == 0
                && bracket_depth == 0
                && brace_depth == 0 =>
            {
                ranges.push(ByteRange { start, end: index });
                start = index + ch.len_utf8();
            }
            _ => {}
        }
        index += ch.len_utf8();
    }
    ranges.push(ByteRange {
        start,
        end: text.len(),
    });
    ranges
}

fn first_non_whitespace(text: &str) -> Option<usize> {
    text.char_indices()
        .find(|(_, ch)| !ch.is_whitespace())
        .map(|(index, _)| index)
}

fn push_utf16_position(positions: &mut Vec<u32>, source_text: &str, byte_offset: Option<usize>) {
    let Some(byte_offset) = byte_offset else {
        return;
    };
    let Some(position) = utf16_index_from_byte(source_text, byte_offset) else {
        return;
    };
    if !positions.contains(&position) {
        positions.push(position);
    }
}

fn utf16_byte_range(text: &str, start: u32, end: u32) -> Option<(usize, usize)> {
    if start > end {
        return None;
    }
    Some((
        byte_index_from_utf16(text, start)?,
        byte_index_from_utf16(text, end)?,
    ))
}

fn byte_index_from_utf16(text: &str, target: u32) -> Option<usize> {
    let mut utf16 = 0u32;
    for (byte, ch) in text.char_indices() {
        if utf16 == target {
            return Some(byte);
        }
        let next = utf16.checked_add(ch.len_utf16() as u32)?;
        if target < next {
            return None;
        }
        utf16 = next;
    }
    if utf16 == target {
        Some(text.len())
    } else {
        None
    }
}

fn utf16_index_from_byte(text: &str, byte_offset: usize) -> Option<u32> {
    if !text.is_char_boundary(byte_offset) {
        return None;
    }
    u32::try_from(text[..byte_offset].encode_utf16().count()).ok()
}

fn class_name_before(source_text: &str, body_start: usize) -> Option<usize> {
    let prefix = source_text.get(..body_start)?;
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    let mut candidate = None;
    while index < prefix.len() {
        let next = scanner.skip(prefix, index);
        if next > index {
            index = next;
            continue;
        }
        if matches_keyword(prefix, "class", index) {
            candidate = first_identifier_after(prefix, index + "class".len());
            index += "class".len();
            continue;
        }
        index += char_len_at(prefix, index)?;
    }
    candidate
}

fn member_property_offset(text: &str) -> Option<usize> {
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    let mut last_dot = None;
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let ch = char_at(text, index)?;
        if ch == '.' {
            last_dot = Some(index);
        }
        index += ch.len_utf8();
    }
    first_identifier_after(text, last_dot? + 1)
}

fn first_member_name_range(text: &str) -> Option<(usize, usize)> {
    let mut index = skip_whitespace(text, 0);
    loop {
        if char_at(text, index) == Some('#') {
            index += 1;
        }
        let (start, end) = read_identifier(text, index)?;
        let word = &text[start..end];
        if is_modifier(word) {
            index = skip_whitespace(text, end);
            continue;
        }
        return Some((start, end));
    }
}

fn type_assertion_as_offset(text: &str) -> Option<usize> {
    let keyword = find_keyword_outside_trivia(text, "as")?;
    first_identifier_after(text, keyword + "as".len())
}

fn type_assertion_angle_offset(text: &str) -> Option<usize> {
    let open = text.find('<')?;
    let close = matching_angle_close(text, open)?;
    first_identifier_after(&text[..close], open + 1)
}

fn matching_angle_close(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = open;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let ch = char_at(text, index)?;
        if ch == '<' {
            depth += 1;
        } else if ch == '>' {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(index);
            }
        }
        index += ch.len_utf8();
    }
    None
}

fn find_keyword_outside_trivia(text: &str, keyword: &str) -> Option<usize> {
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        if matches_keyword(text, keyword, index) {
            return Some(index);
        }
        index += char_len_at(text, index)?;
    }
    None
}

fn matches_keyword(text: &str, keyword: &str, index: usize) -> bool {
    text.get(index..)
        .map(|tail| tail.starts_with(keyword))
        .unwrap_or(false)
        && !identifier_part_before(text, index)
        && !identifier_part_at(text, index + keyword.len())
}

fn first_identifier_after(text: &str, index: usize) -> Option<usize> {
    let mut index = skip_whitespace(text, index);
    while index < text.len() {
        if let Some((start, _)) = read_identifier(text, index) {
            return Some(start);
        }
        index += char_len_at(text, index)?;
        index = skip_whitespace(text, index);
    }
    None
}

fn read_identifier(text: &str, index: usize) -> Option<(usize, usize)> {
    let mut iter = text.get(index..)?.char_indices();
    let (_, first) = iter.next()?;
    if !is_identifier_start(first) {
        return None;
    }
    let mut end = index + first.len_utf8();
    for (offset, ch) in iter {
        if !is_identifier_part(ch) {
            break;
        }
        end = index + offset + ch.len_utf8();
    }
    Some((index, end))
}

fn skip_whitespace(text: &str, mut index: usize) -> usize {
    while let Some(ch) = char_at(text, index) {
        if !ch.is_whitespace() {
            break;
        }
        index += ch.len_utf8();
    }
    index
}

fn is_modifier(word: &str) -> bool {
    matches!(
        word,
        "abstract"
            | "accessor"
            | "async"
            | "declare"
            | "export"
            | "override"
            | "private"
            | "protected"
            | "public"
            | "readonly"
            | "static"
    )
}

fn is_identifier_start(ch: char) -> bool {
    ch == '_' || ch == '$' || unicode_ident::is_xid_start(ch)
}

fn is_identifier_part(ch: char) -> bool {
    is_identifier_start(ch)
        || unicode_ident::is_xid_continue(ch)
        || matches!(ch, '\u{200c}' | '\u{200d}')
}

fn identifier_part_before(text: &str, index: usize) -> bool {
    text.get(..index)
        .and_then(|prefix| prefix.chars().next_back())
        .map(is_identifier_part)
        .unwrap_or(false)
}

fn identifier_part_at(text: &str, index: usize) -> bool {
    char_at(text, index)
        .map(is_identifier_part)
        .unwrap_or(false)
}

fn char_at(text: &str, index: usize) -> Option<char> {
    text.get(index..)?.chars().next()
}

fn char_len_at(text: &str, index: usize) -> Option<usize> {
    Some(char_at(text, index)?.len_utf8())
}

fn is_stale_handle_error(error: &CorsaError) -> bool {
    match error {
        CorsaError::Rpc(rpc) => is_stale_handle_message(&rpc.message),
        CorsaError::Protocol(message) => is_stale_handle_message(message),
        _ => false,
    }
}

fn is_stale_handle_message(message: &str) -> bool {
    message.contains("not found in snapshot registry")
}

async fn get_signatures_of_type_with_parameter_texts(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    r#type: TypeHandle,
    kind: i32,
    source_override: Option<&SignatureSourceOverride>,
) -> corsa::Result<Vec<SignatureResponse>> {
    let mut signatures = client
        .get_signatures_of_type(snapshot.clone(), project.clone(), r#type, kind)
        .await?;
    for signature in &mut signatures {
        if signature.parameter_symbols.is_empty() && !signature.parameters.is_empty() {
            signature.parameter_symbols = parameter_symbols_for_signature(
                client,
                snapshot.clone(),
                project.clone(),
                signature,
                source_override,
            )
            .await?;
        }
        if signature.type_parameter_default_texts.is_empty()
            && !signature.type_parameters.is_empty()
        {
            signature.type_parameter_default_texts = type_parameter_default_texts_for_signature(
                client,
                snapshot.clone(),
                project.clone(),
                signature,
                source_override,
            )
            .await?;
        }
        if !signature.parameter_type_texts.is_empty() {
            continue;
        }
        signature.parameter_type_texts = render_symbol_type_texts(
            client,
            snapshot.clone(),
            project.clone(),
            &signature.parameters,
        )
        .await?;
        if let Some(this_parameter) = &signature.this_parameter {
            signature.this_parameter_type_texts = render_symbol_type_texts(
                client,
                snapshot.clone(),
                project.clone(),
                std::slice::from_ref(this_parameter),
            )
            .await?
            .into_iter()
            .next()
            .unwrap_or_default();
        }
    }
    Ok(signatures)
}

async fn parameter_symbols_for_signature(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    signature: &SignatureResponse,
    source_override: Option<&SignatureSourceOverride>,
) -> corsa::Result<Vec<SymbolResponse>> {
    let Some(declaration) = &signature.declaration else {
        return Ok(Vec::new());
    };
    let Ok(parsed) = declaration.parse() else {
        return Ok(Vec::new());
    };
    let source_text = source_text_for_signature_declaration(
        client,
        snapshot,
        project,
        parsed.path.as_str(),
        source_override,
    )
    .await?;
    let parameters = parameter_ranges_for_signature_declaration(
        &source_text,
        parsed.pos,
        parsed.end,
        signature.parameters.len(),
    );
    if parameters.is_empty() {
        return Ok(Vec::new());
    }

    Ok(signature
        .parameters
        .iter()
        .zip(parameters)
        .map(|(symbol, (name, pos, end))| {
            let declaration =
                NodeHandle::from(format!("{}.{}.0.{}", pos, end, parsed.path.as_str()));
            SymbolResponse {
                id: symbol.clone(),
                name,
                flags: 1,
                check_flags: 0,
                declarations: vec![declaration.clone()],
                value_declaration: Some(declaration),
            }
        })
        .collect())
}

async fn type_parameter_default_texts_for_signature(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    signature: &SignatureResponse,
    source_override: Option<&SignatureSourceOverride>,
) -> corsa::Result<Vec<String>> {
    let Some(declaration) = &signature.declaration else {
        return Ok(Vec::new());
    };
    let Ok(parsed) = declaration.parse() else {
        return Ok(Vec::new());
    };
    let source_text = source_text_for_signature_declaration(
        client,
        snapshot,
        project,
        parsed.path.as_str(),
        source_override,
    )
    .await?;
    Ok(type_parameter_default_texts_for_declaration_range(
        &source_text,
        parsed.pos,
        parsed.end,
        signature.type_parameters.len(),
    ))
}

fn type_parameter_default_texts_in_signature_declaration(declaration_text: &str) -> Vec<String> {
    let Some(open) = first_top_level_opening_angle(declaration_text) else {
        return Vec::new();
    };
    let Some(first_paren) = first_top_level_opening_paren(declaration_text) else {
        return Vec::new();
    };
    if open > first_paren {
        return Vec::new();
    }
    let Some(close) = matching_angle_close(declaration_text, open) else {
        return Vec::new();
    };
    let parameters_text = &declaration_text[open + 1..close];
    split_top_level_ranges(parameters_text, ',')
        .into_iter()
        .map(|range| {
            let parameter_text = &parameters_text[range.start..range.end];
            first_top_level_index_of_any(parameter_text, &['='])
                .and_then(|index| char_len_at(parameter_text, index).map(|len| index + len))
                .map(|start| parameter_text[start..].trim().to_owned())
                .unwrap_or_default()
        })
        .collect()
}

async fn source_text_for_signature_declaration(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    path: &str,
    source_override: Option<&SignatureSourceOverride>,
) -> corsa::Result<String> {
    if let Some(source_override) = source_override
        && (source_override.file == path || source_override.file.ends_with(path))
    {
        return Ok(source_override.source_text.clone());
    }
    if let Ok(source_text) = fs::read_to_string(path) {
        return Ok(source_text);
    }
    let Some(source) = client
        .get_source_file(snapshot, project, path.to_owned())
        .await?
    else {
        return Ok(String::new());
    };
    Ok(String::from_utf8(source.into_bytes()).unwrap_or_default())
}

struct ParameterSourceRange {
    name: String,
    start: usize,
    end: usize,
}

fn parameter_ranges_in_signature_declaration(
    declaration_text: &str,
    declaration_start: usize,
) -> Vec<ParameterSourceRange> {
    let Some(open) = first_top_level_opening_paren(declaration_text) else {
        return Vec::new();
    };
    let Some(close) = matching_paren_close(declaration_text, open) else {
        return Vec::new();
    };
    let parameters_text = &declaration_text[open + 1..close];
    split_top_level_ranges(parameters_text, ',')
        .into_iter()
        .filter_map(|range| {
            let raw = &parameters_text[range.start..range.end];
            let leading = first_non_whitespace(raw)?;
            let trailing = raw
                .char_indices()
                .rev()
                .find(|(_, ch)| !ch.is_whitespace())
                .map(|(index, ch)| index + ch.len_utf8())?;
            let name = parameter_name(raw)?;
            Some(ParameterSourceRange {
                name,
                start: declaration_start + open + 1 + range.start + leading,
                end: declaration_start + open + 1 + range.start + trailing,
            })
        })
        .collect()
}

fn parameter_ranges_for_signature_declaration(
    source_text: &str,
    declaration_pos: u32,
    declaration_end: u32,
    expected_count: usize,
) -> Vec<(String, u32, u32)> {
    let mut fallback = Vec::new();
    for (start, end) in
        signature_declaration_byte_ranges(source_text, declaration_pos, declaration_end)
    {
        let Some(declaration_text) = source_text.get(start..end) else {
            continue;
        };
        let parameters = parameter_ranges_in_signature_declaration(declaration_text, start)
            .into_iter()
            .filter_map(|parameter| {
                let pos = utf16_index_from_byte(source_text, parameter.start)?;
                let end = utf16_index_from_byte(source_text, parameter.end)?;
                Some((parameter.name, pos, end))
            })
            .collect::<Vec<_>>();
        if parameters.len() == expected_count {
            return parameters;
        }
        if fallback.is_empty() && !parameters.is_empty() {
            fallback = parameters;
        }
    }
    fallback
}

fn type_parameter_default_texts_for_declaration_range(
    source_text: &str,
    declaration_pos: u32,
    declaration_end: u32,
    expected_count: usize,
) -> Vec<String> {
    let mut fallback = Vec::new();
    for (start, end) in
        signature_declaration_byte_ranges(source_text, declaration_pos, declaration_end)
    {
        let Some(declaration_text) = source_text.get(start..end) else {
            continue;
        };
        let defaults = type_parameter_default_texts_in_signature_declaration(declaration_text);
        if defaults.len() == expected_count {
            return defaults;
        }
        if fallback.is_empty() && !defaults.is_empty() {
            fallback = defaults;
        }
    }
    fallback
}

fn signature_declaration_byte_ranges(
    source_text: &str,
    declaration_pos: u32,
    declaration_end: u32,
) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    if let Some(range) = utf16_byte_range(source_text, declaration_pos, declaration_end) {
        ranges.push(range);
    }
    if let Some(range) = raw_byte_range(source_text, declaration_pos, declaration_end)
        && !ranges.contains(&range)
    {
        ranges.push(range);
    }
    ranges
}

fn raw_byte_range(text: &str, start: u32, end: u32) -> Option<(usize, usize)> {
    if start > end {
        return None;
    }
    let start = usize::try_from(start).ok()?;
    let end = usize::try_from(end).ok()?;
    if end > text.len() || !text.is_char_boundary(start) || !text.is_char_boundary(end) {
        return None;
    }
    Some((start, end))
}

fn parameter_name(text: &str) -> Option<String> {
    let mut index = skip_whitespace(text, 0);
    loop {
        if text.get(index..)?.starts_with("...") {
            index = skip_whitespace(text, index + 3);
        }
        let (start, end) = read_identifier(text, index)?;
        let word = &text[start..end];
        if is_modifier(word) {
            index = skip_whitespace(text, end);
            continue;
        }
        return Some(word.to_owned());
    }
}

fn first_top_level_opening_paren(text: &str) -> Option<usize> {
    let mut angle_depth = 0usize;
    let mut bracket_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut index = 0usize;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let ch = char_at(text, index)?;
        match ch {
            '<' => angle_depth += 1,
            '>' => angle_depth = angle_depth.saturating_sub(1),
            '[' => bracket_depth += 1,
            ']' => bracket_depth = bracket_depth.saturating_sub(1),
            '{' => brace_depth += 1,
            '}' => brace_depth = brace_depth.saturating_sub(1),
            '(' if angle_depth == 0 && bracket_depth == 0 && brace_depth == 0 => {
                return Some(index);
            }
            _ => {}
        }
        index += ch.len_utf8();
    }
    None
}

fn matching_paren_close(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut index = open;
    let mut scanner = SourceScanner::default();
    while index < text.len() {
        let next = scanner.skip(text, index);
        if next > index {
            index = next;
            continue;
        }
        let ch = char_at(text, index)?;
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return Some(index);
            }
        }
        index += ch.len_utf8();
    }
    None
}

async fn get_call_signature_facts(
    client: &ApiClient,
    lookup: CallSignatureFactsLookup<'_>,
) -> corsa::Result<CallSignatureFactsResponse> {
    let signatures = get_signatures_of_type_with_parameter_texts(
        client,
        lookup.snapshot,
        lookup.project,
        lookup.r#type,
        lookup.kind,
        lookup.source_override,
    )
    .await?;
    let Some(signature) =
        select_signature_for_argument_texts(&signatures, &lookup.argument_type_texts)
    else {
        return Ok(CallSignatureFactsResponse::default());
    };

    let expected_argument_type_texts =
        expected_argument_type_texts(signature, lookup.argument_type_texts.len());
    let explicit_type_arguments_required =
        explicit_type_arguments_required(signature, &lookup.explicit_type_argument_texts);

    Ok(CallSignatureFactsResponse {
        signature: Some(signature.clone()),
        expected_argument_type_texts,
        explicit_type_arguments_required,
    })
}

fn select_signature_for_argument_texts<'a>(
    signatures: &'a [SignatureResponse],
    argument_type_texts: &[Vec<String>],
) -> Option<&'a SignatureResponse> {
    if signatures.len() <= 1 {
        return signatures.first();
    }
    signatures
        .iter()
        .max_by_key(|signature| score_signature_for_arguments(signature, argument_type_texts))
}

fn expected_argument_type_texts(
    signature: &SignatureResponse,
    argument_count: usize,
) -> Vec<Vec<String>> {
    if signature.parameter_type_texts.is_empty() {
        return Vec::new();
    }
    (0..argument_count)
        .map(|index| {
            signature
                .parameter_type_texts
                .get(index.min(signature.parameter_type_texts.len().saturating_sub(1)))
                .cloned()
                .unwrap_or_default()
        })
        .collect()
}

fn explicit_type_arguments_required(
    signature: &SignatureResponse,
    explicit_type_argument_texts: &[String],
) -> Option<bool> {
    if explicit_type_argument_texts.is_empty() || signature.type_parameter_default_texts.is_empty()
    {
        return None;
    }
    explicit_type_argument_texts
        .iter()
        .enumerate()
        .all(|(index, explicit)| {
            signature
                .type_parameter_default_texts
                .get(index)
                .filter(|default| !default.trim().is_empty())
                .is_some_and(|default| {
                    normalize_type_text(default) == normalize_type_text(explicit)
                })
        })
        .then_some(false)
}

fn score_signature_for_arguments(
    signature: &SignatureResponse,
    argument_type_texts: &[Vec<String>],
) -> i32 {
    let parameter_types = &signature.parameter_type_texts;
    let mut score = -(argument_type_texts.len().abs_diff(parameter_types.len()) as i32);
    for (index, actual) in argument_type_texts.iter().enumerate() {
        let expected = parameter_types
            .get(index.min(parameter_types.len().saturating_sub(1)))
            .map(Vec::as_slice)
            .unwrap_or_default();
        if expected.is_empty() {
            score -= 2;
        } else if is_permissive_type_texts(expected) {
            score += 1;
        } else if fuzzy_type_texts_overlap(actual, expected) {
            score += 4;
        } else {
            score -= 1;
        }
    }
    score
}

fn fuzzy_type_texts_overlap(actual: &[String], expected: &[String]) -> bool {
    let expected = expected
        .iter()
        .map(|text| normalize_type_text(text))
        .collect::<Vec<_>>();
    actual.iter().any(|actual_text| {
        let actual = normalize_type_text(actual_text);
        expected.iter().any(|expected| {
            expected == &actual || expected.contains(actual.as_str()) || actual.contains(expected)
        })
    })
}

fn is_permissive_type_texts(texts: &[String]) -> bool {
    texts.iter().any(|text| {
        matches!(
            normalize_type_text(text).as_str(),
            "any" | "unknown" | "never"
        )
    })
}

fn normalize_type_text(text: &str) -> String {
    text.split_whitespace().collect()
}

async fn render_symbol_type_texts(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    symbols: &[SymbolHandle],
) -> corsa::Result<Vec<Vec<String>>> {
    let mut rendered = Vec::with_capacity(symbols.len());
    for symbol in symbols {
        let type_response = match client
            .get_type_of_symbol(snapshot.clone(), project.clone(), symbol.clone())
            .await
        {
            Ok(Some(type_response)) => Some(type_response),
            Ok(None) => {
                client
                    .get_declared_type_of_symbol(snapshot.clone(), project.clone(), symbol.clone())
                    .await?
            }
            Err(error) if is_stale_handle_error(&error) => None,
            Err(error) => return Err(error),
        };
        match type_response {
            Some(type_response) => {
                rendered.push(
                    render_type_texts(client, snapshot.clone(), project.clone(), type_response)
                        .await?,
                );
            }
            None => rendered.push(Vec::new()),
        }
    }
    Ok(rendered)
}

async fn render_type_texts(
    client: &ApiClient,
    snapshot: SnapshotHandle,
    project: ProjectHandle,
    type_response: TypeResponse,
) -> corsa::Result<Vec<String>> {
    let mut texts = Vec::with_capacity(type_response.texts.len() + 1);
    for text in &type_response.texts {
        push_unique_text(&mut texts, text);
    }
    if texts.is_empty() {
        let rendered = client
            .type_to_string(snapshot, project, type_response.id, None, None)
            .await?;
        push_unique_text(&mut texts, rendered.as_str());
    }
    Ok(texts)
}

fn push_unique_text(texts: &mut Vec<String>, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() || texts.iter().any(|existing| existing == trimmed) {
        return;
    }
    texts.push(trimmed.to_owned());
}

#[derive(Default)]
struct SourceScanner {
    quote: Option<char>,
    escaped: bool,
    in_line_comment: bool,
    in_block_comment: bool,
}

impl SourceScanner {
    fn skip(&mut self, text: &str, index: usize) -> usize {
        let Some(ch) = char_at(text, index) else {
            return index;
        };
        let next = char_at(text, index + ch.len_utf8());
        if self.in_line_comment {
            if ch == '\n' || ch == '\r' {
                self.in_line_comment = false;
            }
            return index + ch.len_utf8();
        }
        if self.in_block_comment {
            if ch == '*' && next == Some('/') {
                self.in_block_comment = false;
                return index + 2;
            }
            return index + ch.len_utf8();
        }
        if let Some(quote) = self.quote {
            if self.escaped {
                self.escaped = false;
            } else if ch == '\\' {
                self.escaped = true;
            } else if ch == quote {
                self.quote = None;
            }
            return index + ch.len_utf8();
        }
        if ch == '/' && next == Some('/') {
            self.in_line_comment = true;
            return index + 2;
        }
        if ch == '/' && next == Some('*') {
            self.in_block_comment = true;
            return index + 2;
        }
        if ch == '"' || ch == '\'' || ch == '`' {
            self.quote = Some(ch);
            return index + ch.len_utf8();
        }
        index
    }
}

fn call_json_blocking(client: &ApiClient, method: &str, params: Option<Value>) -> Result<Value> {
    if method == "getBaseTypes" {
        let params = params.ok_or_else(|| into_napi_error("getBaseTypes requires params"))?;
        let params = from_value::<TypeProjectParams>(params)?;
        let response = block_on(client.get_base_types_with_texts(
            SnapshotHandle::from(params.snapshot.as_str()),
            ProjectHandle::from(params.project.as_str()),
            TypeHandle::from(params.type_handle.as_str()),
            params.texts.as_slice(),
        ))
        .map_err(into_napi_error)?;
        return to_value(&response);
    }
    if method == "getTypesOfType" {
        let params = params.ok_or_else(|| into_napi_error("getTypesOfType requires params"))?;
        let params = from_value::<TypeOnlyParams>(params)?;
        let response = block_on(client.get_types_of_type(
            SnapshotHandle::from(params.snapshot.as_str()),
            TypeHandle::from(params.type_handle.as_str()),
        ))
        .map_err(into_napi_error)?;
        return to_value(&response);
    }
    if method == "getSignaturesOfType" {
        let params =
            params.ok_or_else(|| into_napi_error("getSignaturesOfType requires params"))?;
        let params = from_value::<SignatureOfTypeParams>(params)?;
        let source_override = signature_source_override(params.file, params.source_text);
        let response = block_on(get_signatures_of_type_with_parameter_texts(
            client,
            SnapshotHandle::from(params.snapshot.as_str()),
            ProjectHandle::from(params.project.as_str()),
            TypeHandle::from(params.type_handle.as_str()),
            params.kind,
            source_override.as_ref(),
        ))
        .map_err(into_napi_error)?;
        return to_value(&response);
    }
    if method == "getCallSignatureFacts" {
        let params =
            params.ok_or_else(|| into_napi_error("getCallSignatureFacts requires params"))?;
        let params = from_value::<CallSignatureFactsParams>(params)?;
        let source_override = signature_source_override(params.file, params.source_text);
        let response = block_on(get_call_signature_facts(
            client,
            CallSignatureFactsLookup {
                snapshot: SnapshotHandle::from(params.snapshot.as_str()),
                project: ProjectHandle::from(params.project.as_str()),
                r#type: TypeHandle::from(params.type_handle.as_str()),
                kind: params.kind,
                source_override: source_override.as_ref(),
                argument_type_texts: params.argument_type_texts,
                explicit_type_argument_texts: params.explicit_type_argument_texts,
            },
        ))
        .map_err(into_napi_error)?;
        return to_value(&response);
    }

    let response = block_on(client.raw_json_request(method, optional_value(params)))
        .map_err(into_napi_error)?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{
        parameter_ranges_for_signature_declaration, raw_byte_range,
        signature_declaration_byte_ranges,
    };

    #[test]
    fn falls_back_to_raw_byte_ranges_for_non_ascii_signature_handles() {
        let declaration = "constructor(scope: unknown, id: string, props?: ThingProps) {}";
        let source_text =
            format!("export class Thing {{\n  /** doesn’t “one” – */\n  {declaration}\n}}");
        let declaration_start = source_text.find(declaration).unwrap();
        let declaration_end = declaration_start + declaration.len();

        let ranges = signature_declaration_byte_ranges(
            &source_text,
            declaration_start as u32,
            declaration_end as u32,
        );

        assert_eq!(
            ranges.last().copied(),
            Some((declaration_start, declaration_end))
        );
        assert_eq!(
            raw_byte_range(
                &source_text,
                declaration_start as u32,
                declaration_end as u32
            ),
            Some((declaration_start, declaration_end))
        );
    }

    #[test]
    fn resolves_parameter_names_from_raw_byte_declaration_ranges() {
        let declaration = "constructor(scope: unknown, id: string, props?: ThingProps) {}";
        let source_text =
            format!("export class Thing {{\n  /** doesn’t “one” – */\n  {declaration}\n}}");
        let declaration_start = source_text.find(declaration).unwrap();
        let declaration_end = declaration_start + declaration.len();

        let parameters = parameter_ranges_for_signature_declaration(
            &source_text,
            declaration_start as u32,
            declaration_end as u32,
            3,
        );

        assert_eq!(
            parameters
                .into_iter()
                .map(|(name, _, _)| name)
                .collect::<Vec<_>>(),
            vec!["scope", "id", "props"]
        );
    }

    #[test]
    fn resolves_non_ascii_parameter_names_from_declaration_ranges() {
        let declaration =
            "constructor(public name: string, public 識別子: number, public other: boolean) {}";
        let source_text = format!("class C {{\n  {declaration}\n}}");
        let declaration_start = source_text.find(declaration).unwrap();
        let declaration_end = declaration_start + declaration.len();

        let parameters = parameter_ranges_for_signature_declaration(
            &source_text,
            declaration_start as u32,
            declaration_end as u32,
            3,
        );

        assert_eq!(
            parameters
                .into_iter()
                .map(|(name, _, _)| name)
                .collect::<Vec<_>>(),
            vec!["name", "識別子", "other"]
        );
    }
}
