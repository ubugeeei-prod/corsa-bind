defmodule CorsaUtilsTest do
  use ExUnit.Case, async: true

  test "classifies and splits type text" do
    assert Corsa.classify_type_text("string[]") == "array"
    assert Corsa.split_type_text("string | number") == ["string", "number"]
    assert Corsa.split_top_level_type_text("Map<string, number>, Set<string>", ",") == [
             "Map<string, number>",
             "Set<string>"
           ]
  end

  test "checks type predicates" do
    assert Corsa.is_string_like_type_texts(["string"])
    refute Corsa.is_number_like_type_texts(["string"])
    assert Corsa.is_unsafe_assignment(["any"], ["string"])
  end

  test "edits a virtual document" do
    assert {:ok, document} =
             Corsa.VirtualDocument.untitled("/virtual/demo.ts", "typescript", "const value = 1;")

    assert Corsa.VirtualDocument.text(document) == "const value = 1;"
    assert Corsa.VirtualDocument.version(document) == 0

    assert :ok = Corsa.VirtualDocument.replace(document, "const value = 2;")

    assert Corsa.VirtualDocument.text(document) == "const value = 2;"
    assert Corsa.VirtualDocument.version(document) == 1
  end
end
