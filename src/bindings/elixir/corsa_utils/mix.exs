defmodule CorsaUtils.MixProject do
  use Mix.Project

  @version "1.14.0"
  @source_url "https://github.com/ubugeeei-prod/corsa-bind"

  def project do
    [
      app: :corsa_utils,
      version: @version,
      elixir: "~> 1.16",
      description: "Elixir bindings for corsa-bind",
      package: package(),
      source_url: @source_url,
      start_permanent: Mix.env() == :prod,
      compilers: [:rustler] ++ Mix.compilers(),
      rustler_crates: [
        corsa_elixir: [
          path: "native/corsa_elixir",
          mode: rustler_mode(Mix.env())
        ]
      ],
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:jason, "~> 1.4"},
      {:rustler, "~> 0.37.3", runtime: false}
    ]
  end

  defp package do
    [
      licenses: ["MIT"],
      links: %{"GitHub" => @source_url},
      files: ["lib", "native/corsa_elixir", "mix.exs", "README.md", "LICENSE"]
    ]
  end

  defp rustler_mode(:prod), do: :release
  defp rustler_mode(_), do: :debug
end
