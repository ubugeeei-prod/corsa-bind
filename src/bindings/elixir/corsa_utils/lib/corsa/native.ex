defmodule Corsa.Native do
  @moduledoc false

  use Rustler, otp_app: :corsa_utils, crate: "corsa_elixir"

  def classify_type_text(_text), do: :erlang.nif_error(:nif_not_loaded)
  def split_top_level_type_text(_text, _delimiter), do: :erlang.nif_error(:nif_not_loaded)
  def split_type_text(_text), do: :erlang.nif_error(:nif_not_loaded)

  def is_string_like_type_texts(_type_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_number_like_type_texts(_type_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_bigint_like_type_texts(_type_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_any_like_type_texts(_type_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_unknown_like_type_texts(_type_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_array_like_type_texts(_type_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_promise_like_type_texts(_type_texts, _property_names), do: :erlang.nif_error(:nif_not_loaded)
  def is_error_like_type_texts(_type_texts, _property_names), do: :erlang.nif_error(:nif_not_loaded)
  def has_unsafe_any_flow(_source_texts, _target_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_unsafe_assignment(_source_texts, _target_texts), do: :erlang.nif_error(:nif_not_loaded)
  def is_unsafe_return(_source_texts, _target_texts), do: :erlang.nif_error(:nif_not_loaded)

  def virtual_document_new(_uri, _language_id, _text), do: :erlang.nif_error(:nif_not_loaded)
  def virtual_document_untitled(_path, _language_id, _text), do: :erlang.nif_error(:nif_not_loaded)

  def virtual_document_in_memory(_authority, _path, _language_id, _text),
    do: :erlang.nif_error(:nif_not_loaded)

  def virtual_document_uri(_document), do: :erlang.nif_error(:nif_not_loaded)
  def virtual_document_language_id(_document), do: :erlang.nif_error(:nif_not_loaded)
  def virtual_document_text(_document), do: :erlang.nif_error(:nif_not_loaded)
  def virtual_document_key(_document), do: :erlang.nif_error(:nif_not_loaded)
  def virtual_document_version(_document), do: :erlang.nif_error(:nif_not_loaded)
  def virtual_document_replace(_document, _text), do: :erlang.nif_error(:nif_not_loaded)

  def virtual_document_splice(
        _document,
        _start_line,
        _start_character,
        _end_line,
        _end_character,
        _text
      ),
      do: :erlang.nif_error(:nif_not_loaded)

  def api_client_spawn(_options_json), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_initialize_json(_client), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_parse_config_file_json(_client, _file), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_update_snapshot_json(_client, _params_json), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_get_source_file(_client, _snapshot, _project, _file), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_get_string_type_json(_client, _snapshot, _project), do: :erlang.nif_error(:nif_not_loaded)

  def api_client_get_type_at_position_json(_client, _snapshot, _project, _file, _position),
    do: :erlang.nif_error(:nif_not_loaded)

  def api_client_get_symbol_at_position_json(_client, _snapshot, _project, _file, _position),
    do: :erlang.nif_error(:nif_not_loaded)

  def api_client_get_type_arguments_json(_client, _snapshot, _project, _type_handle, _object_flags),
    do: :erlang.nif_error(:nif_not_loaded)

  def api_client_get_type_of_symbol_json(_client, _snapshot, _project, _symbol),
    do: :erlang.nif_error(:nif_not_loaded)

  def api_client_get_declared_type_of_symbol_json(_client, _snapshot, _project, _symbol),
    do: :erlang.nif_error(:nif_not_loaded)

  def api_client_type_to_string(_client, _snapshot, _project, _type_handle, _location, _flags),
    do: :erlang.nif_error(:nif_not_loaded)

  def api_client_call_json(_client, _method, _params_json), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_call_binary(_client, _method, _params_json), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_release_handle(_client, _handle), do: :erlang.nif_error(:nif_not_loaded)
  def api_client_close(_client), do: :erlang.nif_error(:nif_not_loaded)
end
