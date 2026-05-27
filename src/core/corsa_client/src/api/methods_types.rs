//! Type-oriented `ApiClient` methods.
//!
//! These helpers mostly expose TypeScript checker queries. They are useful for
//! "what type is this?" style workflows, intrinsic type access, and for turning
//! Corsa's opaque type handles back into richer structural information.

use base64::{Engine as _, engine::general_purpose::STANDARD};

use super::{
    ApiClient, DocumentIdentifier, EncodedPayload, NodeHandle, ProjectHandle, SnapshotHandle,
    TypeHandle, TypeResponse,
    encoded::PrintNodeOptions,
    requests_core::{IntrinsicTypeRequest, TypeNodeRequest},
    requests_symbols::{PositionBatchRequest, TypeProjectRequest},
    requests_types::{PrintNodeRequest, SignatureOfTypeRequest, TypeLocationRequest},
};
use crate::Result;

impl ApiClient {
    /// Returns the checker type associated with a syntax node.
    ///
    /// Returns `Ok(None)` when the location has no associated type.
    pub async fn get_type_at_location(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        location: NodeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getTypeAtLocation",
            TypeLocationRequest {
                snapshot,
                project,
                location,
            },
        )
        .await
    }

    /// Resolves types for multiple syntax nodes.
    ///
    /// The output order matches the input `locations` order.
    pub async fn get_type_at_locations(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        locations: Vec<NodeHandle>,
    ) -> Result<Vec<Option<TypeResponse>>> {
        self.call(
            "getTypeAtLocations",
            super::requests_symbols::NodeBatchRequest {
                snapshot,
                project,
                locations,
            },
        )
        .await
    }

    /// Returns the checker type visible at a UTF-16 position in a file.
    ///
    /// Returns `Ok(None)` when the position does not correspond to a typed
    /// entity.
    pub async fn get_type_at_position(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        file: impl Into<DocumentIdentifier>,
        position: u32,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getTypeAtPosition",
            super::requests_core::SymbolAtPositionRequest {
                snapshot,
                project,
                file: file.into(),
                position,
            },
        )
        .await
    }

    /// Resolves types for multiple positions in a single file.
    ///
    /// The output order matches the input `positions` order.
    pub async fn get_types_at_positions(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        file: impl Into<DocumentIdentifier>,
        positions: Vec<u32>,
    ) -> Result<Vec<Option<TypeResponse>>> {
        self.call(
            "getTypesAtPositions",
            PositionBatchRequest {
                snapshot,
                project,
                file: file.into(),
                positions,
            },
        )
        .await
    }

    /// Returns signatures of a type for the given signature `kind`.
    ///
    /// `kind` is forwarded directly to the upstream checker endpoint.
    pub async fn get_signatures_of_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
        kind: i32,
    ) -> Result<Vec<super::SignatureResponse>> {
        self.call(
            "getSignaturesOfType",
            SignatureOfTypeRequest {
                snapshot,
                project,
                r#type,
                kind,
            },
        )
        .await
    }

    /// Returns the contextual type associated with a syntax node.
    ///
    /// This is especially useful for function expressions and object literals
    /// whose types are influenced by surrounding context.
    pub async fn get_contextual_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        location: NodeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getContextualType",
            TypeLocationRequest {
                snapshot,
                project,
                location,
            },
        )
        .await
    }

    /// Returns the widened base type of a literal type.
    pub async fn get_base_type_of_literal_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getBaseTypeOfLiteralType",
            TypeProjectRequest {
                snapshot,
                project,
                r#type,
            },
        )
        .await
    }

    /// Returns the intrinsic `any` type for the project.
    pub async fn get_any_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getAnyType", snapshot, project).await
    }

    /// Returns the intrinsic `string` type for the project.
    pub async fn get_string_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getStringType", snapshot, project)
            .await
    }

    /// Returns the intrinsic `number` type for the project.
    pub async fn get_number_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getNumberType", snapshot, project)
            .await
    }

    /// Returns the intrinsic `boolean` type for the project.
    pub async fn get_boolean_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getBooleanType", snapshot, project)
            .await
    }

    /// Returns the intrinsic `void` type for the project.
    pub async fn get_void_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getVoidType", snapshot, project).await
    }

    /// Returns the intrinsic `undefined` type for the project.
    pub async fn get_undefined_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getUndefinedType", snapshot, project)
            .await
    }

    /// Returns the intrinsic `null` type for the project.
    pub async fn get_null_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getNullType", snapshot, project).await
    }

    /// Returns the intrinsic `never` type for the project.
    pub async fn get_never_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getNeverType", snapshot, project).await
    }

    /// Returns the intrinsic `unknown` type for the project.
    pub async fn get_unknown_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getUnknownType", snapshot, project)
            .await
    }

    /// Returns the intrinsic `bigint` type for the project.
    pub async fn get_big_int_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getBigIntType", snapshot, project)
            .await
    }

    /// Returns the intrinsic ECMAScript `symbol` type for the project.
    pub async fn get_es_symbol_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call_intrinsic("getESSymbolType", snapshot, project)
            .await
    }

    /// Converts a type into a serialized type-node payload.
    ///
    /// The returned payload can be fed into [`Self::print_node`] for text
    /// rendering, or into other node-oriented helpers that understand the
    /// binary node encoding.
    pub async fn type_to_type_node(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
        location: Option<NodeHandle>,
        flags: Option<i32>,
    ) -> Result<Option<EncodedPayload>> {
        self.call_optional_binary(
            "typeToTypeNode",
            TypeNodeRequest {
                snapshot,
                project,
                r#type,
                location,
                flags,
            },
        )
        .await
    }

    /// Renders a type to text using Corsa's checker printer.
    pub async fn type_to_string(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
        location: Option<NodeHandle>,
        flags: Option<i32>,
    ) -> Result<String> {
        self.call(
            "typeToString",
            TypeNodeRequest {
                snapshot,
                project,
                r#type,
                location,
                flags,
            },
        )
        .await
    }

    /// Returns whether a node is treated as context sensitive by the checker.
    pub async fn is_context_sensitive(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        location: NodeHandle,
    ) -> Result<bool> {
        self.call(
            "isContextSensitive",
            TypeLocationRequest {
                snapshot,
                project,
                location,
            },
        )
        .await
    }

    /// Renders a serialized node payload into source text.
    ///
    /// `payload` is expected to come from binary endpoints such as
    /// [`Self::type_to_type_node`] or [`Self::get_source_file`].
    pub async fn print_node(
        &self,
        payload: &EncodedPayload,
        options: PrintNodeOptions,
    ) -> Result<String> {
        if !self.allows_unstable_upstream_calls() {
            return Err(crate::CorsaError::Unsupported(
                "printNode is disabled by default because upstream can panic on real project data; opt in with ApiSpawnConfig::with_allow_unstable_upstream_calls(true)",
            ));
        }
        self.call(
            "printNode",
            PrintNodeRequest {
                data: STANDARD.encode(payload.as_bytes()),
                preserve_source_newlines: options.preserve_source_newlines,
                never_ascii_escape: options.never_ascii_escape,
                terminate_unterminated_literals: options.terminate_unterminated_literals,
            },
        )
        .await
    }

    /// Shared helper for intrinsic type endpoints.
    async fn call_intrinsic(
        &self,
        method: &str,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
    ) -> Result<TypeResponse> {
        self.call(method, IntrinsicTypeRequest { snapshot, project })
            .await
    }
}
