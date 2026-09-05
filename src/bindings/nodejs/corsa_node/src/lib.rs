//! `napi-rs` bindings for the `corsa` workspace.
//!
//! The module intentionally stays thin: JSON is used at the N-API boundary so
//! the Rust side can keep its typed transport and orchestration layers intact.

mod api_client;
mod content_mapper;
mod document;
mod native_lint;
mod rule_predicates;
mod util;
mod utils;

pub use api_client::spawn_corsa_api_client_async;
pub use content_mapper::{
    content_mappers_from_config, decode_source_file, is_content_mapped_source_file,
    span_map_for_source_file,
};

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
