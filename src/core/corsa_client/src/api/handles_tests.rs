use super::{NodeHandle, ProjectHandle, SignatureHandle, SnapshotHandle, SymbolHandle, TypeHandle};
use crate::CorsaError;
use serde_json::json;

#[test]
fn numeric_wire_handles_accept_integer_json() {
    assert_eq!(
        serde_json::from_value::<SnapshotHandle>(json!(1))
            .unwrap()
            .as_str(),
        "1"
    );
    assert_eq!(
        serde_json::from_value::<SymbolHandle>(json!(2))
            .unwrap()
            .as_str(),
        "2"
    );
    assert_eq!(
        serde_json::from_value::<TypeHandle>(json!(3))
            .unwrap()
            .as_str(),
        "3"
    );
    assert_eq!(
        serde_json::from_value::<SignatureHandle>(json!(4))
            .unwrap()
            .as_str(),
        "4"
    );
}

#[test]
fn numeric_wire_handles_still_serialize_as_strings() {
    assert_eq!(
        serde_json::to_value(SnapshotHandle::from("1")).unwrap(),
        json!("1")
    );
}

#[test]
fn string_only_handles_reject_integer_json() {
    assert!(serde_json::from_value::<ProjectHandle>(json!(1)).is_err());
    assert!(serde_json::from_value::<NodeHandle>(json!(1)).is_err());
}

#[test]
fn parse_preserves_dots_in_path_segment() {
    let parsed = NodeHandle::from("1.5.123./workspace/src/lib.dom.ts")
        .parse()
        .unwrap();
    assert_eq!(parsed.path, "/workspace/src/lib.dom.ts");
}

#[test]
fn parse_rejects_missing_segments() {
    let err = NodeHandle::from("1.5.123").parse().unwrap_err();
    assert!(matches!(err, CorsaError::InvalidHandle(handle) if handle == "1.5.123"));
}

#[test]
fn parse_rejects_non_numeric_offsets() {
    let err = NodeHandle::from("x.5.123./workspace/main.ts")
        .parse()
        .unwrap_err();
    assert!(
        matches!(err, CorsaError::InvalidHandle(handle) if handle == "x.5.123./workspace/main.ts")
    );
}

#[test]
fn parse_rejects_non_numeric_kind() {
    let err = NodeHandle::from("1.5.kind./workspace/main.ts")
        .parse()
        .unwrap_err();
    assert!(
        matches!(err, CorsaError::InvalidHandle(handle) if handle == "1.5.kind./workspace/main.ts")
    );
}

#[test]
fn parse_rejects_empty_path_segment() {
    let err = NodeHandle::from("1.5.123.").parse().unwrap_err();
    assert!(matches!(err, CorsaError::InvalidHandle(handle) if handle == "1.5.123."));
}

#[test]
fn parse_rejects_inverted_offsets() {
    let err = NodeHandle::from("5.1.123./workspace/main.ts")
        .parse()
        .unwrap_err();
    assert!(
        matches!(err, CorsaError::InvalidHandle(handle) if handle == "5.1.123./workspace/main.ts")
    );
}
