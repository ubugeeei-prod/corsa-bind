use std::sync::{Arc, Mutex};

use corsa::{
    api::{
        ApiClient, ManagedSnapshot, ProjectHandle, SnapshotHandle, SymbolHandle, TypeHandle,
        UpdateSnapshotParams,
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
    GetSymbolAtPosition {
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    },
    GetTypeArguments {
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
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

    /// Resolves type arguments for type-reference objects and returns [] otherwise.
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

    let response = block_on(client.raw_json_request(method, optional_value(params)))
        .map_err(into_napi_error)?;
    Ok(response)
}
