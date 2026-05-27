use super::{MAX_BODY_BYTES, MAX_HEADER_BYTES, read_frame, write_frame};
use crate::CorsaError;
use std::io::BufReader;
#[cfg(unix)]
use std::{os::unix::net::UnixStream, thread};

#[cfg(unix)]
#[test]
fn roundtrip_frame() {
    let (writer, reader) = UnixStream::pair().unwrap();
    let write = thread::spawn(move || {
        let mut writer = writer;
        write_frame(&mut writer, br#"{"jsonrpc":"2.0"}"#).unwrap();
    });
    let mut reader = BufReader::new(reader);
    let payload = read_frame(&mut reader).unwrap();
    write.join().unwrap();
    assert_eq!(payload, br#"{"jsonrpc":"2.0"}"#);
}

#[test]
fn reads_headers_with_small_reader_buffers() {
    let payload = br#"{"jsonrpc":"2.0","method":"ping"}"#;
    let frame = frame_with_length(payload, b"X-Test: 1\r\n");
    let mut reader = BufReader::with_capacity(7, frame.as_slice());
    assert_eq!(read_frame(&mut reader).unwrap(), payload);
}

#[test]
fn accepts_case_insensitive_headers_and_ascii_whitespace() {
    let payload = br#"{}"#;
    let frame = build_frame(b"content-length : 2 \r\n\r\n", payload);
    let mut reader = BufReader::new(frame.as_slice());
    assert_eq!(read_frame(&mut reader).unwrap(), payload);
}

#[test]
fn rejects_missing_content_length() {
    assert_protocol(
        build_frame(b"X-Test: 1\r\n\r\n", br#"{}"#),
        "missing Content-Length",
    );
}

#[test]
fn rejects_empty_content_length() {
    assert_protocol(build_frame(b"Content-Length: \r\n\r\n", br#"{}"#), "empty");
}

#[test]
fn rejects_invalid_content_length() {
    assert_protocol(
        build_frame(b"Content-Length: nope\r\n\r\n", br#"{}"#),
        "invalid",
    );
}

#[test]
fn rejects_overflowing_content_length() {
    assert_protocol(
        build_frame(b"Content-Length: 184467440737095516161\r\n\r\n", br#"{}"#),
        "overflow",
    );
}

#[test]
fn rejects_oversized_body_before_allocation() {
    let header = format!("Content-Length: {}\r\n\r\n", MAX_BODY_BYTES + 1);
    assert_protocol(build_frame(header.as_bytes(), b""), "body is too large");
}

#[test]
fn rejects_oversized_headers() {
    let header = vec![b'a'; MAX_HEADER_BYTES + 1];
    let mut reader = BufReader::new(header.as_slice());
    let err = read_frame(&mut reader).unwrap_err();
    assert!(
        matches!(err, CorsaError::Protocol(message) if message.contains("header is too large"))
    );
}

#[test]
fn writes_empty_payload_frames() {
    let mut buffer = Vec::new();
    write_frame(&mut buffer, b"").unwrap();
    assert_eq!(buffer, b"Content-Length: 0\r\n\r\n");
}

fn build_frame(header: &[u8], payload: &[u8]) -> Vec<u8> {
    [header, payload].concat()
}

fn frame_with_length(payload: &[u8], extra: &[u8]) -> Vec<u8> {
    let header = format!("Content-Length: {}\r\n", payload.len());
    [header.as_bytes(), extra, b"\r\n", payload].concat()
}

fn assert_protocol(frame: Vec<u8>, needle: &str) {
    let mut reader = BufReader::new(frame.as_slice());
    let err = read_frame(&mut reader).unwrap_err();
    assert!(matches!(err, CorsaError::Protocol(message) if message.contains(needle)));
}
