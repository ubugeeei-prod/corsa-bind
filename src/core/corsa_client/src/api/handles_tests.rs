use super::NodeHandle;
use crate::CorsaError;

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
