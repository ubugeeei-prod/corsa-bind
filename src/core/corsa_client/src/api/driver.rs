use std::time::Duration;

use crate::{Result, error::TsgoError, jsonrpc::JsonRpcConnection, process::AsyncChildGuard};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use corsa_core::fast::compact_format;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{sync::Arc, time::Instant};

use super::{
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
                    let params = serde_json::to_value(params)?;
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
                    rpc.request(method, params).await
                }
            }
            Self::Msgpack { worker } => {
                let payload = if let Some(profiler) = profiler {
                    let started = Instant::now();
                    let payload = serde_json::to_vec(params)?;
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    payload
                } else {
                    serde_json::to_vec(params)?
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
                    let params = serde_json::to_value(params)?;
                    record_profile(
                        profiler,
                        method,
                        "jsonrpc",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    params
                } else {
                    serde_json::to_value(params)?
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
                    TsgoError::Protocol(compact_format(format_args!(
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
                    let payload = serde_json::to_vec(params)?;
                    record_profile(
                        profiler,
                        method,
                        "msgpack",
                        ApiProfilePhase::SerializeParams,
                        started.elapsed(),
                    );
                    payload
                } else {
                    serde_json::to_vec(params)?
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
                    TsgoError::Protocol(compact_format(format_args!(
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
        handle: &str,
        profiler: Option<&SharedProfiler>,
    ) -> Result<()> {
        let request = ReleaseRequest { handle };
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
