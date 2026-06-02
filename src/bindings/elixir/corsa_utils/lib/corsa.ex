defmodule Corsa do
  @moduledoc """
  Elixir binding for `corsa-bind`.

  Pure utility functions are available directly from this module. Stateful
  surfaces live under `Corsa.VirtualDocument` and `Corsa.ApiClient`.
  """

  alias Corsa.Native

  defdelegate classify_type_text(text), to: Native
  defdelegate split_type_text(text), to: Native

  def split_top_level_type_text(text, delimiter) when is_integer(delimiter) do
    Native.split_top_level_type_text(text, delimiter)
  end

  def split_top_level_type_text(text, delimiter) when is_binary(delimiter) do
    case String.to_charlist(delimiter) do
      [codepoint] -> Native.split_top_level_type_text(text, codepoint)
      _ -> raise ArgumentError, "delimiter must contain exactly one codepoint"
    end
  end

  defdelegate is_string_like_type_texts(type_texts), to: Native
  defdelegate is_number_like_type_texts(type_texts), to: Native
  defdelegate is_bigint_like_type_texts(type_texts), to: Native
  defdelegate is_any_like_type_texts(type_texts), to: Native
  defdelegate is_unknown_like_type_texts(type_texts), to: Native
  defdelegate is_array_like_type_texts(type_texts), to: Native
  defdelegate is_promise_like_type_texts(type_texts, property_names), to: Native
  defdelegate is_error_like_type_texts(type_texts, property_names), to: Native
  defdelegate has_unsafe_any_flow(source_texts, target_texts), to: Native
  defdelegate is_unsafe_assignment(source_texts, target_texts), to: Native
  defdelegate is_unsafe_return(source_texts, target_texts), to: Native
end
