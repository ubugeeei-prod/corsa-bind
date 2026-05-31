//! Lightweight runtime primitives used by the stdio transports.
//!
//! The runtime intentionally stays small: a single-thread `block_on`, a
//! thread-backed `spawn`, and a broadcast channel for fan-out notifications.
//!
//! # Examples
//!
//! ```
//! use corsa_runtime::{block_on, broadcast, spawn};
//! use std::time::Duration;
//!
//! let value = block_on(async { 40 + 2 });
//! assert_eq!(value, 42);
//!
//! let handle = spawn(async { 1_u32 + 2 });
//! assert_eq!(handle.join().unwrap(), 3);
//!
//! let (sender, receiver) = broadcast();
//! assert_eq!(sender.send("ready"), 1);
//! assert_eq!(receiver.recv_timeout(Duration::from_millis(50)).unwrap(), "ready");
//! ```

mod broadcast;
mod executor;
mod task;

pub use broadcast::{
    Receiver as BroadcastReceiver, Sender as BroadcastSender, channel as broadcast,
};
pub use executor::block_on;
pub use task::{JoinHandle, spawn, try_spawn};
