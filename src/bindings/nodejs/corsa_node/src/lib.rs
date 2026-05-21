//! `napi-rs` bindings for the `corsa` workspace.
//!
//! The module intentionally stays thin: JSON is used at the N-API boundary so
//! the Rust side can keep its typed transport and orchestration layers intact.

mod api_client;
mod document;
mod native_lint;
mod orchestrator;
mod rule_predicates;
mod util;
mod utils;

pub use api_client::spawn_tsgo_api_client_async;

use napi_derive::napi;

/// Returns the package version exposed by the native addon.
///
/// # Examples
///
/// ```
/// assert_eq!(corsa_node::version(), env!("CARGO_PKG_VERSION"));
/// ```
#[napi]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
