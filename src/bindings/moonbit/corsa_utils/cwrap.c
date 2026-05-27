#include <moonbit.h>

#include "../../../c/corsa_ffi/include/corsa_utils.h"

#include <stdint.h>
#include <string.h>

static CorsaStrRef corsa_moonbit_ref(moonbit_bytes_t bytes) {
  return (CorsaStrRef){
      .ptr = bytes,
      .len = bytes == NULL ? 0 : (size_t)Moonbit_array_length(bytes),
  };
}

static moonbit_bytes_t corsa_bytes_from_string(CorsaString value) {
  moonbit_bytes_t out = moonbit_make_bytes_raw((int32_t)value.len);
  if (value.ptr != NULL && value.len != 0) {
    memcpy(out, value.ptr, value.len);
  }
  corsa_utils_string_free(value);
  return out;
}

static moonbit_bytes_t corsa_bytes_from_optional(CorsaBytes value) {
  moonbit_bytes_t out = moonbit_make_bytes_raw((int32_t)value.len);
  if (value.status == CORSA_RESULT_SOME && value.ptr != NULL && value.len != 0) {
    memcpy(out, value.ptr, value.len);
  }
  corsa_bytes_free(value);
  return out;
}

static int64_t corsa_virtual_document_handle(CorsaVirtualDocument *value) {
  return (int64_t)(intptr_t)value;
}

static CorsaVirtualDocument *corsa_virtual_document_from_handle(int64_t value) {
  return (CorsaVirtualDocument *)(intptr_t)value;
}

static int64_t corsa_api_client_handle(CorsaApiClient *value) {
  return (int64_t)(intptr_t)value;
}

static CorsaApiClient *corsa_api_client_from_handle(int64_t value) {
  return (CorsaApiClient *)(intptr_t)value;
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_utils_classify_type_text_mbt(moonbit_bytes_t text) {
  return corsa_bytes_from_string(corsa_utils_classify_type_text(corsa_moonbit_ref(text)));
}

static int32_t corsa_single_text_predicate(
    moonbit_bytes_t text,
    bool (*predicate)(const CorsaStrRef *, size_t)) {
  CorsaStrRef type_texts[1] = {corsa_moonbit_ref(text)};
  return predicate(type_texts, 1);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_string_like_type_texts_mbt(moonbit_bytes_t text) {
  return corsa_single_text_predicate(text, corsa_utils_is_string_like_type_texts);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_number_like_type_texts_mbt(moonbit_bytes_t text) {
  return corsa_single_text_predicate(text, corsa_utils_is_number_like_type_texts);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_bigint_like_type_texts_mbt(moonbit_bytes_t text) {
  return corsa_single_text_predicate(text, corsa_utils_is_bigint_like_type_texts);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_any_like_type_texts_mbt(moonbit_bytes_t text) {
  return corsa_single_text_predicate(text, corsa_utils_is_any_like_type_texts);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_unknown_like_type_texts_mbt(moonbit_bytes_t text) {
  return corsa_single_text_predicate(text, corsa_utils_is_unknown_like_type_texts);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_array_like_type_texts_mbt(moonbit_bytes_t text) {
  return corsa_single_text_predicate(text, corsa_utils_is_array_like_type_texts);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_promise_like_type_texts_mbt(
    moonbit_bytes_t type_text,
    moonbit_bytes_t property_name) {
  CorsaStrRef type_texts[1] = {corsa_moonbit_ref(type_text)};
  CorsaStrRef property_names[1] = {corsa_moonbit_ref(property_name)};
  return corsa_utils_is_promise_like_type_texts(type_texts, 1, property_names, 1);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_error_like_type_texts_mbt(
    moonbit_bytes_t type_text,
    moonbit_bytes_t property_name_a,
    moonbit_bytes_t property_name_b) {
  CorsaStrRef type_texts[1] = {corsa_moonbit_ref(type_text)};
  CorsaStrRef property_names[2] = {
      corsa_moonbit_ref(property_name_a),
      corsa_moonbit_ref(property_name_b),
  };
  return corsa_utils_is_error_like_type_texts(type_texts, 1, property_names, 2);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_has_unsafe_any_flow_mbt(
    moonbit_bytes_t source_text,
    moonbit_bytes_t target_text) {
  CorsaStrRef source_texts[1] = {corsa_moonbit_ref(source_text)};
  CorsaStrRef target_texts[1] = {corsa_moonbit_ref(target_text)};
  return corsa_utils_has_unsafe_any_flow(source_texts, 1, target_texts, 1);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_unsafe_assignment_mbt(
    moonbit_bytes_t source_text,
    moonbit_bytes_t target_text) {
  CorsaStrRef source_texts[1] = {corsa_moonbit_ref(source_text)};
  CorsaStrRef target_texts[1] = {corsa_moonbit_ref(target_text)};
  return corsa_utils_is_unsafe_assignment(source_texts, 1, target_texts, 1);
}

MOONBIT_FFI_EXPORT int32_t corsa_utils_is_unsafe_return_mbt(
    moonbit_bytes_t source_text,
    moonbit_bytes_t target_text) {
  CorsaStrRef source_texts[1] = {corsa_moonbit_ref(source_text)};
  CorsaStrRef target_texts[1] = {corsa_moonbit_ref(target_text)};
  return corsa_utils_is_unsafe_return(source_texts, 1, target_texts, 1);
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_error_message_take_mbt(void) {
  return corsa_bytes_from_string(corsa_error_message_take());
}

MOONBIT_FFI_EXPORT int64_t corsa_virtual_document_untitled_mbt(
    moonbit_bytes_t path,
    moonbit_bytes_t language_id,
    moonbit_bytes_t text) {
  return corsa_virtual_document_handle(corsa_virtual_document_untitled(
      corsa_moonbit_ref(path),
      corsa_moonbit_ref(language_id),
      corsa_moonbit_ref(text)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_virtual_document_text_mbt(int64_t handle) {
  return corsa_bytes_from_string(
      corsa_virtual_document_text(corsa_virtual_document_from_handle(handle)));
}

MOONBIT_FFI_EXPORT int32_t corsa_virtual_document_version_mbt(int64_t handle) {
  return corsa_virtual_document_version(corsa_virtual_document_from_handle(handle));
}

MOONBIT_FFI_EXPORT int32_t corsa_virtual_document_splice_mbt(
    int64_t handle,
    int32_t start_line,
    int32_t start_character,
    int32_t end_line,
    int32_t end_character,
    moonbit_bytes_t text) {
  return corsa_virtual_document_splice(
      corsa_virtual_document_from_handle(handle),
      (uint32_t)start_line,
      (uint32_t)start_character,
      (uint32_t)end_line,
      (uint32_t)end_character,
      corsa_moonbit_ref(text));
}

MOONBIT_FFI_EXPORT void corsa_virtual_document_free_mbt(int64_t handle) {
  corsa_virtual_document_free(corsa_virtual_document_from_handle(handle));
}

MOONBIT_FFI_EXPORT int64_t corsa_api_client_spawn_mbt(moonbit_bytes_t options_json) {
  return corsa_api_client_handle(corsa_api_client_spawn(corsa_moonbit_ref(options_json)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_initialize_json_mbt(int64_t handle) {
  return corsa_bytes_from_string(
      corsa_api_client_initialize_json(corsa_api_client_from_handle(handle)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_parse_config_file_json_mbt(
    int64_t handle,
    moonbit_bytes_t file) {
  return corsa_bytes_from_string(corsa_api_client_parse_config_file_json(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(file)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_update_snapshot_json_mbt(
    int64_t handle,
    moonbit_bytes_t params_json) {
  return corsa_bytes_from_string(corsa_api_client_update_snapshot_json(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(params_json)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_get_source_file_mbt(
    int64_t handle,
    moonbit_bytes_t snapshot,
    moonbit_bytes_t project,
    moonbit_bytes_t file) {
  return corsa_bytes_from_optional(corsa_api_client_get_source_file(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(snapshot),
      corsa_moonbit_ref(project),
      corsa_moonbit_ref(file)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_get_string_type_json_mbt(
    int64_t handle,
    moonbit_bytes_t snapshot,
    moonbit_bytes_t project) {
  return corsa_bytes_from_string(corsa_api_client_get_string_type_json(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(snapshot),
      corsa_moonbit_ref(project)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_type_to_string_mbt(
    int64_t handle,
    moonbit_bytes_t snapshot,
    moonbit_bytes_t project,
    moonbit_bytes_t type_handle,
    moonbit_bytes_t location,
    int32_t flags) {
  return corsa_bytes_from_string(corsa_api_client_type_to_string(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(snapshot),
      corsa_moonbit_ref(project),
      corsa_moonbit_ref(type_handle),
      corsa_moonbit_ref(location),
      flags));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_call_json_mbt(
    int64_t handle,
    moonbit_bytes_t method,
    moonbit_bytes_t params_json) {
  return corsa_bytes_from_string(corsa_api_client_call_json(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(method),
      corsa_moonbit_ref(params_json)));
}

MOONBIT_FFI_EXPORT moonbit_bytes_t corsa_api_client_call_binary_mbt(
    int64_t handle,
    moonbit_bytes_t method,
    moonbit_bytes_t params_json) {
  return corsa_bytes_from_optional(corsa_api_client_call_binary(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(method),
      corsa_moonbit_ref(params_json)));
}

MOONBIT_FFI_EXPORT int32_t corsa_api_client_release_handle_mbt(
    int64_t handle,
    moonbit_bytes_t value) {
  return corsa_api_client_release_handle(
      corsa_api_client_from_handle(handle),
      corsa_moonbit_ref(value));
}

MOONBIT_FFI_EXPORT int32_t corsa_api_client_close_mbt(int64_t handle) {
  return corsa_api_client_close(corsa_api_client_from_handle(handle));
}

MOONBIT_FFI_EXPORT void corsa_api_client_free_mbt(int64_t handle) {
  corsa_api_client_free(corsa_api_client_from_handle(handle));
}
