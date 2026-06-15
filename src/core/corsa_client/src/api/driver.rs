use std::time::Duration;

use crate::{Result, error::CorsaError, jsonrpc::JsonRpcConnection, process::AsyncChildGuard};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use corsa_core::fast::compact_format;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{sync::Arc, time::Instant};

use super::{
    SnapshotHandle,
    msgpack_worker::MsgpackWorker,
    profiling::{ApiProfileEvent, ApiProfilePhase, SharedProfiler, profile},
    requests_core::ReleaseRequest,
};

pub(crate) enum ClientDriver {
    JsonRpc {
        rpc: JsonRpcConnection,
        process: Option<Arc<AsyncChildGuard>>,
        shutdown_timeout: Duration,
    },
    Msgpack {
        worker: Arc<MsgpackWorker>,
    },
}

impl ClientDriver {
    pub(crate) async fn request_typed<T, P>(
        &self,
        method: &str,
        params: &P,
        profiler: Option<&SharedProfiler>,
    ) -> Result<T>
    where
        T: DeserializeOwned,
        P: Serialize + ?Sized,
    {
        match self {
            Self::JsonRpc { rpc, .. } => {
                if let Some(profiler) = profiler {
                    let started = Instant::now();
                    let params = serialize_api_params(params)?;
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    let started = Instant::now();
                    let value = rpc.request_value(method, params).await?;
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::Transport,
                        started.elapsed(),
                    );
                    let started = Instant::now();
                    let response = serde_json::from_value(value)?;
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::DeserializeResponse,
                        started.elapsed(),
                    );
                    Ok(response)
                } else {
                    let params = serialize_api_params(params)?;
                    let value = rpc.request_value(method, params).await?;
                    Ok(serde_json::from_value(value)?)
                }
            }
            Self::Msgpack { worker } => {
                let payload = if let Some(profiler) = profiler {
                    let started = Instant::now();
                    let params = serialize_api_params(params)?;
                    let payload = serde_json::to_vec(&params)?;
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    payload
                } else {
                    let params = serialize_api_params(params)?;
                    serde_json::to_vec(&params)?
                };
                let started = profiler.map(|_| Instant::now());
                let response = worker.request(method, payload).await?;
                if let (Some(profiler), Some(started)) = (profiler, started) {
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::Transport,
                        started.elapsed(),
                    );
                }
                let started = profiler.map(|_| Instant::now());
                let response = if response.is_empty() {
                    serde_json::from_slice(b"null")?
                } else {
                    serde_json::from_slice(&response)?
                };
                if let (Some(profiler), Some(started)) = (profiler, started) {
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::DeserializeResponse,
                        started.elapsed(),
                    );
                }
                Ok(response)
            }
        }
    }

    pub(crate) async fn request_binary_typed<P>(
        &self,
        method: &str,
        params: &P,
        profiler: Option<&SharedProfiler>,
    ) -> Result<Option<Vec<u8>>>
    where
        P: Serialize + ?Sized,
    {
        match self {
            Self::JsonRpc { rpc, .. } => {
                let params = if let Some(profiler) = profiler {
                    let started = Instant::now();
                    let params = serialize_api_params(params)?;
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    params
                } else {
                    serialize_api_params(params)?
                };
                let started = profiler.map(|_| Instant::now());
                let value = rpc.request_value(method, params).await?;
                if let (Some(profiler), Some(started)) = (profiler, started) {
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::Transport,
                        started.elapsed(),
                    );
                }
                if value.is_null() {
                    return Ok(None);
                }
                let data = value.get("data").and_then(Value::as_str).ok_or_else(|| {
                    CorsaError::Protocol(compact_format(format_args!(
                        "missing binary data for {method}"
                    )))
                })?;
                let started = profiler.map(|_| Instant::now());
                let bytes = STANDARD.decode(data)?;
                if let (Some(profiler), Some(started)) = (profiler, started) {
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::DecodeBinary,
                        started.elapsed(),
                    );
                }
                Ok(Some(bytes))
            }
            Self::Msgpack { worker } => {
                let payload = if let Some(profiler) = profiler {
                    let started = Instant::now();
                    let params = serialize_api_params(params)?;
                    let payload = serde_json::to_vec(&params)?;
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    payload
                } else {
                    let params = serialize_api_params(params)?;
                    serde_json::to_vec(&params)?
                };
                let started = profiler.map(|_| Instant::now());
                let response = worker.request(method, payload).await?;
                if let (Some(profiler), Some(started)) = (profiler, started) {
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::Transport,
                        started.elapsed(),
                    );
                }
                Ok((!response.is_empty()).then_some(response))
            }
        }
    }

    pub(crate) async fn request_json(&self, method: &str, params: Value) -> Result<Value> {
        match self {
            Self::JsonRpc { rpc, .. } => rpc.request_value(method, params).await,
            Self::Msgpack { worker } => {
                let payload = serde_json::to_vec(&params)?;
                let response = worker.request(method, payload).await?;
                if response.is_empty() {
                    Ok(Value::Null)
                } else {
                    Ok(serde_json::from_slice(&response)?)
                }
            }
        }
    }

    pub(crate) async fn request_binary(
        &self,
        method: &str,
        params: Value,
    ) -> Result<Option<Vec<u8>>> {
        match self {
            Self::JsonRpc { rpc, .. } => {
                let value = rpc.request_value(method, params).await?;
                if value.is_null() {
                    return Ok(None);
                }
                let data = value.get("data").and_then(Value::as_str).ok_or_else(|| {
                    CorsaError::Protocol(compact_format(format_args!(
                        "missing binary data for {method}"
                    )))
                })?;
                Ok(Some(STANDARD.decode(data)?))
            }
            Self::Msgpack { worker } => {
                let payload = serde_json::to_vec(&params)?;
                let response = worker.request(method, payload).await?;
                Ok((!response.is_empty()).then_some(response))
            }
        }
    }

    pub(crate) async fn release_handle(
        &self,
        handle: &SnapshotHandle,
        profiler: Option<&SharedProfiler>,
    ) -> Result<()> {
        let request = ReleaseRequest {
            handle: handle.as_str(),
            snapshot: handle,
        };
        let _: Value = self.request_typed("release", &request, profiler).await?;
        Ok(())
    }

    pub(crate) fn shutdown_timeout(&self) -> Duration {
        match self {
            Self::JsonRpc {
                shutdown_timeout, ..
            } => *shutdown_timeout,
            Self::Msgpack { .. } => Duration::from_secs(2),
        }
    }

    pub(crate) async fn close(&self) -> Result<()> {
        match self {
            Self::JsonRpc {
                rpc,
                process,
                shutdown_timeout,
            } => {
                rpc.begin_close()?;
                if let Some(process) = process {
                    process.shutdown(*shutdown_timeout).await?;
                }
                rpc.join_reader(*shutdown_timeout)?;
                Ok(())
            }
            Self::Msgpack { worker } => worker.close().await,
        }
    }
}

fn serialize_api_params<P>(params: &P) -> Result<Value>
where
    P: Serialize + ?Sized,
{
    let mut value = serde_json::to_value(params)?;
    encode_numeric_api_handles(&mut value);
    Ok(value)
}

fn encode_numeric_api_handles(value: &mut Value) {
    match value {
        Value::Object(fields) => {
            for (key, value) in fields {
                if is_numeric_api_handle_field(key) {
                    encode_numeric_api_handle_value(value);
                } else {
                    encode_numeric_api_handles(value);
                }
            }
        }
        Value::Array(values) => {
            for value in values {
                encode_numeric_api_handles(value);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {}
    }
}

fn encode_numeric_api_handle_value(value: &mut Value) {
    match value {
        Value::String(raw) => {
            if let Some(number) = parse_numeric_api_handle(raw) {
                *value = Value::Number(number.into());
            }
        }
        Value::Array(values) => {
            for value in values {
                encode_numeric_api_handle_value(value);
            }
        }
        Value::Object(_) => encode_numeric_api_handles(value),
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

fn is_numeric_api_handle_field(key: &str) -> bool {
    matches!(
        key,
        "snapshot" | "symbol" | "symbols" | "type" | "types" | "signature" | "signatures"
    )
}

fn parse_numeric_api_handle(raw: &str) -> Option<u64> {
    if raw.is_empty() || (raw.len() > 1 && raw.starts_with('0')) {
        return None;
    }
    raw.bytes()
        .all(|byte| byte.is_ascii_digit())
        .then(|| raw.parse().ok())?
}

fn record_profile(
    profiler: &SharedProfiler,
    method: &str,
    transport: &str,
    phase: ApiProfilePhase,
    duration: Duration,
) {
    profile(
        Some(profiler),
        ApiProfileEvent {
            method: method.into(),
            transport: transport.into(),
            phase,
            duration,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::serialize_api_params;
    use crate::api::{
        NodeHandle, ProjectHandle, SignatureHandle, SnapshotHandle, SymbolHandle, TypeHandle,
    };
    use serde::Serialize;
    use serde_json::json;

    #[derive(Serialize)]
    struct Params {
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        symbol: SymbolHandle,
        symbols: Vec<SymbolHandle>,
        #[serde(rename = "type")]
        type_handle: TypeHandle,
        signature: SignatureHandle,
        location: NodeHandle,
    }

    #[test]
    fn serializes_numeric_api_handles_as_numbers_for_wire_requests() {
        let params = serialize_api_params(&Params {
            snapshot: SnapshotHandle::from("1"),
            project: ProjectHandle::from("project-1"),
            symbol: SymbolHandle::from("2"),
            symbols: vec![SymbolHandle::from("3")],
            type_handle: TypeHandle::from("4"),
            signature: SignatureHandle::from("5"),
            location: NodeHandle::from("1.2.3./workspace/main.ts"),
        })
        .unwrap();

        assert_eq!(params["snapshot"], json!(1));
        assert_eq!(params["project"], json!("project-1"));
        assert_eq!(params["symbol"], json!(2));
        assert_eq!(params["symbols"], json!([3]));
        assert_eq!(params["type"], json!(4));
        assert_eq!(params["signature"], json!(5));
        assert_eq!(params["location"], json!("1.2.3./workspace/main.ts"));
    }

    #[test]
    fn leaves_non_numeric_api_handles_as_strings_for_wire_requests() {
        let params = serialize_api_params(&Params {
            snapshot: SnapshotHandle::from("snapshot-1"),
            project: ProjectHandle::from("project-1"),
            symbol: SymbolHandle::from("s0000000000000001"),
            symbols: vec![SymbolHandle::from("s0000000000000002")],
            type_handle: TypeHandle::from("t0000000000000001"),
            signature: SignatureHandle::from("sig-1"),
            location: NodeHandle::from("1.2.3./workspace/main.ts"),
        })
        .unwrap();

        assert_eq!(params["snapshot"], json!("snapshot-1"));
        assert_eq!(params["symbol"], json!("s0000000000000001"));
        assert_eq!(params["symbols"], json!(["s0000000000000002"]));
        assert_eq!(params["type"], json!("t0000000000000001"));
        assert_eq!(params["signature"], json!("sig-1"));
    }
}
