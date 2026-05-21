use std::{ffi::c_char, ptr, slice};

use smallvec::SmallVec;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CorsaStrRef {
    pub ptr: *const u8,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CorsaString {
    pub ptr: *mut c_char,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct CorsaBytes {
    pub ptr: *mut u8,
    pub len: usize,
    pub present: bool,
    pub status: CorsaResultStatus,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum CorsaResultStatus {
    #[default]
    Error = 0,
    None = 1,
    Some = 2,
}

#[repr(C)]
#[derive(Debug, Default)]
pub struct CorsaStringList {
    pub ptr: *mut CorsaString,
    pub len: usize,
}

impl CorsaStrRef {
    pub unsafe fn as_str<'a>(self) -> Option<&'a str> {
        if self.ptr.is_null() || self.len == 0 {
            return Some("");
        }
        let bytes = unsafe { slice::from_raw_parts(self.ptr, self.len) };
        std::str::from_utf8(bytes).ok()
    }
}

pub fn into_c_string(value: &str) -> CorsaString {
    if value.is_empty() {
        return CorsaString::default();
    }
    let mut bytes = Vec::with_capacity(value.len() + 1);
    bytes.extend_from_slice(value.as_bytes());
    bytes.push(0);
    let len = bytes.len() - 1;
    let boxed = bytes.into_boxed_slice();
    CorsaString {
        len,
        ptr: Box::into_raw(boxed).cast::<c_char>(),
    }
}

pub fn into_c_string_list(values: Vec<String>) -> CorsaStringList {
    if values.is_empty() {
        return CorsaStringList::default();
    }
    let boxed = values
        .into_iter()
        .map(|value| into_c_string(value.as_str()))
        .collect::<Vec<_>>()
        .into_boxed_slice();
    let len = boxed.len();
    CorsaStringList {
        len,
        ptr: Box::into_raw(boxed) as *mut CorsaString,
    }
}

pub fn into_c_bytes(value: Option<Vec<u8>>) -> CorsaBytes {
    let Some(value) = value else {
        return CorsaBytes {
            status: CorsaResultStatus::None,
            ..CorsaBytes::default()
        };
    };
    let boxed = value.into_boxed_slice();
    let len = boxed.len();
    CorsaBytes {
        ptr: Box::into_raw(boxed) as *mut u8,
        len,
        present: true,
        status: CorsaResultStatus::Some,
    }
}

pub unsafe fn collect_strings<'a>(
    ptr: *const CorsaStrRef,
    len: usize,
) -> Option<SmallVec<[&'a str; 8]>> {
    if ptr.is_null() || len == 0 {
        return Some(SmallVec::new());
    }
    let values = unsafe { slice::from_raw_parts(ptr, len) };
    let mut collected = SmallVec::with_capacity(values.len());
    for value in values {
        let text = unsafe { value.as_str() }?;
        collected.push(text);
    }
    Some(collected)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_utils_string_free(value: CorsaString) {
    if value.ptr.is_null() {
        return;
    }
    let slice = ptr::slice_from_raw_parts_mut(value.ptr.cast::<u8>(), value.len + 1);
    let _ = unsafe { Box::from_raw(slice) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_utils_string_list_free(value: CorsaStringList) {
    if value.ptr.is_null() || value.len == 0 {
        return;
    }
    let slice = ptr::slice_from_raw_parts_mut(value.ptr, value.len);
    let boxed = unsafe { Box::from_raw(slice) };
    for item in boxed.iter() {
        unsafe {
            corsa_utils_string_free(*item);
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn corsa_bytes_free(value: CorsaBytes) {
    if !value.present || value.ptr.is_null() {
        return;
    }
    let slice = ptr::slice_from_raw_parts_mut(value.ptr, value.len);
    let _ = unsafe { Box::from_raw(slice) };
}
