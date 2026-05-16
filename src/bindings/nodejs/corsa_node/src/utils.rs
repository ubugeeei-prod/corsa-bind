#![allow(dead_code)]

use napi::Result;
use napi_derive::napi;

use crate::util::into_napi_error;

#[napi]
pub fn classify_type_text(text: Option<String>) -> String {
    corsa::utils::classify_type_text(text.as_deref())
        .as_str()
        .to_owned()
}

#[napi]
pub fn split_top_level_type_text(text: String, delimiter: String) -> Result<Vec<String>> {
    let mut chars = delimiter.chars();
    let Some(delimiter) = chars.next() else {
        return Err(into_napi_error(
            "delimiter must contain exactly one character",
        ));
    };
    if chars.next().is_some() {
        return Err(into_napi_error(
            "delimiter must contain exactly one character",
        ));
    }
    Ok(corsa::utils::split_top_level_type_text(
        text.as_str(),
        delimiter,
    ))
}

#[napi]
pub fn split_type_text(text: String) -> Vec<String> {
    corsa::utils::split_type_text(text.as_str())
}

#[napi]
pub fn is_string_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_string_like_type_texts(&type_texts)
}

#[napi]
pub fn is_number_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_number_like_type_texts(&type_texts)
}

#[napi]
pub fn is_big_int_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_bigint_like_type_texts(&type_texts)
}

#[napi]
pub fn is_any_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_any_like_type_texts(&type_texts)
}

#[napi]
pub fn is_unknown_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_unknown_like_type_texts(&type_texts)
}

#[napi]
pub fn is_array_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_array_like_type_texts(&type_texts)
}

#[napi]
pub fn is_string_array_like_type_texts(type_texts: Vec<String>) -> bool {
    corsa::utils::is_string_array_like_type_texts(&type_texts)
}

#[napi]
pub fn is_promise_like_type_texts(
    type_texts: Vec<String>,
    property_names: Option<Vec<String>>,
) -> bool {
    let property_names = property_names.unwrap_or_default();
    corsa::utils::is_promise_like_type_texts(&type_texts, &property_names)
}

#[napi]
pub fn is_error_like_type_texts(
    type_texts: Vec<String>,
    property_names: Option<Vec<String>>,
) -> bool {
    let property_names = property_names.unwrap_or_default();
    corsa::utils::is_error_like_type_texts(&type_texts, &property_names)
}
