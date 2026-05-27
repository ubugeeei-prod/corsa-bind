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

pub fn parse_json<T>(value: &str) -> Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_str(value).map_err(into_napi_error)
}

pub fn parse_optional_json(value: Option<String>) -> Result<Value> {
    match value {
        Some(value) => parse_json(value.as_str()),
        None => Ok(Value::Null),
    }
}

pub fn to_json<T>(value: &T) -> Result<String>
where
    T: Serialize,
{
    serde_json::to_string(value).map_err(into_napi_error)
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
    use super::{SpawnOptions, build_spawn_config, parse_json, parse_optional_json};
    use corsa::api::ApiMode;
    use serde_json::json;

    #[test]
    fn parse_optional_json_defaults_to_null() {
        assert_eq!(parse_optional_json(None).unwrap(), json!(null));
    }

    #[test]
    fn spawn_config_defaults_to_msgpack() {
        let options = parse_json::<SpawnOptions>(r#"{"executable":"./corsa"}"#).unwrap();
        let config = build_spawn_config(options).unwrap();
        assert_eq!(config.mode, ApiMode::SyncMsgpackStdio);
    }

    #[test]
    fn spawn_config_accepts_jsonrpc_mode() {
        let options =
            parse_json::<SpawnOptions>(r#"{"executable":"./corsa","mode":"jsonrpc"}"#).unwrap();
        let config = build_spawn_config(options).unwrap();
        assert_eq!(config.mode, ApiMode::AsyncJsonRpcStdio);
    }

    #[test]
    fn spawn_config_accepts_transport_limits() {
        let options = parse_json::<SpawnOptions>(
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
