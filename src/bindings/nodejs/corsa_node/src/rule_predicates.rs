use napi::Result;
use napi_derive::napi;
use serde::Deserialize;
use serde_json::Value;

use crate::util::from_value;

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnsafeTypeFlowInput {
    source_type_texts: Vec<String>,
    #[serde(default)]
    target_type_texts: Vec<String>,
}

#[allow(dead_code)]
#[napi]
pub fn is_unsafe_assignment(input: Value) -> Result<bool> {
    let input = from_value::<UnsafeTypeFlowInput>(input)?;
    Ok(corsa::utils::is_unsafe_assignment(
        input.source_type_texts.as_slice(),
        input.target_type_texts.as_slice(),
    ))
}

#[allow(dead_code)]
#[napi]
pub fn is_unsafe_return(input: Value) -> Result<bool> {
    let input = from_value::<UnsafeTypeFlowInput>(input)?;
    Ok(corsa::utils::is_unsafe_return(
        input.source_type_texts.as_slice(),
        input.target_type_texts.as_slice(),
    ))
}

#[cfg(test)]
mod tests {
    use super::{is_unsafe_assignment, is_unsafe_return};
    use serde_json::json;

    #[test]
    fn flags_direct_any_assignment() {
        assert!(
            is_unsafe_assignment(json!({"sourceTypeTexts":["any"],"targetTypeTexts":["string"]}))
                .unwrap()
        );
    }

    #[test]
    fn allows_unknown_targets() {
        assert!(
            !is_unsafe_assignment(json!({"sourceTypeTexts":["any"],"targetTypeTexts":["unknown"]}))
                .unwrap()
        );
    }

    #[test]
    fn flags_generic_any_assignment() {
        assert!(
            is_unsafe_assignment(
                json!({"sourceTypeTexts":["Set<any>"],"targetTypeTexts":["Set<string>"]})
            )
            .unwrap()
        );
    }

    #[test]
    fn flags_promise_any_returns() {
        assert!(
            is_unsafe_return(
                json!({"sourceTypeTexts":["Promise<any>"],"targetTypeTexts":["Promise<string>"]})
            )
            .unwrap()
        );
    }

    #[test]
    fn flags_unions_that_include_any() {
        assert!(
            is_unsafe_assignment(
                json!({"sourceTypeTexts":["string | any"],"targetTypeTexts":["string"]})
            )
            .unwrap()
        );
    }

    #[test]
    fn inferred_targets_still_flag_any_flows() {
        assert!(is_unsafe_assignment(json!({"sourceTypeTexts":["any[]"]})).unwrap());
    }

    #[test]
    fn keeps_specific_flows_allowed() {
        assert!(
            !is_unsafe_return(
                json!({"sourceTypeTexts":["Promise<string>"],"targetTypeTexts":["Promise<string>"]})
            )
            .unwrap()
        );
    }
}
