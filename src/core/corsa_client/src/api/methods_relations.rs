//! Relationship-oriented `ApiClient` methods.
//!
//! This group answers questions about how types, signatures, and symbols relate
//! to each other after the checker has already identified them.

use super::{
    ApiClient, IndexInfo, ProjectHandle, SignatureHandle, SnapshotHandle, TypeHandle,
    TypePredicateResponse, TypeResponse,
    requests_symbols::{SignatureOnlyRequest, TypeOnlyRequest, TypeProjectRequest},
};
use crate::Result;
use corsa_core::utils::split_top_level_type_text;

impl ApiClient {
    /// Returns the symbol attached to a type, if one exists.
    pub async fn get_symbol_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<super::SymbolResponse>> {
        self.call_optional("getSymbolOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns the return type of a signature.
    pub async fn get_return_type_of_signature(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        signature: SignatureHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getReturnTypeOfSignature",
            SignatureOnlyRequest {
                snapshot,
                project,
                signature,
            },
        )
        .await
    }

    /// Returns the rest type of a signature, if any.
    pub async fn get_rest_type_of_signature(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        signature: SignatureHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getRestTypeOfSignature",
            SignatureOnlyRequest {
                snapshot,
                project,
                signature,
            },
        )
        .await
    }

    /// Returns the type predicate declared on a signature, if any.
    pub async fn get_type_predicate_of_signature(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        signature: SignatureHandle,
    ) -> Result<Option<TypePredicateResponse>> {
        self.call_optional(
            "getTypePredicateOfSignature",
            SignatureOnlyRequest {
                snapshot,
                project,
                signature,
            },
        )
        .await
    }

    /// Returns the immediate base types of a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_base_types(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        self.call::<Option<Vec<TypeResponse>>, _>(
            "getBaseTypes",
            TypeProjectRequest {
                snapshot,
                project,
                r#type,
            },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns the properties exposed by a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_properties_of_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<super::SymbolResponse>> {
        self.call::<Option<Vec<super::SymbolResponse>>, _>(
            "getPropertiesOfType",
            TypeProjectRequest {
                snapshot,
                project,
                r#type,
            },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns index signature information for a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_index_infos_of_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<IndexInfo>> {
        self.call::<Option<Vec<IndexInfo>>, _>(
            "getIndexInfosOfType",
            TypeProjectRequest {
                snapshot,
                project,
                r#type,
            },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns the constraint of a type parameter, if one exists.
    pub async fn get_constraint_of_type_parameter(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional(
            "getConstraintOfTypeParameter",
            TypeProjectRequest {
                snapshot,
                project,
                r#type,
            },
        )
        .await
    }

    /// Returns the type arguments of an instantiated type.
    ///
    /// Missing server data is normalized to an empty vector. A stale type
    /// handle that the server has dropped from its snapshot registry is also
    /// treated as "no type arguments" so callers can keep analyzing the type;
    /// see [`ApiClient::is_stale_handle_error`].
    pub async fn get_type_arguments(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        match self
            .call::<Option<Vec<TypeResponse>>, _>(
                "getTypeArguments",
                TypeProjectRequest {
                    snapshot: snapshot.clone(),
                    project: project.clone(),
                    r#type: r#type.clone(),
                },
            )
            .await
        {
            Ok(Some(items)) if !items.is_empty() => Ok(items),
            Ok(_) => {
                self.fallback_type_arguments_from_text(snapshot, project, r#type)
                    .await
            }
            Err(error)
                if Self::is_stale_handle_error(&error) || Self::is_protocol_panic_error(&error) =>
            {
                self.fallback_type_arguments_from_text(snapshot, project, r#type)
                    .await
            }
            Err(error) => Err(error),
        }
    }

    /// Returns the target type underlying an instantiated or mapped type.
    pub async fn get_target_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional("getTargetOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns nested or constituent types associated with a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_types_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        self.call::<Option<Vec<TypeResponse>>, _>(
            "getTypesOfType",
            TypeOnlyRequest { snapshot, r#type },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns the direct type parameters declared on a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_type_parameters_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        self.call::<Option<Vec<TypeResponse>>, _>(
            "getTypeParametersOfType",
            TypeOnlyRequest { snapshot, r#type },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns outer type parameters captured by a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_outer_type_parameters_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        self.call::<Option<Vec<TypeResponse>>, _>(
            "getOuterTypeParametersOfType",
            TypeOnlyRequest { snapshot, r#type },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns local type parameters introduced while resolving a type.
    ///
    /// Missing server data is normalized to an empty vector.
    pub async fn get_local_type_parameters_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        self.call::<Option<Vec<TypeResponse>>, _>(
            "getLocalTypeParametersOfType",
            TypeOnlyRequest { snapshot, r#type },
        )
        .await
        .map(|items| items.unwrap_or_default())
    }

    /// Returns the object side of a wrapper type, if one exists.
    pub async fn get_object_type_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional("getObjectTypeOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns the index side of a wrapper type, if one exists.
    pub async fn get_index_type_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional("getIndexTypeOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns the check side of a wrapper or conditional type, if one exists.
    pub async fn get_check_type_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional("getCheckTypeOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns the `extends` side of a conditional type, if one exists.
    pub async fn get_extends_type_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional("getExtendsTypeOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns the base type recorded directly on a type, if one exists.
    pub async fn get_base_type_of_type(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        self.call_optional("getBaseTypeOfType", TypeOnlyRequest { snapshot, r#type })
            .await
    }

    /// Returns the constraint recorded directly on a type, if one exists.
    pub async fn get_constraint_of_type(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        if let Some(constraint) = self
            .get_constraint_of_type_parameter(snapshot.clone(), project, r#type.clone())
            .await?
        {
            return Ok(Some(constraint));
        }
        self.get_constraint_of_type_direct(snapshot, r#type).await
    }

    async fn get_constraint_of_type_direct(
        &self,
        snapshot: SnapshotHandle,
        r#type: TypeHandle,
    ) -> Result<Option<TypeResponse>> {
        match self
            .call_optional("getConstraintOfType", TypeOnlyRequest { snapshot, r#type })
            .await
        {
            Ok(constraint) => Ok(constraint),
            Err(error)
                if Self::is_stale_handle_error(&error) || Self::is_protocol_panic_error(&error) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    async fn fallback_type_arguments_from_text(
        &self,
        snapshot: SnapshotHandle,
        project: ProjectHandle,
        r#type: TypeHandle,
    ) -> Result<Vec<TypeResponse>> {
        let text = match self
            .type_to_string(snapshot, project, r#type.clone(), None, None)
            .await
        {
            Ok(text) => text,
            Err(error)
                if Self::is_stale_handle_error(&error) || Self::is_protocol_panic_error(&error) =>
            {
                return Ok(Vec::new());
            }
            Err(error) => return Err(error),
        };
        let Some(arguments) = generic_argument_text(&text) else {
            return Ok(Vec::new());
        };
        Ok(split_top_level_type_text(arguments, ',')
            .into_iter()
            .enumerate()
            .map(|(index, text)| synthetic_type_response(r#type.as_str(), index, text))
            .collect())
    }
}

fn generic_argument_text(text: &str) -> Option<&str> {
    let text = text.trim();
    let mut angle_depth = 0usize;
    let mut square_depth = 0usize;
    let mut paren_depth = 0usize;
    let mut brace_depth = 0usize;
    let mut quote = None;
    let mut open = None;
    for (index, ch) in text.char_indices() {
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' | '`' => quote = Some(ch),
            '<' if angle_depth == 0
                && square_depth == 0
                && paren_depth == 0
                && brace_depth == 0 =>
            {
                open.get_or_insert(index);
                angle_depth += 1;
            }
            '<' => angle_depth += 1,
            '>' if angle_depth > 0 => angle_depth -= 1,
            '[' => square_depth += 1,
            ']' if square_depth > 0 => square_depth -= 1,
            '(' => paren_depth += 1,
            ')' if paren_depth > 0 => paren_depth -= 1,
            '{' => brace_depth += 1,
            '}' if brace_depth > 0 => brace_depth -= 1,
            _ => {}
        }
    }
    let open = open?;
    if angle_depth != 0 || !text.ends_with('>') {
        return None;
    }
    Some(&text[open + 1..text.len() - 1])
}

fn synthetic_type_response(source_type: &str, index: usize, text: String) -> TypeResponse {
    TypeResponse {
        id: TypeHandle::from(format!(
            "synthetic-type-argument:{source_type}:{index}:{text}"
        )),
        flags: 0,
        object_flags: None,
        value: None,
        target: None,
        type_parameters: Vec::new(),
        outer_type_parameters: Vec::new(),
        local_type_parameters: Vec::new(),
        element_flags: Vec::new(),
        fixed_length: None,
        readonly: None,
        object_type: None,
        index_type: None,
        check_type: None,
        extends_type: None,
        base_type: None,
        subst_constraint: None,
        texts: vec![text],
        symbol: None,
    }
}
