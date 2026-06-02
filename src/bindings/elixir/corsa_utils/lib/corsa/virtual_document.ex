defmodule Corsa.VirtualDocument do
  @moduledoc """
  In-memory virtual document used by the Corsa LSP surface.
  """

  alias Corsa.Native

  defstruct [:ref]

  @type t :: %__MODULE__{ref: reference()}

  @spec new(String.t(), String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def new(uri, language_id, text) do
    Native.virtual_document_new(uri, language_id, text)
    |> wrap_document()
  end

  @spec untitled(String.t(), String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def untitled(path, language_id, text) do
    Native.virtual_document_untitled(path, language_id, text)
    |> wrap_document()
  end

  @spec in_memory(String.t(), String.t(), String.t(), String.t()) :: {:ok, t()} | {:error, term()}
  def in_memory(authority, path, language_id, text) do
    Native.virtual_document_in_memory(authority, path, language_id, text)
    |> wrap_document()
  end

  @spec uri(t()) :: String.t()
  def uri(%__MODULE__{ref: ref}), do: Native.virtual_document_uri(ref)

  @spec language_id(t()) :: String.t()
  def language_id(%__MODULE__{ref: ref}), do: Native.virtual_document_language_id(ref)

  @spec text(t()) :: String.t()
  def text(%__MODULE__{ref: ref}), do: Native.virtual_document_text(ref)

  @spec key(t()) :: String.t()
  def key(%__MODULE__{ref: ref}), do: Native.virtual_document_key(ref)

  @spec version(t()) :: integer()
  def version(%__MODULE__{ref: ref}), do: Native.virtual_document_version(ref)

  @spec replace(t(), String.t()) :: :ok | {:error, term()}
  def replace(%__MODULE__{ref: ref}, text), do: Native.virtual_document_replace(ref, text)

  @spec splice(t(), non_neg_integer(), non_neg_integer(), non_neg_integer(), non_neg_integer(), String.t()) ::
          :ok | {:error, term()}
  def splice(%__MODULE__{ref: ref}, start_line, start_character, end_line, end_character, text) do
    Native.virtual_document_splice(ref, start_line, start_character, end_line, end_character, text)
  end

  defp wrap_document({:error, _reason} = error), do: error
  defp wrap_document(ref), do: {:ok, %__MODULE__{ref: ref}}
end
