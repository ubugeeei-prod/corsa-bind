#pragma once

#include <cstdint>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "../c/corsa_ffi/include/corsa_utils.h"

namespace corsa::utils {

inline CorsaStrRef to_ref(std::string_view value) {
  return CorsaStrRef{
      reinterpret_cast<const uint8_t *>(value.data()),
      value.size(),
  };
}

inline std::vector<CorsaStrRef> to_refs(std::span<const std::string_view> values) {
  std::vector<CorsaStrRef> refs;
  refs.reserve(values.size());
  for (auto value : values) {
    refs.push_back(to_ref(value));
  }
  return refs;
}

inline std::string take_string(CorsaString value) {
  std::string out;
  if (value.ptr != nullptr && value.len != 0) {
    out.assign(value.ptr, value.len);
  }
  corsa_utils_string_free(value);
  return out;
}

inline std::vector<std::string> take_string_list(CorsaStringList value) {
  std::vector<std::string> out;
  out.reserve(value.len);
  for (size_t index = 0; index < value.len; ++index) {
    const auto &item = value.ptr[index];
    out.emplace_back(item.ptr == nullptr ? "" : std::string(item.ptr, item.len));
  }
  corsa_utils_string_list_free(value);
  return out;
}

inline std::optional<std::vector<std::uint8_t>> take_bytes(CorsaBytes value) {
  if (value.status == CORSA_RESULT_NONE) {
    corsa_bytes_free(value);
    return std::nullopt;
  }
  if (value.status != CORSA_RESULT_SOME) {
    corsa_bytes_free(value);
    auto message = take_string(corsa_error_message_take());
    throw std::runtime_error(message.empty() ? "corsa FFI returned an error payload" : message);
  }
  std::vector<std::uint8_t> out;
  out.reserve(value.len);
  for (size_t index = 0; index < value.len; ++index) {
    out.push_back(value.ptr[index]);
  }
  corsa_bytes_free(value);
  return out;
}

inline std::string classify_type_text(std::string_view text) {
  return take_string(corsa_utils_classify_type_text(to_ref(text)));
}

inline std::vector<std::string> split_top_level_type_text(std::string_view text, char delimiter) {
  return take_string_list(corsa_utils_split_top_level_type_text(
      to_ref(text),
      static_cast<uint32_t>(static_cast<unsigned char>(delimiter))));
}

inline std::vector<std::string> split_type_text(std::string_view text) {
  return take_string_list(corsa_utils_split_type_text(to_ref(text)));
}

template <typename Fn>
inline bool call_single_predicate(std::span<const std::string_view> type_texts, Fn fn) {
  auto refs = to_refs(type_texts);
  return fn(refs.empty() ? nullptr : refs.data(), refs.size());
}

template <typename Fn>
inline bool call_dual_predicate(
    std::span<const std::string_view> type_texts,
    std::span<const std::string_view> property_names,
    Fn fn) {
  auto type_refs = to_refs(type_texts);
  auto property_refs = to_refs(property_names);
  return fn(
      type_refs.empty() ? nullptr : type_refs.data(),
      type_refs.size(),
      property_refs.empty() ? nullptr : property_refs.data(),
      property_refs.size());
}

inline bool is_string_like_type_texts(std::span<const std::string_view> type_texts) {
  return call_single_predicate(type_texts, corsa_utils_is_string_like_type_texts);
}

inline bool is_number_like_type_texts(std::span<const std::string_view> type_texts) {
  return call_single_predicate(type_texts, corsa_utils_is_number_like_type_texts);
}

inline bool is_bigint_like_type_texts(std::span<const std::string_view> type_texts) {
  return call_single_predicate(type_texts, corsa_utils_is_bigint_like_type_texts);
}

inline bool is_any_like_type_texts(std::span<const std::string_view> type_texts) {
  return call_single_predicate(type_texts, corsa_utils_is_any_like_type_texts);
}

inline bool is_unknown_like_type_texts(std::span<const std::string_view> type_texts) {
  return call_single_predicate(type_texts, corsa_utils_is_unknown_like_type_texts);
}

inline bool is_array_like_type_texts(std::span<const std::string_view> type_texts) {
  return call_single_predicate(type_texts, corsa_utils_is_array_like_type_texts);
}

inline bool is_promise_like_type_texts(
    std::span<const std::string_view> type_texts,
    std::span<const std::string_view> property_names = {}) {
  return call_dual_predicate(type_texts, property_names, corsa_utils_is_promise_like_type_texts);
}

inline bool is_error_like_type_texts(
    std::span<const std::string_view> type_texts,
    std::span<const std::string_view> property_names = {}) {
  return call_dual_predicate(type_texts, property_names, corsa_utils_is_error_like_type_texts);
}

template <typename Fn>
inline bool call_flow_predicate(
    std::span<const std::string_view> source_texts,
    std::span<const std::string_view> target_texts,
    Fn fn) {
  auto source_refs = to_refs(source_texts);
  auto target_refs = to_refs(target_texts);
  return fn(
      source_refs.empty() ? nullptr : source_refs.data(),
      source_refs.size(),
      target_refs.empty() ? nullptr : target_refs.data(),
      target_refs.size());
}

inline bool has_unsafe_any_flow(
    std::span<const std::string_view> source_texts,
    std::span<const std::string_view> target_texts) {
  return call_flow_predicate(source_texts, target_texts, corsa_utils_has_unsafe_any_flow);
}

inline bool is_unsafe_assignment(
    std::span<const std::string_view> source_texts,
    std::span<const std::string_view> target_texts) {
  return call_flow_predicate(source_texts, target_texts, corsa_utils_is_unsafe_assignment);
}

inline bool is_unsafe_return(
    std::span<const std::string_view> source_texts,
    std::span<const std::string_view> target_texts) {
  return call_flow_predicate(source_texts, target_texts, corsa_utils_is_unsafe_return);
}

}  // namespace corsa::utils
