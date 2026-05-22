{ self, nixpkgs, tnix }:
let
  lib = nixpkgs.lib;
  systems = [ "aarch64-darwin" ];
  forAllSystems = lib.genAttrs systems;
in
{
  packages = forAllSystems (system:
    let
      pkgs = import nixpkgs { inherit system; };
      nodejsForVp = pkgs.nodejs_24;
      pnpmForVp = pkgs.pnpm_10;
      vitePlusVersion = "0.1.14";
      vitePlusRuntimeSrc = ./vite-plus;
      moonbit =
        pkgs.stdenvNoCC.mkDerivation {
          pname = "moonbit";
          version = "latest";
          src = pkgs.fetchzip {
            url = "https://cli.moonbitlang.com/binaries/latest/moonbit-darwin-aarch64.tar.gz";
            sha256 = "sha256-iYuvOpa4DK08AZQ5H3FM10W+SQWD6tb9S8UbQqd0ciY=";
            stripRoot = false;
          };
          dontBuild = true;
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -R bin include lib CREDITS.md $out/
            runHook postInstall
          '';
        };
      vitePlusRuntimePnpmDeps = pkgs.fetchPnpmDeps {
        pname = "vite-plus-runtime";
        version = vitePlusVersion;
        src = vitePlusRuntimeSrc;
        pnpm = pnpmForVp;
        fetcherVersion = 3;
        hash = "sha256-Ov4jbNVpNL1FH6wo4XDEJwdUQeo/pPn4BQaW77nRIRQ=";
      };
      vitePlusRuntime = pkgs.stdenvNoCC.mkDerivation {
        pname = "vite-plus-runtime";
        version = vitePlusVersion;
        src = vitePlusRuntimeSrc;
        nativeBuildInputs = [
          nodejsForVp
          pkgs.pnpmConfigHook
          pnpmForVp
        ];
        pnpmDeps = vitePlusRuntimePnpmDeps;
        dontBuild = true;
        installPhase = ''
          runHook preInstall

          mkdir -p $out
          cp package.json pnpm-lock.yaml $out/
          cp -R node_modules $out/

          runHook postInstall
        '';
      };
      vitePlusCli = pkgs.fetchzip {
        url = "https://registry.npmjs.org/@voidzero-dev/vite-plus-cli-darwin-arm64/-/vite-plus-cli-darwin-arm64-0.1.14.tgz";
        sha256 = "sha256-ymBoXwCB/pmL0Jn29Mo4TOrc+afWaGIeNw06xdbsYrM=";
        stripRoot = false;
      };
      vitePlus = pkgs.stdenvNoCC.mkDerivation {
        pname = "vite-plus";
        version = vitePlusVersion;
        dontUnpack = true;
        nativeBuildInputs = [ pkgs.makeWrapper ];
        installPhase = ''
          runHook preInstall

          mkdir -p $out/current/bin
          cp ${vitePlusCli}/package/vp $out/current/bin/vp
          chmod +x $out/current/bin/vp
          cp ${vitePlusRuntime}/package.json $out/current/
          cp ${vitePlusRuntime}/pnpm-lock.yaml $out/current/
          cp -R ${vitePlusRuntime}/node_modules $out/current/

          mkdir -p $out/bin
          ln -s ../current/bin/vp $out/bin/vp
          makeWrapper ${nodejsForVp}/bin/node $out/bin/oxfmt \
            --add-flags $out/current/node_modules/vite-plus/bin/oxfmt
          makeWrapper ${nodejsForVp}/bin/node $out/bin/oxlint \
            --add-flags $out/current/node_modules/vite-plus/bin/oxlint

          runHook postInstall
        '';
      };
    in
    {
      default = vitePlus;
      moonbit = moonbit;
      vite-plus = vitePlus;
    });

  devShells = forAllSystems (system:
    let
      pkgs = import nixpkgs { inherit system; };
      vitePlus = self.packages.${system}.vite-plus;
      moonPkg = self.packages.${system}.moonbit;
      swiftPkg = pkgs.swift;
      dotnetPkg = pkgs.dotnet-sdk_9;
      tnixCli = tnix.packages.${system}.tnix;
      tnixLsp = tnix.packages.${system}.tnix-lsp;
      libraryPath = lib.makeLibraryPath [
        pkgs.libiconv
      ];
      toolchainPath = lib.makeBinPath [
        pkgs.cargo
        pkgs.clang
        pkgs.clippy
        dotnetPkg
        pkgs.git
        pkgs.go_1_26
        pkgs.gnugrep
        moonPkg
        pkgs.pkg-config
        pkgs.rustc
        pkgs.rustfmt
        swiftPkg
        tnixCli
        tnixLsp
        pkgs.zig
      ];
    in
    {
      default = pkgs.mkShell {
        packages = [
          vitePlus
          pkgs.cargo
          pkgs.clang
          pkgs.clippy
          dotnetPkg
          pkgs.git
          pkgs.go_1_26
          pkgs.gnugrep
          pkgs.libiconv
          moonPkg
          pkgs.pkg-config
          pkgs.rustc
          pkgs.rustfmt
          swiftPkg
          tnixCli
          tnixLsp
          pkgs.zig
        ];

        shellHook = ''
          export PATH="${toolchainPath}:$PATH"
          export VITE_PLUS_HOME="''${VITE_PLUS_HOME:-$HOME/.vite-plus}"
          ${vitePlus}/bin/vp env use --unset >/dev/null 2>&1 || true
          ${vitePlus}/bin/vp env install >/dev/null
          eval "$(${vitePlus}/bin/vp env print | ${pkgs.gnugrep}/bin/grep '^export PATH=')"
          export PATH="${toolchainPath}:$PATH"
          export LIBRARY_PATH="${libraryPath}:''${LIBRARY_PATH:-}"
          export NIX_LDFLAGS="-L${libraryPath} ''${NIX_LDFLAGS:-}"
          corepack enable >/dev/null 2>&1 || true
          corepack prepare pnpm@10.0.0 --activate >/dev/null 2>&1 || true

          echo "corsa-bind dev shell ready."
          echo "Node and pnpm are provided by Vite+."
          echo "tnix source-of-truth: ./flake.tnix"
        '';
      };
    });
}
