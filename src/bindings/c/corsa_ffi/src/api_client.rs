use std::{collections::HashMap, sync::Mutex, time::Duration};

use corsa_client::{
    ApiClient, ApiMode, ApiSpawnConfig, ManagedSnapshot, NodeHandle, ProjectHandle, SnapshotHandle,
    SymbolHandle, TypeHandle, UpdateSnapshotParams,
};
use corsa_runtime::block_on;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{
    error::{clear_last_error, set_last_error},
    types::{CorsaBytes, CorsaStrRef, CorsaString, into_c_bytes, into_c_string},
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnOptions {
    executable: String,
    cwd: Option<String>,
    mode: Option<String>,
    request_timeout_ms: Option<u64>,
    shutdown_timeout_ms: Option<u64>,
    outbound_capacity: Option<usize>,
    allow_unstable_upstream_calls: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotState<'a> {
    snapshot: &'a SnapshotHandle,
    projects: &'a [corsa_client::ProjectResponse],
    #[serde(skip_serializing_if = "Option::is_none")]
    changes: &'a Option<corsa_client::SnapshotChanges>,
}

pub struct CorsaApiClient {
    inner: ApiClient,
    snapshots: Mutex<HashMap<String, ManagedSnapshot>>,
}

const OBJECT_FLAGS_REFERENCE: u32 = 1 << 2;

fn build_spawn_config(options: SpawnOptions) -> Result<ApiSpawnConfig, String> {
    let mut config = ApiSpawnConfig::new(options.executable);
    if let Some(cwd) = options.cwd {
        config = config.with_cwd(cwd);
    }
    if let Some(mode) = options.mode {
        config = config.with_mode(parse_mode(mode.as_str())?);
    }
    if let Some(timeout_ms) = options.request_timeout_ms {
        config = config.with_request_timeout(Some(Duration::from_millis(timeout_ms)));
    }
    if let Some(timeout_ms) = options.shutdown_timeout_ms {
        config = config.with_shutdown_timeout(Duration::from_millis(timeout_ms));
    }
    if let Some(capacity) = options.outbound_capacity {
        config = config.with_outbound_capacity(capacity);
    }
    if let Some(allow) = options.allow_unstable_upstream_calls {
        config = config.with_allow_unstable_upstream_calls(allow);
    }
    Ok(config)
}

fn parse_mode(mode: &str) -> Result<ApiMode, String> {
    match mode {
        "jsonrpc" => Ok(ApiMode::AsyncJsonRpcStdio),
        "msgpack" => Ok(ApiMode::SyncMsgpackStdio),
        _ => Err("unknown corsa api mode".to_owned()),
    }
}

fn read_required_text(input: CorsaStrRef, label: &str) -> Option<String> {
    let Some(text) = (unsafe { input.as_str() }) else {
        set_last_error(format!("{label} must be valid UTF-8"));
        return None;
    };
    Some(text.to_owned())
}

fn read_optional_text(input: CorsaStrRef, label: &str) -> Option<Option<String>> {
    let Some(text) = (unsafe { input.as_str() }) else {
        set_last_error(format!("{label} must be valid UTF-8"));
        return None;
    };
    if text.is_empty() {
        return Some(None);
    }
    Some(Some(text.to_owned()))
}

fn read_json<T>(input: CorsaStrRef, label: &str) -> Option<T>
where
    T: DeserializeOwned,
{
    let text = read_required_text(input, label)?;
    match serde_json::from_str(text.as_str()) {
        Ok(value) => Some(value),
        Err(error) => {
            set_last_error(format!("invalid {label}: {error}"));
            None
        }
    }
}

fn read_optional_json<T>(input: CorsaStrRef, label: &str) -> Option<Option<T>>
where
    T: DeserializeOwned,
{
    let text = read_optional_text(input, label)?;
    let Some(text) = text else {
        return Some(None);
    };
    match serde_json::from_str(text.as_str()) {
        Ok(value) => Some(Some(value)),
        Err(error) => {
            set_last_error(format!("invalid {label}: {error}"));
            None
        }
    }
}

fn take_json<T>(value: &T) -> CorsaString
where
    T: Serialize,
{
    match serialize_json(value) {
        Ok(value) => into_c_string(value.as_str()),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

fn serialize_json<T>(value: &T) -> Result<String, String>
where
    T: Serialize,
{
    serde_json::to_string(value).map_err(|error| error.to_string())
}

unsafe fn client_ref<'a>(value: *const CorsaApiClient) -> Option<&'a CorsaApiClient> {
    let Some(value) = (unsafe { value.as_ref() }) else {
        set_last_error("corsa api client handle is null");
        return None;
    };
    Some(value)
}

unsafe fn client_mut<'a>(value: *mut CorsaApiClient) -> Option<&'a mut CorsaApiClient> {
    let Some(value) = (unsafe { value.as_mut() }) else {
        set_last_error("corsa api client handle is null");
        return None;
    };
    Some(value)
}

fn close_client(client: &CorsaApiClient) -> Result<(), String> {
    let snapshots = std::mem::take(
        &mut *client
            .snapshots
            .lock()
            .map_err(|_| "corsa api client state poisoned".to_owned())?,
    );
    for snapshot in snapshots.into_values() {
        block_on(snapshot.release()).map_err(|error| error.to_string())?;
    }
    block_on(client.inner.close()).map_err(|error| error.to_string())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_spawn(options_json: CorsaStrRef) -> *mut CorsaApiClient {
    let Some(options) = read_json::<SpawnOptions>(options_json, "options_json") else {
        return std::ptr::null_mut();
    };
    let config = match build_spawn_config(options) {
        Ok(config) => config,
        Err(error) => {
            set_last_error(error);
            return std::ptr::null_mut();
        }
    };
    match block_on(ApiClient::spawn(config)) {
        Ok(inner) => {
            clear_last_error();
            Box::into_raw(Box::new(CorsaApiClient {
                inner,
                snapshots: Mutex::new(HashMap::new()),
            }))
        }
        Err(error) => {
            set_last_error(error);
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_initialize_json(
    value: *const CorsaApiClient,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    match block_on(client.inner.initialize()) {
        Ok(response) => take_json(response.as_ref()),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_parse_config_file_json(
    value: *const CorsaApiClient,
    file: CorsaStrRef,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(file) = read_required_text(file, "file") else {
        return CorsaString::default();
    };
    match block_on(client.inner.parse_config_file(file)) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_update_snapshot_json(
    value: *const CorsaApiClient,
    params_json: CorsaStrRef,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let params = match read_optional_json::<UpdateSnapshotParams>(params_json, "params_json") {
        Some(Some(params)) => params,
        Some(None) => UpdateSnapshotParams::default(),
        None => return CorsaString::default(),
    };
    match block_on(client.inner.update_snapshot(params)) {
        Ok(snapshot) => {
            let state = match serialize_json(&SnapshotState {
                snapshot: &snapshot.handle,
                projects: snapshot.projects.as_slice(),
                changes: &snapshot.changes,
            }) {
                Ok(state) => state,
                Err(error) => {
                    set_last_error(error);
                    return CorsaString::default();
                }
            };
            let handle = snapshot.handle.clone();
            let Ok(mut snapshots) = client.snapshots.lock() else {
                set_last_error("corsa api client state poisoned");
                return CorsaString::default();
            };
            snapshots.insert(handle.as_str().to_owned(), snapshot);
            clear_last_error();
            into_c_string(state.as_str())
        }
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_source_file(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    file: CorsaStrRef,
) -> CorsaBytes {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaBytes::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaBytes::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaBytes::default();
    };
    let Some(file) = read_required_text(file, "file") else {
        return CorsaBytes::default();
    };
    match block_on(client.inner.get_source_file(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        file,
    )) {
        Ok(payload) => {
            clear_last_error();
            into_c_bytes(payload.map(|payload| payload.into_bytes()))
        }
        Err(error) => {
            set_last_error(error);
            CorsaBytes::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_string_type_json(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    match block_on(client.inner.get_string_type(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
    )) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_type_at_position_json(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    file: CorsaStrRef,
    position: u32,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    let Some(file) = read_required_text(file, "file") else {
        return CorsaString::default();
    };
    match block_on(client.inner.get_type_at_position(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        file,
        position,
    )) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_symbol_at_position_json(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    file: CorsaStrRef,
    position: u32,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    let Some(file) = read_required_text(file, "file") else {
        return CorsaString::default();
    };
    match block_on(client.inner.get_symbol_at_position(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        file,
        position,
    )) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_type_arguments_json(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    type_handle: CorsaStrRef,
    object_flags: u32,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    let Some(type_handle) = read_required_text(type_handle, "type_handle") else {
        return CorsaString::default();
    };
    if object_flags & OBJECT_FLAGS_REFERENCE == 0 {
        return take_json(&Vec::<corsa_client::TypeResponse>::new());
    }
    match block_on(client.inner.get_type_arguments(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        TypeHandle::from(type_handle.as_str()),
    )) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_type_of_symbol_json(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    symbol: CorsaStrRef,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    let Some(symbol) = read_required_text(symbol, "symbol") else {
        return CorsaString::default();
    };
    match block_on(client.inner.get_type_of_symbol(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        SymbolHandle::from(symbol.as_str()),
    )) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_get_declared_type_of_symbol_json(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    symbol: CorsaStrRef,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    let Some(symbol) = read_required_text(symbol, "symbol") else {
        return CorsaString::default();
    };
    match block_on(client.inner.get_declared_type_of_symbol(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        SymbolHandle::from(symbol.as_str()),
    )) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_type_to_string(
    value: *const CorsaApiClient,
    snapshot: CorsaStrRef,
    project: CorsaStrRef,
    type_handle: CorsaStrRef,
    location: CorsaStrRef,
    flags: i32,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(snapshot) = read_required_text(snapshot, "snapshot") else {
        return CorsaString::default();
    };
    let Some(project) = read_required_text(project, "project") else {
        return CorsaString::default();
    };
    let Some(type_handle) = read_required_text(type_handle, "type_handle") else {
        return CorsaString::default();
    };
    let Some(location) = read_optional_text(location, "location") else {
        return CorsaString::default();
    };
    match block_on(client.inner.type_to_string(
        SnapshotHandle::from(snapshot.as_str()),
        ProjectHandle::from(project.as_str()),
        TypeHandle::from(type_handle.as_str()),
        location.as_deref().map(NodeHandle::from),
        (flags >= 0).then_some(flags),
    )) {
        Ok(response) => {
            clear_last_error();
            into_c_string(response.as_str())
        }
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_call_json(
    value: *const CorsaApiClient,
    method: CorsaStrRef,
    params_json: CorsaStrRef,
) -> CorsaString {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaString::default();
    };
    let Some(method) = read_required_text(method, "method") else {
        return CorsaString::default();
    };
    let params = match read_optional_json::<Value>(params_json, "params_json") {
        Some(Some(params)) => params,
        Some(None) => Value::Null,
        None => return CorsaString::default(),
    };
    match block_on(client.inner.raw_json_request(method.as_str(), params)) {
        Ok(response) => take_json(&response),
        Err(error) => {
            set_last_error(error);
            CorsaString::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_call_binary(
    value: *const CorsaApiClient,
    method: CorsaStrRef,
    params_json: CorsaStrRef,
) -> CorsaBytes {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return CorsaBytes::default();
    };
    let Some(method) = read_required_text(method, "method") else {
        return CorsaBytes::default();
    };
    let params = match read_optional_json::<Value>(params_json, "params_json") {
        Some(Some(params)) => params,
        Some(None) => Value::Null,
        None => return CorsaBytes::default(),
    };
    match block_on(client.inner.raw_binary_request(method.as_str(), params)) {
        Ok(response) => {
            clear_last_error();
            into_c_bytes(response.map(|payload| payload.into_bytes()))
        }
        Err(error) => {
            set_last_error(error);
            CorsaBytes::default()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_release_handle(
    value: *const CorsaApiClient,
    handle: CorsaStrRef,
) -> bool {
    let Some(client) = (unsafe { client_ref(value) }) else {
        return false;
    };
    let Some(handle) = read_required_text(handle, "handle") else {
        return false;
    };
    let snapshot = {
        let Ok(mut snapshots) = client.snapshots.lock() else {
            set_last_error("corsa api client state poisoned");
            return false;
        };
        snapshots.remove(handle.as_str())
    };
    if let Some(snapshot) = snapshot {
        match block_on(snapshot.release()) {
            Ok(()) => {
                clear_last_error();
                return true;
            }
            Err(error) => {
                set_last_error(error);
                return false;
            }
        }
    }
    match block_on(
        client
            .inner
            .raw_json_request("release", json!({ "handle": handle })),
    ) {
        Ok(_) => {
            clear_last_error();
            true
        }
        Err(error) => {
            set_last_error(error);
            false
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_close(value: *mut CorsaApiClient) -> bool {
    let Some(client) = (unsafe { client_mut(value) }) else {
        return false;
    };
    match close_client(client) {
        Ok(()) => {
            clear_last_error();
            true
        }
        Err(error) => {
            set_last_error(error);
            false
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_api_client_free(value: *mut CorsaApiClient) {
    if value.is_null() {
        return;
    }
    let client = unsafe { Box::from_raw(value) };
    let _ = close_client(&client);
}
