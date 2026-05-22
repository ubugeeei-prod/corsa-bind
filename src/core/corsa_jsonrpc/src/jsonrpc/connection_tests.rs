#![cfg(unix)]

use super::{InboundEvent, JsonRpcConnection, JsonRpcConnectionOptions, RpcHandlerMap};
use corsa_core::{TsgoEvent, TsgoObserver};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::{io::BufReader, os::unix::net::UnixStream, thread};

#[derive(Default)]
struct EventCollector {
    events: Mutex<Vec<TsgoEvent>>,
}

impl TsgoObserver for EventCollector {
    fn on_event(&self, event: &TsgoEvent) {
        self.events.lock().unwrap().push(event.clone());
    }
}

#[test]
fn routes_request_and_response() {
    let (client_socket, server_socket) = UnixStream::pair().unwrap();
    let client = JsonRpcConnection::try_spawn(
        BufReader::new(client_socket.try_clone().unwrap()),
        client_socket,
        RpcHandlerMap::default(),
    )
    .unwrap();
    let server = JsonRpcConnection::try_spawn(
        BufReader::new(server_socket.try_clone().unwrap()),
        server_socket,
        RpcHandlerMap::default(),
    )
    .unwrap();
    let events = server.subscribe();
    let waiter = thread::spawn(move || match events.recv().unwrap() {
        InboundEvent::Request { id, method, params } => {
            assert_eq!(method.as_str(), "ping");
            assert_eq!(params, json!({"value": 1}));
            server.respond(id, json!({"pong": true})).unwrap();
        }
        _ => panic!("unexpected event"),
    });
    let response: serde_json::Value =
        corsa_runtime::block_on(client.request("ping", json!({"value": 1}))).unwrap();
    waiter.join().unwrap();
    assert_eq!(response, json!({"pong": true}));
}

#[test]
fn request_times_out_when_no_response_arrives() {
    let (client_socket, _server_socket) = UnixStream::pair().unwrap();
    let observer = Arc::new(EventCollector::default());
    let client = JsonRpcConnection::try_spawn_with_options(
        BufReader::new(client_socket.try_clone().unwrap()),
        client_socket,
        RpcHandlerMap::default(),
        JsonRpcConnectionOptions::new()
            .with_request_timeout(Some(Duration::from_millis(10)))
            .with_observer(observer.clone()),
    )
    .unwrap();
    let error =
        corsa_runtime::block_on(client.request_value("ping", json!({"value": 1}))).unwrap_err();
    assert!(matches!(
        error,
        crate::TsgoError::Timeout(message) if message.contains("jsonrpc request `ping`")
    ));
    assert_eq!(
        observer.events.lock().unwrap().as_slice(),
        &[TsgoEvent::JsonRpcRequestTimedOut {
            method: "ping".into(),
            timeout: Duration::from_millis(10),
        }]
    );
}

#[test]
fn close_joins_reader_after_peer_closes() {
    let (client_socket, server_socket) = UnixStream::pair().unwrap();
    let client = JsonRpcConnection::try_spawn(
        BufReader::new(client_socket.try_clone().unwrap()),
        client_socket,
        RpcHandlerMap::default(),
    )
    .unwrap();
    drop(server_socket);

    corsa_runtime::block_on(client.close()).unwrap();
}

#[test]
fn close_uses_bounded_reader_join_when_peer_stays_open() {
    let (client_socket, _server_socket) = UnixStream::pair().unwrap();
    let client = JsonRpcConnection::try_spawn(
        BufReader::new(client_socket.try_clone().unwrap()),
        client_socket,
        RpcHandlerMap::default(),
    )
    .unwrap();
    let started = std::time::Instant::now();

    corsa_runtime::block_on(client.close()).unwrap();

    assert!(started.elapsed() < Duration::from_secs(2));
}
