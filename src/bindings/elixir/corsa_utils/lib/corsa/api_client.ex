defmodule Corsa.ApiClient do
  @moduledoc """
  Corsa checker API client.

  The client talks to a caller-provided Corsa executable. Functions return
  `{:ok, value}` or `{:error, reason}` unless explicitly documented otherwise.
  """

  alias Corsa.Native

  defstruct [:ref]

  @type t :: %__MODULE__{ref: reference()}

  @spawn_option_keys %{
    executable: "executable",
    cwd: "cwd",
    mode: "mode",
    request_timeout_ms: "requestTimeoutMs",
    shutdown_timeout_ms: "shutdownTimeoutMs",
    outbound_capacity: "outboundCapacity",
    allow_unstable_upstream_calls: "allowUnstableUpstreamCalls"
  }

  @spec spawn(map() | String.t()) :: {:ok, t()} | {:error, term()}
  def spawn(options) when is_map(options) do
    with {:ok, json} <- encode_spawn_options(options) do
      spawn_json(json)
    end
  end

  def spawn(options_json) when is_binary(options_json), do: spawn_json(options_json)

  @spec spawn_json(String.t()) :: {:ok, t()} | {:error, term()}
  def spawn_json(options_json) do
    case Native.api_client_spawn(options_json) do
      {:error, _reason} = error -> error
      ref -> {:ok, %__MODULE__{ref: ref}}
    end
  end

  @spec initialize(t()) :: {:ok, map()} | {:error, term()}
  def initialize(client), do: decode_json_result(initialize_json(client))

  @spec initialize_json(t()) :: {:ok, String.t()} | {:error, term()}
  def initialize_json(%__MODULE__{ref: ref}), do: wrap_result(Native.api_client_initialize_json(ref))

  @spec parse_config_file(t(), String.t()) :: {:ok, map()} | {:error, term()}
  def parse_config_file(client, file), do: decode_json_result(parse_config_file_json(client, file))

  @spec parse_config_file_json(t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def parse_config_file_json(%__MODULE__{ref: ref}, file) do
    wrap_result(Native.api_client_parse_config_file_json(ref, file))
  end

  @spec update_snapshot(t(), map() | nil) :: {:ok, map()} | {:error, term()}
  def update_snapshot(client, params \\ nil), do: decode_json_result(update_snapshot_json(client, params))

  @spec update_snapshot_json(t(), map() | String.t() | nil) :: {:ok, String.t()} | {:error, term()}
  def update_snapshot_json(%__MODULE__{ref: ref}, params \\ nil) do
    with {:ok, params_json} <- encode_optional_json(params) do
      wrap_result(Native.api_client_update_snapshot_json(ref, params_json))
    end
  end

  @spec get_source_file(t(), String.t(), String.t(), String.t()) ::
          {:ok, binary() | nil} | {:error, term()}
  def get_source_file(%__MODULE__{ref: ref}, snapshot, project, file) do
    wrap_result(Native.api_client_get_source_file(ref, snapshot, project, file))
  end

  @spec get_string_type(t(), String.t(), String.t()) :: {:ok, map()} | {:error, term()}
  def get_string_type(client, snapshot, project) do
    decode_json_result(get_string_type_json(client, snapshot, project))
  end

  @spec get_string_type_json(t(), String.t(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def get_string_type_json(%__MODULE__{ref: ref}, snapshot, project) do
    wrap_result(Native.api_client_get_string_type_json(ref, snapshot, project))
  end

  @spec get_type_at_position(t(), String.t(), String.t(), String.t(), non_neg_integer()) ::
          {:ok, map()} | {:error, term()}
  def get_type_at_position(client, snapshot, project, file, position) do
    decode_json_result(get_type_at_position_json(client, snapshot, project, file, position))
  end

  @spec get_type_at_position_json(t(), String.t(), String.t(), String.t(), non_neg_integer()) ::
          {:ok, String.t()} | {:error, term()}
  def get_type_at_position_json(%__MODULE__{ref: ref}, snapshot, project, file, position) do
    wrap_result(Native.api_client_get_type_at_position_json(ref, snapshot, project, file, position))
  end

  @spec get_symbol_at_position(t(), String.t(), String.t(), String.t(), non_neg_integer()) ::
          {:ok, map()} | {:error, term()}
  def get_symbol_at_position(client, snapshot, project, file, position) do
    decode_json_result(get_symbol_at_position_json(client, snapshot, project, file, position))
  end

  @spec get_symbol_at_position_json(t(), String.t(), String.t(), String.t(), non_neg_integer()) ::
          {:ok, String.t()} | {:error, term()}
  def get_symbol_at_position_json(%__MODULE__{ref: ref}, snapshot, project, file, position) do
    wrap_result(Native.api_client_get_symbol_at_position_json(ref, snapshot, project, file, position))
  end

  @spec get_type_arguments(t(), String.t(), String.t(), String.t(), non_neg_integer()) ::
          {:ok, list()} | {:error, term()}
  def get_type_arguments(client, snapshot, project, type_handle, object_flags) do
    decode_json_result(get_type_arguments_json(client, snapshot, project, type_handle, object_flags))
  end

  @spec get_type_arguments_json(t(), String.t(), String.t(), String.t(), non_neg_integer()) ::
          {:ok, String.t()} | {:error, term()}
  def get_type_arguments_json(%__MODULE__{ref: ref}, snapshot, project, type_handle, object_flags) do
    wrap_result(
      Native.api_client_get_type_arguments_json(ref, snapshot, project, type_handle, object_flags)
    )
  end

  @spec get_type_of_symbol(t(), String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, term()}
  def get_type_of_symbol(client, snapshot, project, symbol) do
    decode_json_result(get_type_of_symbol_json(client, snapshot, project, symbol))
  end

  @spec get_type_of_symbol_json(t(), String.t(), String.t(), String.t()) ::
          {:ok, String.t()} | {:error, term()}
  def get_type_of_symbol_json(%__MODULE__{ref: ref}, snapshot, project, symbol) do
    wrap_result(Native.api_client_get_type_of_symbol_json(ref, snapshot, project, symbol))
  end

  @spec get_declared_type_of_symbol(t(), String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, term()}
  def get_declared_type_of_symbol(client, snapshot, project, symbol) do
    decode_json_result(get_declared_type_of_symbol_json(client, snapshot, project, symbol))
  end

  @spec get_declared_type_of_symbol_json(t(), String.t(), String.t(), String.t()) ::
          {:ok, String.t()} | {:error, term()}
  def get_declared_type_of_symbol_json(%__MODULE__{ref: ref}, snapshot, project, symbol) do
    wrap_result(Native.api_client_get_declared_type_of_symbol_json(ref, snapshot, project, symbol))
  end

  @spec type_to_string(t(), String.t(), String.t(), String.t(), String.t() | nil, integer() | nil) ::
          {:ok, String.t()} | {:error, term()}
  def type_to_string(%__MODULE__{ref: ref}, snapshot, project, type_handle, location \\ nil, flags \\ nil) do
    wrap_result(
      Native.api_client_type_to_string(
        ref,
        snapshot,
        project,
        type_handle,
        location || "",
        flags || -1
      )
    )
  end

  @spec call(t(), String.t(), map() | list() | nil) :: {:ok, term()} | {:error, term()}
  def call(client, method, params \\ nil), do: decode_json_result(call_json(client, method, params))

  @spec call_json(t(), String.t(), map() | list() | String.t() | nil) ::
          {:ok, String.t()} | {:error, term()}
  def call_json(%__MODULE__{ref: ref}, method, params \\ nil) do
    with {:ok, params_json} <- encode_optional_json(params) do
      wrap_result(Native.api_client_call_json(ref, method, params_json))
    end
  end

  @spec call_binary(t(), String.t(), map() | list() | String.t() | nil) ::
          {:ok, binary() | nil} | {:error, term()}
  def call_binary(%__MODULE__{ref: ref}, method, params \\ nil) do
    with {:ok, params_json} <- encode_optional_json(params) do
      wrap_result(Native.api_client_call_binary(ref, method, params_json))
    end
  end

  @spec release_handle(t(), String.t()) :: :ok | {:error, term()}
  def release_handle(%__MODULE__{ref: ref}, handle), do: Native.api_client_release_handle(ref, handle)

  @spec close(t()) :: :ok | {:error, term()}
  def close(%__MODULE__{ref: ref}), do: Native.api_client_close(ref)

  defp encode_spawn_options(options) do
    options
    |> Enum.into(%{}, fn
      {key, value} when is_atom(key) -> {Map.get(@spawn_option_keys, key, Atom.to_string(key)), value}
      {key, value} -> {key, value}
    end)
    |> Jason.encode()
  end

  defp encode_optional_json(nil), do: {:ok, ""}
  defp encode_optional_json(value) when is_binary(value), do: {:ok, value}
  defp encode_optional_json(value), do: Jason.encode(value)

  defp decode_json_result({:ok, json}), do: Jason.decode(json)
  defp decode_json_result({:error, _reason} = error), do: error

  defp wrap_result({:error, _reason} = error), do: error
  defp wrap_result(value), do: {:ok, value}
end
