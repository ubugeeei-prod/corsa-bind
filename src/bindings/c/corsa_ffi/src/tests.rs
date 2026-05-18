use std::{path::PathBuf, ptr};

use crate::{
    api_client::{
        corsa_tsgo_api_client_close, corsa_tsgo_api_client_free,
        corsa_tsgo_api_client_get_declared_type_of_symbol_json,
        corsa_tsgo_api_client_get_string_type_json,
        corsa_tsgo_api_client_get_symbol_at_position_json,
        corsa_tsgo_api_client_get_type_arguments_json,
        corsa_tsgo_api_client_get_type_at_position_json,
        corsa_tsgo_api_client_get_type_of_symbol_json, corsa_tsgo_api_client_spawn,
        corsa_tsgo_api_client_update_snapshot_json,
    },
    error::corsa_error_message_take,
    types::{CorsaStrRef, CorsaString, corsa_utils_string_free, corsa_utils_string_list_free},
    utils::{
        corsa_utils_classify_type_text, corsa_utils_has_unsafe_any_flow,
        corsa_utils_is_any_like_type_texts, corsa_utils_is_error_like_type_texts,
        corsa_utils_split_top_level_type_text, corsa_utils_split_type_text,
    },
    virtual_document::{
        corsa_virtual_document_free, corsa_virtual_document_splice, corsa_virtual_document_text,
        corsa_virtual_document_untitled, corsa_virtual_document_version,
    },
};

fn text_ref(text: &str) -> CorsaStrRef {
    CorsaStrRef {
        ptr: text.as_ptr(),
        len: text.len(),
    }
}

fn null_text_ref() -> CorsaStrRef {
    CorsaStrRef {
        ptr: ptr::null(),
        len: 8,
    }
}

fn empty_text_ref() -> CorsaStrRef {
    CorsaStrRef {
        ptr: ptr::dangling(),
        len: 0,
    }
}

fn invalid_utf8_ref() -> CorsaStrRef {
    static INVALID_UTF8: [u8; 3] = [0x66, 0x80, 0x6f];
    CorsaStrRef {
        ptr: INVALID_UTF8.as_ptr(),
        len: INVALID_UTF8.len(),
    }
}

fn take_string(value: CorsaString) -> String {
    if value.ptr.is_null() {
        return String::new();
    }
    let text = unsafe {
        std::str::from_utf8(std::slice::from_raw_parts(
            value.ptr.cast::<u8>(),
            value.len,
        ))
        .unwrap()
        .to_owned()
    };
    unsafe {
        corsa_utils_string_free(value);
    }
    text
}

fn take_string_list(value: crate::types::CorsaStringList) -> Vec<String> {
    let values = if value.ptr.is_null() {
        Vec::new()
    } else {
        unsafe { std::slice::from_raw_parts(value.ptr, value.len) }
            .iter()
            .map(|value| unsafe {
                std::str::from_utf8(std::slice::from_raw_parts(
                    value.ptr.cast::<u8>(),
                    value.len,
                ))
                .unwrap()
                .to_owned()
            })
            .collect::<Vec<_>>()
    };
    unsafe {
        corsa_utils_string_list_free(value);
    }
    values
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .unwrap()
        .to_owned()
}

fn mock_tsgo_binary() -> Option<PathBuf> {
    let binary = workspace_root().join(if cfg!(windows) {
        "target/debug/mock_tsgo.exe"
    } else {
        "target/debug/mock_tsgo"
    });
    binary.exists().then_some(binary)
}

#[test]
fn treats_null_and_empty_str_refs_as_empty_utility_inputs() {
    assert_eq!(
        take_string(unsafe { corsa_utils_classify_type_text(null_text_ref()) }),
        "other"
    );
    assert_eq!(
        take_string(unsafe { corsa_utils_classify_type_text(empty_text_ref()) }),
        "other"
    );
    assert_eq!(
        take_string_list(unsafe { corsa_utils_split_type_text(null_text_ref()) }),
        Vec::<String>::new()
    );
    assert_eq!(
        take_string_list(unsafe {
            corsa_utils_split_top_level_type_text(empty_text_ref(), b'|' as u32)
        }),
        Vec::<String>::new()
    );

    let type_texts = [null_text_ref(), empty_text_ref()];
    assert!(!unsafe { corsa_utils_is_any_like_type_texts(type_texts.as_ptr(), type_texts.len()) });
    assert!(!unsafe {
        corsa_utils_has_unsafe_any_flow(
            type_texts.as_ptr(),
            type_texts.len(),
            type_texts.as_ptr(),
            type_texts.len(),
        )
    });
}

#[test]
fn returns_safe_defaults_for_invalid_utf8_utility_inputs() {
    assert_eq!(
        take_string(unsafe { corsa_utils_classify_type_text(invalid_utf8_ref()) }),
        "other"
    );
    assert_eq!(
        take_string_list(unsafe { corsa_utils_split_type_text(invalid_utf8_ref()) }),
        Vec::<String>::new()
    );
    assert_eq!(
        take_string_list(unsafe {
            corsa_utils_split_top_level_type_text(invalid_utf8_ref(), b'|' as u32)
        }),
        Vec::<String>::new()
    );

    let type_texts = [text_ref("any"), invalid_utf8_ref()];
    assert!(!unsafe { corsa_utils_is_any_like_type_texts(type_texts.as_ptr(), type_texts.len()) });
    assert!(!unsafe {
        corsa_utils_has_unsafe_any_flow(
            type_texts.as_ptr(),
            type_texts.len(),
            type_texts.as_ptr(),
            type_texts.len(),
        )
    });
}

#[test]
fn reports_invalid_utf8_for_ffi_inputs_that_set_last_error() {
    let document = unsafe {
        corsa_virtual_document_untitled(
            text_ref("/demo.ts"),
            invalid_utf8_ref(),
            text_ref("const value = 1;"),
        )
    };
    assert!(document.is_null());

    let message = take_string(corsa_error_message_take());
    assert!(message.contains("language_id must be valid UTF-8"));
}

#[test]
fn classifies_type_texts_over_ffi() {
    let result = unsafe { corsa_utils_classify_type_text(text_ref("Promise<string> | null")) };
    let text = take_string(result);
    assert_eq!(text, "nullish");
}

#[test]
fn splits_type_texts_over_ffi() {
    let result = unsafe { corsa_utils_split_type_text(text_ref("string | Array<any>")) };
    let values = take_string_list(result);
    assert_eq!(values, vec!["string", "Array<any>"]);
}

#[test]
fn evaluates_predicates_over_ffi() {
    let type_texts = [text_ref("TypeError")];
    let property_names = [text_ref("message"), text_ref("name")];
    assert!(unsafe {
        corsa_utils_is_error_like_type_texts(
            type_texts.as_ptr(),
            type_texts.len(),
            property_names.as_ptr(),
            property_names.len(),
        )
    });
    let source_texts = [text_ref("Promise<any>")];
    let target_texts = [text_ref("Promise<string>")];
    assert!(unsafe {
        corsa_utils_has_unsafe_any_flow(
            source_texts.as_ptr(),
            source_texts.len(),
            target_texts.as_ptr(),
            target_texts.len(),
        )
    });
}

#[test]
fn edits_virtual_documents_over_ffi() {
    let document = unsafe {
        corsa_virtual_document_untitled(
            text_ref("/demo.ts"),
            text_ref("typescript"),
            text_ref("const value = 1;"),
        )
    };
    assert!(!document.is_null());
    assert!(unsafe { corsa_virtual_document_splice(document, 0, 14, 0, 15, text_ref("2")) });
    let text = unsafe { corsa_virtual_document_text(document) };
    let rendered = unsafe {
        std::str::from_utf8(std::slice::from_raw_parts(text.ptr.cast::<u8>(), text.len))
            .unwrap()
            .to_owned()
    };
    unsafe {
        corsa_utils_string_free(text);
    }
    assert_eq!(rendered, "const value = 2;");
    assert_eq!(unsafe { corsa_virtual_document_version(document) }, 2);
    unsafe {
        corsa_virtual_document_free(document);
    }
}

#[test]
fn reports_virtual_document_errors() {
    let document = unsafe {
        corsa_virtual_document_untitled(
            text_ref("/demo.ts"),
            text_ref("typescript"),
            text_ref("const value = 1;"),
        )
    };
    assert!(!unsafe { corsa_virtual_document_splice(document, 9, 0, 9, 1, text_ref("2")) });
    let error = corsa_error_message_take();
    let message = unsafe {
        std::str::from_utf8(std::slice::from_raw_parts(
            error.ptr.cast::<u8>(),
            error.len,
        ))
        .unwrap()
        .to_owned()
    };
    unsafe {
        corsa_utils_string_free(error);
        corsa_virtual_document_free(document);
    }
    assert!(message.contains("out of bounds"));
}

#[test]
fn reports_api_client_spawn_errors() {
    let client = unsafe {
        corsa_tsgo_api_client_spawn(text_ref(r#"{"executable":"./definitely-missing-tsgo"}"#))
    };
    assert!(client.is_null());
    let error = corsa_error_message_take();
    let message = unsafe {
        std::str::from_utf8(std::slice::from_raw_parts(
            error.ptr.cast::<u8>(),
            error.len,
        ))
        .unwrap()
        .to_owned()
    };
    unsafe {
        corsa_utils_string_free(error);
    }
    assert!(!message.is_empty());
}

#[test]
fn resolves_checker_positions_over_ffi() {
    let Some(binary) = mock_tsgo_binary() else {
        return;
    };
    let options = serde_json::json!({
        "executable": binary.display().to_string(),
        "cwd": workspace_root().display().to_string(),
        "mode": "jsonrpc",
    })
    .to_string();
    let client = unsafe { corsa_tsgo_api_client_spawn(text_ref(&options)) };
    assert!(!client.is_null());

    let snapshot_json = take_string(unsafe {
        corsa_tsgo_api_client_update_snapshot_json(
            client,
            text_ref(r#"{"openProject":"/workspace/tsconfig.json"}"#),
        )
    });
    let snapshot: serde_json::Value = serde_json::from_str(&snapshot_json).unwrap();
    let snapshot_id = snapshot["snapshot"].as_str().unwrap();
    let project_id = snapshot["projects"][0]["id"].as_str().unwrap();

    let type_json = take_string(unsafe {
        corsa_tsgo_api_client_get_type_at_position_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref("/workspace/src/index.ts"),
            1,
        )
    });
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&type_json).unwrap()["id"],
        "t0000000000000001"
    );

    let symbol_json = take_string(unsafe {
        corsa_tsgo_api_client_get_symbol_at_position_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref("/workspace/src/index.ts"),
            1,
        )
    });
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&symbol_json).unwrap()["name"],
        "value"
    );

    assert!(unsafe { corsa_tsgo_api_client_close(client) });
    unsafe {
        corsa_tsgo_api_client_free(client);
    }
}

#[test]
fn resolves_type_arguments_over_ffi() {
    let Some(binary) = mock_tsgo_binary() else {
        return;
    };
    let options = serde_json::json!({
        "executable": binary.display().to_string(),
        "cwd": workspace_root().display().to_string(),
        "mode": "jsonrpc",
    })
    .to_string();
    let client = unsafe { corsa_tsgo_api_client_spawn(text_ref(&options)) };
    assert!(!client.is_null());

    let snapshot_json = take_string(unsafe {
        corsa_tsgo_api_client_update_snapshot_json(
            client,
            text_ref(r#"{"openProject":"/workspace/tsconfig.json"}"#),
        )
    });
    let snapshot: serde_json::Value = serde_json::from_str(&snapshot_json).unwrap();
    let snapshot_id = snapshot["snapshot"].as_str().unwrap();
    let project_id = snapshot["projects"][0]["id"].as_str().unwrap();

    let string_type_json = take_string(unsafe {
        corsa_tsgo_api_client_get_string_type_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
        )
    });
    let string_type: serde_json::Value = serde_json::from_str(&string_type_json).unwrap();
    let type_id = string_type["id"].as_str().unwrap().to_owned();
    let object_flags = string_type["objectFlags"].as_u64().unwrap() as u32;

    let non_reference_json = take_string(unsafe {
        corsa_tsgo_api_client_get_type_arguments_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref(type_id.as_str()),
            object_flags,
        )
    });
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&non_reference_json).unwrap(),
        serde_json::json!([])
    );

    let reference_json = take_string(unsafe {
        corsa_tsgo_api_client_get_type_arguments_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref(type_id.as_str()),
            1 << 2,
        )
    });
    let reference_arguments: serde_json::Value = serde_json::from_str(&reference_json).unwrap();
    assert_eq!(reference_arguments[0]["id"], "t0000000000000001");

    assert!(unsafe { corsa_tsgo_api_client_close(client) });
    unsafe {
        corsa_tsgo_api_client_free(client);
    }
}

#[test]
fn resolves_symbol_type_methods_over_ffi() {
    let Some(binary) = mock_tsgo_binary() else {
        return;
    };
    let options = serde_json::json!({
        "executable": binary.display().to_string(),
        "cwd": workspace_root().display().to_string(),
        "mode": "jsonrpc",
    })
    .to_string();
    let client = unsafe { corsa_tsgo_api_client_spawn(text_ref(&options)) };
    assert!(!client.is_null());

    let snapshot_json = take_string(unsafe {
        corsa_tsgo_api_client_update_snapshot_json(
            client,
            text_ref(r#"{"openProject":"/workspace/tsconfig.json"}"#),
        )
    });
    let snapshot: serde_json::Value = serde_json::from_str(&snapshot_json).unwrap();
    let snapshot_id = snapshot["snapshot"].as_str().unwrap();
    let project_id = snapshot["projects"][0]["id"].as_str().unwrap();

    let symbol_json = take_string(unsafe {
        corsa_tsgo_api_client_get_symbol_at_position_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref("/workspace/src/index.ts"),
            1,
        )
    });
    let symbol: serde_json::Value = serde_json::from_str(&symbol_json).unwrap();
    assert_eq!(symbol["name"], "value");
    let symbol_id = symbol["id"].as_str().unwrap().to_owned();

    let symbol_type_json = take_string(unsafe {
        corsa_tsgo_api_client_get_type_of_symbol_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref(symbol_id.as_str()),
        )
    });
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&symbol_type_json).unwrap()["id"],
        "t0000000000000001"
    );

    let declared_type_json = take_string(unsafe {
        corsa_tsgo_api_client_get_declared_type_of_symbol_json(
            client,
            text_ref(snapshot_id),
            text_ref(project_id),
            text_ref(symbol_id.as_str()),
        )
    });
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&declared_type_json).unwrap()["id"],
        "t0000000000000001"
    );

    assert!(unsafe { corsa_tsgo_api_client_close(client) });
    unsafe {
        corsa_tsgo_api_client_free(client);
    }
}
