use corsa::api::{ApiMode, ApiSpawnConfig};
use napi::{Error, Result};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::fmt::Display;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnOptions {
    pub executable: String,
    pub cwd: Option<String>,
    pub mode: Option<String>,
    pub request_timeout_ms: Option<u64>,
    pub shutdown_timeout_ms: Option<u64>,
    pub outbound_capacity: Option<usize>,
    pub allow_unstable_upstream_calls: Option<bool>,
}

pub fn build_spawn_config(options: SpawnOptions) -> Result<ApiSpawnConfig> {
    let mut config = ApiSpawnConfig::new(options.executable);
    if let Some(cwd) = options.cwd {
        config = config.with_cwd(cwd);
    }
    if let Some(mode) = options.mode {
        config = config.with_mode(parse_mode(mode.as_str())?);
    }
    if let Some(timeout_ms) = options.request_timeout_ms {
        config = config.with_request_timeout(Some(std::time::Duration::from_millis(timeout_ms)));
    }
    if let Some(timeout_ms) = options.shutdown_timeout_ms {
        config = config.with_shutdown_timeout(std::time::Duration::from_millis(timeout_ms));
    }
    if let Some(capacity) = options.outbound_capacity {
        config = config.with_outbound_capacity(capacity);
    }
    if let Some(allow) = options.allow_unstable_upstream_calls {
        config = config.with_allow_unstable_upstream_calls(allow);
    }
    Ok(config)
}

pub fn from_value<T>(value: Value) -> Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value).map_err(into_napi_error)
}

pub fn from_optional_value<T>(value: Option<Value>) -> Result<T>
where
    T: DeserializeOwned + Default,
{
    match value {
        Some(Value::Null) | None => Ok(T::default()),
        Some(value) => from_value(value),
    }
}

pub fn optional_value(value: Option<Value>) -> Value {
    value.unwrap_or(Value::Null)
}

pub fn to_value<T>(value: &T) -> Result<Value>
where
    T: Serialize,
{
    serde_json::to_value(value).map_err(into_napi_error)
}

pub fn into_napi_error(error: impl Display) -> Error {
    Error::from_reason(error.to_string())
}

fn parse_mode(mode: &str) -> Result<ApiMode> {
    match mode {
        "jsonrpc" => Ok(ApiMode::AsyncJsonRpcStdio),
        "msgpack" => Ok(ApiMode::SyncMsgpackStdio),
        _ => Err(Error::from_reason("unknown corsa api mode".to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::{SpawnOptions, build_spawn_config};
    use corsa::api::ApiMode;

    #[test]
    fn spawn_config_defaults_to_msgpack() {
        let options = serde_json::from_str::<SpawnOptions>(r#"{"executable":"./corsa"}"#).unwrap();
        let config = build_spawn_config(options).unwrap();
        assert_eq!(config.mode, ApiMode::SyncMsgpackStdio);
    }

    #[test]
    fn spawn_config_accepts_jsonrpc_mode() {
        let options =
            serde_json::from_str::<SpawnOptions>(r#"{"executable":"./corsa","mode":"jsonrpc"}"#)
                .unwrap();
        let config = build_spawn_config(options).unwrap();
        assert_eq!(config.mode, ApiMode::AsyncJsonRpcStdio);
    }

    #[test]
    fn spawn_config_accepts_transport_limits() {
        let options = serde_json::from_str::<SpawnOptions>(
            r#"{"executable":"./corsa","requestTimeoutMs":5000,"shutdownTimeoutMs":250,"outboundCapacity":8,"allowUnstableUpstreamCalls":true}"#,
        )
        .unwrap();
        let config = build_spawn_config(options).unwrap();
        assert_eq!(
            config.request_timeout,
            Some(std::time::Duration::from_secs(5))
        );
        assert_eq!(
            config.shutdown_timeout,
            std::time::Duration::from_millis(250)
        );
        assert_eq!(config.outbound_capacity, 8);
        assert!(config.allow_unstable_upstream_calls);
    }
}
