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
    Result, Task,
    bindgen_prelude::{AsyncTask, Buffer},
};
use napi_derive::napi;
use serde::Serialize;

use crate::util::{
    SpawnOptions, build_spawn_config, into_napi_error, parse_json, parse_optional_json, to_json,
};

const OBJECT_FLAGS_REFERENCE: u32 = 1 << 2;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotState<'a> {
    snapshot: &'a SnapshotHandle,
    projects: &'a [corsa::api::ProjectResponse],
    #[serde(skip_serializing_if = "Option::is_none")]
    changes: &'a Option<corsa::api::SnapshotChanges>,
}

type SnapshotStore = Arc<Mutex<FastMap<CompactString, ManagedSnapshot>>>;

pub struct SpawnApiClientTask {
    options_json: String,
}

#[napi]
impl Task for SpawnApiClientTask {
    type Output = TsgoApiClient;
    type JsValue = TsgoApiClient;

    fn compute(&mut self) -> Result<Self::Output> {
        let options = parse_json::<SpawnOptions>(self.options_json.as_str())?;
        let inner =
            block_on(ApiClient::spawn(build_spawn_config(options)?)).map_err(into_napi_error)?;
        Ok(TsgoApiClient {
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
        params_json: Option<String>,
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
    TypeToString {
        snapshot: String,
        project: String,
        type_handle: String,
        location: Option<String>,
        flags: Option<i32>,
    },
    CallJson {
        method: String,
        params_json: Option<String>,
    },
}

pub struct JsonApiTask {
    client: ApiClient,
    kind: JsonTaskKind,
}

#[napi]
impl Task for JsonApiTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        match &mut self.kind {
            JsonTaskKind::Initialize => {
                let response = block_on(self.client.initialize()).map_err(into_napi_error)?;
                to_json(response.as_ref())
            }
            JsonTaskKind::ParseConfigFile { file } => {
                let response = block_on(self.client.parse_config_file(file.clone()))
                    .map_err(into_napi_error)?;
                to_json(&response)
            }
            JsonTaskKind::UpdateSnapshot {
                params_json,
                snapshots,
            } => {
                let params = match params_json.take() {
                    Some(params_json) => parse_json::<UpdateSnapshotParams>(params_json.as_str())?,
                    None => UpdateSnapshotParams::default(),
                };
                let snapshot =
                    block_on(self.client.update_snapshot(params)).map_err(into_napi_error)?;
                let handle = snapshot.handle.clone();
                let state = to_json(&SnapshotState {
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
                to_json(&response)
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
                to_json(&response)
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
                to_json(&response)
            }
            JsonTaskKind::GetTypeArguments {
                snapshot,
                project,
                type_handle,
                object_flags,
            } => {
                if object_flags.unwrap_or_default() & OBJECT_FLAGS_REFERENCE == 0 {
                    return to_json(&Vec::<corsa::api::TypeResponse>::new());
                }
                let response = block_on(self.client.get_type_arguments(
                    SnapshotHandle::from(snapshot.as_str()),
                    ProjectHandle::from(project.as_str()),
                    TypeHandle::from(type_handle.as_str()),
                ))
                .map_err(into_napi_error)?;
                to_json(&response)
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
                to_json(&response)
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
                to_json(&response)
            }
            JsonTaskKind::TypeToString {
                snapshot,
                project,
                type_handle,
                location,
                flags,
            } => block_on(
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
            .map_err(into_napi_error),
            JsonTaskKind::CallJson {
                method,
                params_json,
            } => {
                let params = parse_optional_json(params_json.take())?;
                let response = block_on(self.client.raw_json_request(method.as_str(), params))
                    .map_err(into_napi_error)?;
                to_json(&response)
            }
        }
    }

    fn resolve(&mut self, _: napi::Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
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
        params_json: Option<String>,
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
            BinaryTaskKind::CallBinary {
                method,
                params_json,
            } => {
                let params = parse_optional_json(params_json.take())?;
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
pub fn spawn_tsgo_api_client_async(options_json: String) -> AsyncTask<SpawnApiClientTask> {
    AsyncTask::new(SpawnApiClientTask { options_json })
}

/// Thin synchronous wrapper around the Rust stdio API client.
#[napi]
pub struct TsgoApiClient {
    inner: ApiClient,
    snapshots: SnapshotStore,
}

#[napi]
impl TsgoApiClient {
    /// Spawns a new client from a JSON-encoded spawn config.
    #[napi(factory)]
    pub fn spawn(options_json: String) -> Result<Self> {
        let options = parse_json::<SpawnOptions>(options_json.as_str())?;
        let inner =
            block_on(ApiClient::spawn(build_spawn_config(options)?)).map_err(into_napi_error)?;
        Ok(Self {
            inner,
            snapshots: Arc::new(Mutex::new(FastMap::default())),
        })
    }

    /// Calls `initialize` and returns the raw JSON response.
    #[napi]
    pub fn initialize_json(&self) -> Result<String> {
        let response = block_on(self.inner.initialize()).map_err(into_napi_error)?;
        to_json(response.as_ref())
    }

    /// Calls `initialize` without blocking the JavaScript event loop.
    #[napi]
    pub fn initialize_json_async(&self) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::Initialize,
        })
    }

    /// Parses a `tsconfig` through tsgo and returns the JSON response.
    #[napi]
    pub fn parse_config_file_json(&self, file: String) -> Result<String> {
        let response = block_on(self.inner.parse_config_file(file)).map_err(into_napi_error)?;
        to_json(&response)
    }

    /// Parses a `tsconfig` on a libuv worker thread.
    #[napi]
    pub fn parse_config_file_json_async(&self, file: String) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::ParseConfigFile { file },
        })
    }

    /// Applies file changes and returns a serialized snapshot record.
    #[napi]
    pub fn update_snapshot_json(&self, params_json: Option<String>) -> Result<String> {
        let params = match params_json {
            Some(params_json) => parse_json::<UpdateSnapshotParams>(params_json.as_str())?,
            None => UpdateSnapshotParams::default(),
        };
        let snapshot = block_on(self.inner.update_snapshot(params)).map_err(into_napi_error)?;
        let handle = snapshot.handle.clone();
        let state = to_json(&SnapshotState {
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
    pub fn update_snapshot_json_async(
        &self,
        params_json: Option<String>,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::UpdateSnapshot {
                params_json,
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
    pub fn get_string_type_json(&self, snapshot: String, project: String) -> Result<String> {
        let response = block_on(self.inner.get_string_type(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_json(&response)
    }

    #[napi]
    pub fn get_string_type_json_async(
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
    pub fn get_type_at_position_json(
        &self,
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    ) -> Result<String> {
        let response = block_on(self.inner.get_type_at_position(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
            position,
        ))
        .map_err(into_napi_error)?;
        to_json(&response)
    }

    #[napi]
    pub fn get_type_at_position_json_async(
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
    pub fn get_symbol_at_position_json(
        &self,
        snapshot: String,
        project: String,
        file: String,
        position: u32,
    ) -> Result<String> {
        let response = block_on(self.inner.get_symbol_at_position(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
            position,
        ))
        .map_err(into_napi_error)?;
        to_json(&response)
    }

    #[napi]
    pub fn get_symbol_at_position_json_async(
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
    pub fn get_type_arguments_json(
        &self,
        snapshot: String,
        project: String,
        type_handle: String,
        object_flags: Option<u32>,
    ) -> Result<String> {
        if object_flags.unwrap_or_default() & OBJECT_FLAGS_REFERENCE == 0 {
            return to_json(&Vec::<corsa::api::TypeResponse>::new());
        }
        let response = block_on(self.inner.get_type_arguments(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            TypeHandle::from(type_handle.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_json(&response)
    }

    #[napi]
    pub fn get_type_arguments_json_async(
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

    /// Resolves the apparent checker type of a symbol.
    #[napi]
    pub fn get_type_of_symbol_json(
        &self,
        snapshot: String,
        project: String,
        symbol: String,
    ) -> Result<String> {
        let response = block_on(self.inner.get_type_of_symbol(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            SymbolHandle::from(symbol.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_json(&response)
    }

    #[napi]
    pub fn get_type_of_symbol_json_async(
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
    pub fn get_declared_type_of_symbol_json(
        &self,
        snapshot: String,
        project: String,
        symbol: String,
    ) -> Result<String> {
        let response = block_on(self.inner.get_declared_type_of_symbol(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            SymbolHandle::from(symbol.as_str()),
        ))
        .map_err(into_napi_error)?;
        to_json(&response)
    }

    #[napi]
    pub fn get_declared_type_of_symbol_json_async(
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
    pub fn call_json(&self, method: String, params_json: Option<String>) -> Result<String> {
        let params = parse_optional_json(params_json)?;
        let response = block_on(self.inner.raw_json_request(method.as_str(), params))
            .map_err(into_napi_error)?;
        to_json(&response)
    }

    /// Sends an arbitrary JSON endpoint request on a libuv worker thread.
    #[napi]
    pub fn call_json_async(
        &self,
        method: String,
        params_json: Option<String>,
    ) -> AsyncTask<JsonApiTask> {
        AsyncTask::new(JsonApiTask {
            client: self.inner.clone(),
            kind: JsonTaskKind::CallJson {
                method,
                params_json,
            },
        })
    }

    /// Sends an arbitrary binary endpoint request.
    #[napi]
    pub fn call_binary(
        &self,
        method: String,
        params_json: Option<String>,
    ) -> Result<Option<Buffer>> {
        let params = parse_optional_json(params_json)?;
        let payload = block_on(self.inner.raw_binary_request(method.as_str(), params))
            .map_err(into_napi_error)?;
        Ok(payload.map(|payload| Buffer::from(payload.into_bytes())))
    }

    /// Sends an arbitrary binary endpoint request on a libuv worker thread.
    #[napi]
    pub fn call_binary_async(
        &self,
        method: String,
        params_json: Option<String>,
    ) -> AsyncTask<BinaryApiTask> {
        AsyncTask::new(BinaryApiTask {
            client: self.inner.clone(),
            kind: BinaryTaskKind::CallBinary {
                method,
                params_json,
            },
        })
    }

    /// Releases a tsgo handle explicitly.
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

    /// Releases a tsgo handle on a libuv worker thread.
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
