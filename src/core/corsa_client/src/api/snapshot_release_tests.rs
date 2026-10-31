#![cfg(unix)]

use std::{
    future::Future,
    io::BufReader,
    net::Shutdown,
    os::unix::net::UnixStream,
    pin::pin,
    sync::Arc,
    task::{Context, Wake, Waker},
    thread,
    time::Duration,
};

use serde_json::{Value, json};

use super::SnapshotReleaseQueue;
use crate::{
    CorsaError,
    api::{SnapshotHandle, driver::ClientDriver},
    jsonrpc::{JsonRpcConnection, JsonRpcConnectionOptions, read_frame, write_frame},
};

const DEADLINE: Duration = Duration::from_secs(5);

struct Peer {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
}

impl Peer {
    fn request(&mut self, method: &str) -> Value {
        let request: Value =
            serde_json::from_slice(&read_frame(&mut self.reader).unwrap()).unwrap();
        assert_eq!(request["method"], method);
        request
    }

    fn respond(&mut self, request: &Value, response: Value) {
        let mut response = response;
        response["jsonrpc"] = json!("2.0");
        response["id"] = request["id"].clone();
        write_frame(&mut self.writer, &serde_json::to_vec(&response).unwrap()).unwrap();
    }

    fn acknowledge(&mut self, request: &Value) {
        self.respond(request, json!({"result": null}));
    }
}

fn queue(capacity: usize) -> (Arc<SnapshotReleaseQueue>, Arc<ClientDriver>, Peer) {
    let (client_socket, server_socket) = UnixStream::pair().unwrap();
    server_socket.set_read_timeout(Some(DEADLINE)).unwrap();
    let rpc = JsonRpcConnection::try_spawn_with_options(
        BufReader::new(client_socket.try_clone().unwrap()),
        client_socket,
        Default::default(),
        JsonRpcConnectionOptions::new().with_request_timeout(Some(DEADLINE)),
    )
    .unwrap();
    let driver = Arc::new(ClientDriver::JsonRpc {
        rpc,
        process: None,
        shutdown_timeout: DEADLINE,
    });
    let queue = Arc::new(SnapshotReleaseQueue::spawn(driver.clone(), None, capacity).unwrap());
    let peer = Peer {
        reader: BufReader::new(server_socket.try_clone().unwrap()),
        writer: server_socket,
    };
    (queue, driver, peer)
}

struct NoopWake;

impl Wake for NoopWake {
    fn wake(self: Arc<Self>) {}
}

fn assert_pending(future: std::pin::Pin<&mut impl Future>) {
    let waker = Waker::from(Arc::new(NoopWake));
    assert!(future.poll(&mut Context::from_waker(&waker)).is_pending());
}

fn finish(queue: &SnapshotReleaseQueue, driver: &ClientDriver, peer: &Peer) {
    corsa_runtime::block_on(queue.close(DEADLINE)).unwrap();
    peer.writer.shutdown(Shutdown::Both).unwrap();
    corsa_runtime::block_on(driver.close()).unwrap();
}

#[test]
fn drain_waits_for_release_ack_and_keeps_the_driver_and_queue_open() {
    let (queue, driver, mut peer) = queue(1);
    queue.enqueue(SnapshotHandle::from("11"));
    let release = peer.request("release");
    assert_eq!(release["params"], json!({"handle": "11", "snapshot": 11}));

    let mut drain = pin!(queue.drain(DEADLINE));
    assert_pending(drain.as_mut());
    peer.acknowledge(&release);
    corsa_runtime::block_on(drain).unwrap();

    let requester = {
        let driver = Arc::clone(&driver);
        corsa_runtime::spawn(async move { driver.request_json("ping", json!({})).await })
    };
    let ping = peer.request("ping");
    peer.respond(&ping, json!({"result": "still open"}));
    assert_eq!(requester.join().unwrap().unwrap(), json!("still open"));

    queue.enqueue(SnapshotHandle::from("12"));
    let release = peer.request("release");
    peer.acknowledge(&release);
    corsa_runtime::block_on(queue.drain(DEADLINE)).unwrap();
    finish(&queue, &driver, &peer);
}

#[test]
fn drain_timeout_is_an_error_and_does_not_close_the_connection() {
    let (queue, driver, mut peer) = queue(1);
    queue.enqueue(SnapshotHandle::from("11"));
    let release = peer.request("release");

    let error = corsa_runtime::block_on(queue.drain(Duration::ZERO)).unwrap_err();
    assert!(
        matches!(error, CorsaError::Timeout(message) if message.contains("snapshot release drain"))
    );

    peer.acknowledge(&release);
    corsa_runtime::block_on(queue.drain(DEADLINE)).unwrap();
    finish(&queue, &driver, &peer);
}

#[test]
fn failed_release_remains_an_error_for_later_drains_with_best_effort_close() {
    let (queue, driver, mut peer) = queue(1);
    queue.enqueue(SnapshotHandle::from("11"));
    let release = peer.request("release");
    peer.respond(
        &release,
        json!({"error": {"code": -32001, "message": "release rejected"}}),
    );

    for _ in 0..2 {
        let error = corsa_runtime::block_on(queue.drain(DEADLINE)).unwrap_err();
        assert!(matches!(error, CorsaError::Rpc(error) if error.code == -32001));
    }
    finish(&queue, &driver, &peer);
}

#[test]
fn drain_includes_a_release_running_on_the_queue_overflow_thread() {
    let (queue, driver, mut peer) = queue(1);
    queue.enqueue(SnapshotHandle::from("11"));
    let first = peer.request("release");
    queue.enqueue(SnapshotHandle::from("12"));
    let overflow = {
        let queue = Arc::clone(&queue);
        thread::spawn(move || queue.enqueue(SnapshotHandle::from("13")))
    };
    let third = peer.request("release");
    assert_eq!(third["params"]["snapshot"], 13);

    let mut drain = pin!(queue.drain(DEADLINE));
    assert_pending(drain.as_mut());
    peer.acknowledge(&first);
    let second = peer.request("release");
    assert_eq!(second["params"]["snapshot"], 12);
    peer.acknowledge(&second);
    assert_pending(drain.as_mut());
    peer.acknowledge(&third);
    overflow.join().unwrap();
    corsa_runtime::block_on(drain).unwrap();
    finish(&queue, &driver, &peer);
}

#[test]
fn peer_exit_propagates_the_release_transport_error() {
    let (queue, driver, mut peer) = queue(1);
    queue.enqueue(SnapshotHandle::from("11"));
    peer.request("release");
    peer.writer.shutdown(Shutdown::Both).unwrap();

    assert!(matches!(
        corsa_runtime::block_on(queue.drain(DEADLINE)),
        Err(CorsaError::Closed(_))
    ));
    corsa_runtime::block_on(queue.close(DEADLINE)).unwrap();
    corsa_runtime::block_on(driver.close()).unwrap();
}
