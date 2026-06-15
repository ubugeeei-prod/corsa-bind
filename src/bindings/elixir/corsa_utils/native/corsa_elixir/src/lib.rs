use std::{collections::HashMap, str::FromStr, sync::Mutex, time::Duration};

use corsa_client::{
    ApiClient, ApiMode, ApiSpawnConfig, ManagedSnapshot, NodeHandle, ProjectHandle, SnapshotHandle,
    SymbolHandle, TypeHandle, UpdateSnapshotParams,
};
use corsa_core::utils;
use corsa_lsp::{VirtualChange, VirtualDocument};
use corsa_runtime::block_on;
use lsp_types::{Position, Range, Uri};
use rustler::{Atom, Binary, Env, Error, NifResult, OwnedBinary, ResourceArc, Term};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};

mod atoms {
    rustler::atoms! {
        ok
    }
}

struct DocumentResource {
    inner: Mutex<VirtualDocument>,
}

impl rustler::Resource for DocumentResource {}

struct ApiClientState {
    inner: ApiClient,
    snapshots: HashMap<String, ManagedSnapshot>,
}

struct ApiClientResource {
    inner: Mutex<Option<ApiClientState>>,
}

impl rustler::Resource for ApiClientResource {}

impl Drop for ApiClientResource {
    fn drop(&mut self) {
        if let Ok(mut state) = self.inner.lock() {
            if let Some(state) = state.take() {
                let _ = close_state(state);
            }
        }
    }
}

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

const OBJECT_FLAGS_REFERENCE: u32 = 1 << 2;

fn load(env: Env, _term: Term) -> bool {
    env.register::<DocumentResource>().is_ok() && env.register::<ApiClientResource>().is_ok()
}

fn nif_error<T>(message: impl ToString) -> NifResult<T> {
    Err(Error::Term(Box::new(message.to_string())))
}

fn read_json<T>(input: &str, label: &str) -> NifResult<T>
where
    T: DeserializeOwned,
{
    serde_json::from_str(input)
        .map_err(|error| Error::Term(Box::new(format!("invalid {label}: {error}"))))
}

fn read_optional_json<T>(input: &str, label: &str) -> NifResult<Option<T>>
where
    T: DeserializeOwned,
{
    if input.is_empty() {
        return Ok(None);
    }
    read_json(input, label).map(Some)
}

fn serialize_json<T>(value: &T) -> NifResult<String>
where
    T: Serialize,
{
    serde_json::to_string(value).map_err(|error| Error::Term(Box::new(error.to_string())))
}

fn build_spawn_config(options: SpawnOptions) -> NifResult<ApiSpawnConfig> {
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

fn parse_mode(mode: &str) -> NifResult<ApiMode> {
    match mode {
        "jsonrpc" => Ok(ApiMode::AsyncJsonRpcStdio),
        "msgpack" => Ok(ApiMode::SyncMsgpackStdio),
        _ => nif_error("unknown corsa api mode"),
    }
}

fn close_state(state: ApiClientState) -> Result<(), String> {
    for snapshot in state.snapshots.into_values() {
        block_on(snapshot.release()).map_err(|error| error.to_string())?;
    }
    block_on(state.inner.close()).map_err(|error| error.to_string())
}

fn with_client<T>(
    client: ResourceArc<ApiClientResource>,
    operation: impl FnOnce(&mut ApiClientState) -> NifResult<T>,
) -> NifResult<T> {
    let mut state = client
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("corsa api client state poisoned")))?;
    let Some(state) = state.as_mut() else {
        return nif_error("corsa api client is closed");
    };
    operation(state)
}

fn into_binary<'a>(env: Env<'a>, bytes: Vec<u8>) -> NifResult<Binary<'a>> {
    let mut binary = OwnedBinary::new(bytes.len())
        .ok_or_else(|| Error::Term(Box::new("failed to allocate binary")))?;
    binary.as_mut_slice().copy_from_slice(bytes.as_slice());
    Ok(binary.release(env))
}

#[rustler::nif]
fn classify_type_text(text: String) -> String {
    utils::classify_type_text(Some(text.as_str())).to_string()
}

#[rustler::nif]
fn split_top_level_type_text(text: String, delimiter: u32) -> NifResult<Vec<String>> {
    let Some(delimiter) = char::from_u32(delimiter) else {
        return nif_error("delimiter must be a valid Unicode scalar value");
    };
    Ok(utils::split_top_level_type_text(text.as_str(), delimiter))
}

#[rustler::nif]
fn split_type_text(text: String) -> Vec<String> {
    utils::split_type_text(text.as_str())
}

macro_rules! single_slice_predicate {
    ($name:ident, $predicate:ident) => {
        #[rustler::nif]
        fn $name(type_texts: Vec<String>) -> bool {
            let refs = type_texts.iter().map(String::as_str).collect::<Vec<_>>();
            utils::$predicate(&refs)
        }
    };
}

macro_rules! dual_slice_predicate {
    ($name:ident, $predicate:ident) => {
        #[rustler::nif]
        fn $name(type_texts: Vec<String>, property_names: Vec<String>) -> bool {
            let type_refs = type_texts.iter().map(String::as_str).collect::<Vec<_>>();
            let property_refs = property_names
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            utils::$predicate(&type_refs, &property_refs)
        }
    };
}

macro_rules! flow_predicate {
    ($name:ident, $predicate:ident) => {
        #[rustler::nif]
        fn $name(source_texts: Vec<String>, target_texts: Vec<String>) -> bool {
            let source_refs = source_texts.iter().map(String::as_str).collect::<Vec<_>>();
            let target_refs = target_texts.iter().map(String::as_str).collect::<Vec<_>>();
            utils::$predicate(&source_refs, &target_refs)
        }
    };
}

single_slice_predicate!(is_string_like_type_texts, is_string_like_type_texts);
single_slice_predicate!(is_number_like_type_texts, is_number_like_type_texts);
single_slice_predicate!(is_bigint_like_type_texts, is_bigint_like_type_texts);
single_slice_predicate!(is_any_like_type_texts, is_any_like_type_texts);
single_slice_predicate!(is_unknown_like_type_texts, is_unknown_like_type_texts);
single_slice_predicate!(is_array_like_type_texts, is_array_like_type_texts);
dual_slice_predicate!(is_promise_like_type_texts, is_promise_like_type_texts);
dual_slice_predicate!(is_error_like_type_texts, is_error_like_type_texts);
flow_predicate!(has_unsafe_any_flow, has_unsafe_any_flow);
flow_predicate!(is_unsafe_assignment, is_unsafe_assignment);
flow_predicate!(is_unsafe_return, is_unsafe_return);

#[rustler::nif]
fn virtual_document_new(
    uri: String,
    language_id: String,
    text: String,
) -> NifResult<ResourceArc<DocumentResource>> {
    let uri = Uri::from_str(uri.as_str())
        .map_err(|error| Error::Term(Box::new(format!("invalid uri: {error}"))))?;
    Ok(ResourceArc::new(DocumentResource {
        inner: Mutex::new(VirtualDocument::new(uri, language_id, text)),
    }))
}

#[rustler::nif]
fn virtual_document_untitled(
    path: String,
    language_id: String,
    text: String,
) -> NifResult<ResourceArc<DocumentResource>> {
    let document = VirtualDocument::untitled(path, language_id, text)
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
    Ok(ResourceArc::new(DocumentResource {
        inner: Mutex::new(document),
    }))
}

#[rustler::nif]
fn virtual_document_in_memory(
    authority: String,
    path: String,
    language_id: String,
    text: String,
) -> NifResult<ResourceArc<DocumentResource>> {
    let document = VirtualDocument::in_memory(authority, path, language_id, text)
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
    Ok(ResourceArc::new(DocumentResource {
        inner: Mutex::new(document),
    }))
}

#[rustler::nif]
fn virtual_document_uri(document: ResourceArc<DocumentResource>) -> NifResult<String> {
    let document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    Ok(document.uri.to_string())
}

#[rustler::nif]
fn virtual_document_language_id(document: ResourceArc<DocumentResource>) -> NifResult<String> {
    let document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    Ok(document.language_id.to_string())
}

#[rustler::nif]
fn virtual_document_text(document: ResourceArc<DocumentResource>) -> NifResult<String> {
    let document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    Ok(document.text.to_string())
}

#[rustler::nif]
fn virtual_document_key(document: ResourceArc<DocumentResource>) -> NifResult<String> {
    let document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    Ok(document.key().to_string())
}

#[rustler::nif]
fn virtual_document_version(document: ResourceArc<DocumentResource>) -> NifResult<i32> {
    let document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    Ok(document.version)
}

#[rustler::nif]
fn virtual_document_replace(
    document: ResourceArc<DocumentResource>,
    text: String,
) -> NifResult<Atom> {
    let mut document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    document
        .apply_changes(&[VirtualChange::replace(text)])
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
    Ok(atoms::ok())
}

#[rustler::nif]
fn virtual_document_splice(
    document: ResourceArc<DocumentResource>,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
    text: String,
) -> NifResult<Atom> {
    let mut document = document
        .inner
        .lock()
        .map_err(|_| Error::Term(Box::new("virtual document state poisoned")))?;
    let range = Range::new(
        Position::new(start_line, start_character),
        Position::new(end_line, end_character),
    );
    document
        .apply_changes(&[VirtualChange::splice(range, text)])
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
    Ok(atoms::ok())
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_spawn(options_json: String) -> NifResult<ResourceArc<ApiClientResource>> {
    let options = read_json::<SpawnOptions>(options_json.as_str(), "options_json")?;
    let config = build_spawn_config(options)?;
    let inner = block_on(ApiClient::spawn(config))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
    Ok(ResourceArc::new(ApiClientResource {
        inner: Mutex::new(Some(ApiClientState {
            inner,
            snapshots: HashMap::new(),
        })),
    }))
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_initialize_json(client: ResourceArc<ApiClientResource>) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.initialize())
            .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(response.as_ref())
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_parse_config_file_json(
    client: ResourceArc<ApiClientResource>,
    file: String,
) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.parse_config_file(file))
            .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_update_snapshot_json(
    client: ResourceArc<ApiClientResource>,
    params_json: String,
) -> NifResult<String> {
    with_client(client, |state| {
        let params =
            read_optional_json::<UpdateSnapshotParams>(params_json.as_str(), "params_json")?
                .unwrap_or_default();
        let snapshot = block_on(state.inner.update_snapshot(params))
            .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        let payload = serialize_json(&SnapshotState {
            snapshot: &snapshot.handle,
            projects: snapshot.projects.as_slice(),
            changes: &snapshot.changes,
        })?;
        state
            .snapshots
            .insert(snapshot.handle.as_str().to_owned(), snapshot);
        Ok(payload)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_source_file<'a>(
    env: Env<'a>,
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    file: String,
) -> NifResult<Option<Binary<'a>>> {
    with_client(client, |state| {
        let payload = block_on(state.inner.get_source_file(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        payload
            .map(|payload| into_binary(env, payload.into_bytes()))
            .transpose()
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_string_type_json(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.get_string_type(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_type_at_position_json(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    file: String,
    position: u32,
) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.get_type_at_position(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
            position,
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_symbol_at_position_json(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    file: String,
    position: u32,
) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.get_symbol_at_position(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            file,
            position,
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_type_arguments_json(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    type_handle: String,
    object_flags: u32,
) -> NifResult<String> {
    with_client(client, |state| {
        if object_flags & OBJECT_FLAGS_REFERENCE == 0 {
            return serialize_json(&Vec::<corsa_client::TypeResponse>::new());
        }
        let response = block_on(state.inner.get_type_arguments(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            TypeHandle::from(type_handle.as_str()),
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_type_of_symbol_json(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    symbol: String,
) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.get_type_of_symbol(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            SymbolHandle::from(symbol.as_str()),
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_get_declared_type_of_symbol_json(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    symbol: String,
) -> NifResult<String> {
    with_client(client, |state| {
        let response = block_on(state.inner.get_declared_type_of_symbol(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            SymbolHandle::from(symbol.as_str()),
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_type_to_string(
    client: ResourceArc<ApiClientResource>,
    snapshot: String,
    project: String,
    type_handle: String,
    location: String,
    flags: i32,
) -> NifResult<String> {
    with_client(client, |state| {
        block_on(state.inner.type_to_string(
            SnapshotHandle::from(snapshot.as_str()),
            ProjectHandle::from(project.as_str()),
            TypeHandle::from(type_handle.as_str()),
            (!location.is_empty()).then(|| NodeHandle::from(location.as_str())),
            (flags >= 0).then_some(flags),
        ))
        .map_err(|error| Error::Term(Box::new(error.to_string())))
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_call_json(
    client: ResourceArc<ApiClientResource>,
    method: String,
    params_json: String,
) -> NifResult<String> {
    with_client(client, |state| {
        let params = read_optional_json::<Value>(params_json.as_str(), "params_json")?
            .unwrap_or(Value::Null);
        let response = block_on(state.inner.raw_json_request(method.as_str(), params))
            .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        serialize_json(&response)
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_call_binary<'a>(
    env: Env<'a>,
    client: ResourceArc<ApiClientResource>,
    method: String,
    params_json: String,
) -> NifResult<Option<Binary<'a>>> {
    with_client(client, |state| {
        let params = read_optional_json::<Value>(params_json.as_str(), "params_json")?
            .unwrap_or(Value::Null);
        let response = block_on(state.inner.raw_binary_request(method.as_str(), params))
            .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        response
            .map(|payload| into_binary(env, payload.into_bytes()))
            .transpose()
    })
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_release_handle(
    client: ResourceArc<ApiClientResource>,
    handle: String,
) -> NifResult<Atom> {
    with_client(client, |state| {
        let snapshot = state.snapshots.remove(handle.as_str());
        if let Some(snapshot) = snapshot {
            block_on(snapshot.release())
                .map_err(|error| Error::Term(Box::new(error.to_string())))?;
            return Ok(atoms::ok());
        }
        block_on(
            state
                .inner
                .raw_json_request("release", release_handle_params(handle.as_str())),
        )
        .map_err(|error| Error::Term(Box::new(error.to_string())))?;
        Ok(atoms::ok())
    })
}

fn release_handle_params(handle: &str) -> serde_json::Value {
    match parse_numeric_snapshot_handle(handle) {
        Some(snapshot) => json!({ "handle": handle, "snapshot": snapshot }),
        None => json!({ "handle": handle }),
    }
}

fn parse_numeric_snapshot_handle(handle: &str) -> Option<u64> {
    if handle.is_empty() || (handle.len() > 1 && handle.starts_with('0')) {
        return None;
    }
    handle
        .bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| handle.parse().ok())?
}

#[rustler::nif(schedule = "DirtyIo")]
fn api_client_close(client: ResourceArc<ApiClientResource>) -> NifResult<Atom> {
    let state = {
        let mut state = client
            .inner
            .lock()
            .map_err(|_| Error::Term(Box::new("corsa api client state poisoned")))?;
        state.take()
    };
    if let Some(state) = state {
        close_state(state).map_err(|error| Error::Term(Box::new(error)))?;
    }
    Ok(atoms::ok())
}

rustler::init!("Elixir.Corsa.Native", load = load);
