#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "../c/corsa_ffi/include/corsa_utils.h"
#include "corsa_utils.hpp"

namespace corsa::api {

inline std::string take_last_error() {
  return utils::take_string(corsa_error_message_take());
}

class corsa_api_client {
 public:
  corsa_api_client() = default;
  explicit corsa_api_client(CorsaApiClient *handle) : handle_(handle) {}

  corsa_api_client(const corsa_api_client &) = delete;
  corsa_api_client &operator=(const corsa_api_client &) = delete;

  corsa_api_client(corsa_api_client &&other) noexcept : handle_(std::exchange(other.handle_, nullptr)) {}
  corsa_api_client &operator=(corsa_api_client &&other) noexcept {
    if (this != &other) {
      reset();
      handle_ = std::exchange(other.handle_, nullptr);
    }
    return *this;
  }

  ~corsa_api_client() { reset(); }

  static corsa_api_client spawn(std::string_view options_json) {
    return corsa_api_client(corsa_api_client_spawn(utils::to_ref(options_json)));
  }

  explicit operator bool() const { return handle_ != nullptr; }

  std::string initialize_json() const {
    return utils::take_string(corsa_api_client_initialize_json(handle_));
  }

  std::string parse_config_file_json(std::string_view file) const {
    return utils::take_string(corsa_api_client_parse_config_file_json(handle_, utils::to_ref(file)));
  }

  std::string update_snapshot_json(std::string_view params_json = {}) const {
    return utils::take_string(corsa_api_client_update_snapshot_json(handle_, utils::to_ref(params_json)));
  }

  std::optional<std::vector<std::uint8_t>> get_source_file(
      std::string_view snapshot,
      std::string_view project,
      std::string_view file) const {
    return utils::take_bytes(corsa_api_client_get_source_file(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(file)));
  }

  std::string get_string_type_json(std::string_view snapshot, std::string_view project) const {
    return utils::take_string(corsa_api_client_get_string_type_json(
        handle_, utils::to_ref(snapshot), utils::to_ref(project)));
  }

  std::string get_type_at_position_json(
      std::string_view snapshot,
      std::string_view project,
      std::string_view file,
      std::uint32_t position) const {
    return utils::take_string(corsa_api_client_get_type_at_position_json(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(file),
        position));
  }

  std::string get_symbol_at_position_json(
      std::string_view snapshot,
      std::string_view project,
      std::string_view file,
      std::uint32_t position) const {
    return utils::take_string(corsa_api_client_get_symbol_at_position_json(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(file),
        position));
  }

  std::string get_type_arguments_json(
      std::string_view snapshot,
      std::string_view project,
      std::string_view type_handle,
      std::uint32_t object_flags = 0) const {
    return utils::take_string(corsa_api_client_get_type_arguments_json(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(type_handle),
        object_flags));
  }

  std::string get_type_of_symbol_json(
      std::string_view snapshot,
      std::string_view project,
      std::string_view symbol) const {
    return utils::take_string(corsa_api_client_get_type_of_symbol_json(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(symbol)));
  }

  std::string get_declared_type_of_symbol_json(
      std::string_view snapshot,
      std::string_view project,
      std::string_view symbol) const {
    return utils::take_string(corsa_api_client_get_declared_type_of_symbol_json(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(symbol)));
  }

  std::string type_to_string(
      std::string_view snapshot,
      std::string_view project,
      std::string_view type_handle,
      std::string_view location = {},
      std::int32_t flags = -1) const {
    return utils::take_string(corsa_api_client_type_to_string(
        handle_,
        utils::to_ref(snapshot),
        utils::to_ref(project),
        utils::to_ref(type_handle),
        utils::to_ref(location),
        flags));
  }

  std::string call_json(std::string_view method, std::string_view params_json = {}) const {
    return utils::take_string(corsa_api_client_call_json(
        handle_, utils::to_ref(method), utils::to_ref(params_json)));
  }

  std::optional<std::vector<std::uint8_t>> call_binary(
      std::string_view method,
      std::string_view params_json = {}) const {
    return utils::take_bytes(corsa_api_client_call_binary(
        handle_, utils::to_ref(method), utils::to_ref(params_json)));
  }

  bool release_handle(std::string_view handle) const {
    return corsa_api_client_release_handle(handle_, utils::to_ref(handle));
  }

  bool close() {
    if (handle_ == nullptr) {
      return true;
    }
    auto *handle = std::exchange(handle_, nullptr);
    const bool ok = corsa_api_client_close(handle);
    corsa_api_client_free(handle);
    return ok;
  }

  void reset() {
    if (handle_ != nullptr) {
      corsa_api_client_free(handle_);
      handle_ = nullptr;
    }
  }

 private:
  CorsaApiClient *handle_ = nullptr;
};

}  // namespace corsa::api
