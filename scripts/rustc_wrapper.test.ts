import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrapperPath = "scripts/rustc_wrapper.sh";
const enablePath = ".github/actions/rust-parallel-frontend/enable.sh";

const scratchDirs: string[] = [];
afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function scratch(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  scratchDirs.push(dir);
  return dir;
}

function executable(file: string, source: string): string {
  fs.writeFileSync(file, source);
  fs.chmodSync(file, 0o755);
  return file;
}

// A copy of the wrapper inside a scratch workspace, a fake compiler that
// reports what it received, and a fake kache that forwards to it.
function scratchWorkspace() {
  const root = scratch("corsa-rustc-wrapper-");
  const wrapper = path.join(root, wrapperPath);
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, wrapperPath), wrapper);
  fs.chmodSync(wrapper, 0o755);
  const rustc = executable(
    path.join(root, "fake-rustc"),
    '#!/bin/sh\nprintf "bootstrap=%s\\n" "${RUSTC_BOOTSTRAP:-}"\nprintf "%s\\n" "$@"\n',
  );
  const kache = executable(path.join(root, "fake-kache"), '#!/bin/sh\necho via-kache\nexec "$@"\n');
  return { root, wrapper, rustc, kache };
}

function run(
  workspace: ReturnType<typeof scratchWorkspace>,
  args: string[],
  env: Record<string, string>,
): string[] {
  return execFileSync(workspace.wrapper, [workspace.rustc, ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
  })
    .trimEnd()
    .split("\n");
}

describe.skipIf(process.platform === "win32")("rustc wrapper", () => {
  it("adds the parallel frontend to workspace crates only", () => {
    const workspace = scratchWorkspace();
    const member = path.join(workspace.root, "src/core/corsa_client");
    const crate = ["--crate-name", "corsa_client", "--edition=2021", "src/lib.rs"];
    const frontend = { CORSA_RUSTC_FRONTEND_JOBS: "8" };

    expect(
      run(workspace, crate, {
        ...frontend,
        CARGO_MANIFEST_DIR: member,
        CARGO_CRATE_NAME: "corsa_client",
      }),
    ).toEqual(["bootstrap=corsa_client", ...crate, "-Zthreads=8"]);

    // A registry dependency compiles exactly as Cargo asked.
    const dependency = ["--crate-name", "proc_macro2", "src/lib.rs"];
    expect(
      run(workspace, dependency, {
        ...frontend,
        CARGO_MANIFEST_DIR: "/home/runner/.cargo/registry/src/proc-macro2-1.0.107",
        CARGO_CRATE_NAME: "proc_macro2",
      }),
    ).toEqual(["bootstrap=", ...dependency]);

    // A sibling checkout whose path extends the workspace's is not a member.
    expect(
      run(workspace, crate, {
        ...frontend,
        CARGO_MANIFEST_DIR: `${workspace.root}-base/src/core/corsa_client`,
        CARGO_CRATE_NAME: "corsa_client",
      }),
    ).toEqual(["bootstrap=", ...crate]);

    // A build-script probe inherits the member's environment but names another
    // crate: unstable features must stay unavailable to it.
    const probe = ["--crate-name", "probe", "--crate-type=lib", "-"];
    expect(
      run(workspace, probe, {
        ...frontend,
        CARGO_MANIFEST_DIR: member,
        CARGO_CRATE_NAME: "build_script_build",
      }),
    ).toEqual(["bootstrap=", ...probe]);

    // Cargo's version and target queries pass through.
    expect(run(workspace, ["-vV"], { ...frontend, CARGO_MANIFEST_DIR: member })).toEqual([
      "bootstrap=",
      "-vV",
    ]);

    for (const jobs of ["1", "0", ""]) {
      expect(
        run(workspace, crate, {
          CORSA_RUSTC_FRONTEND_JOBS: jobs,
          CARGO_MANIFEST_DIR: member,
          CARGO_CRATE_NAME: "corsa_client",
        }),
      ).toEqual(["bootstrap=", ...crate]);
    }
  });

  it("hands every call to kache when the shell provides it", () => {
    const workspace = scratchWorkspace();
    const member = path.join(workspace.root, "src/core/corsa_client");
    const crate = ["--crate-name", "corsa_client", "src/lib.rs"];

    expect(
      run(workspace, crate, {
        CORSA_KACHE: workspace.kache,
        CORSA_RUSTC_FRONTEND_JOBS: "4",
        CARGO_MANIFEST_DIR: member,
        CARGO_CRATE_NAME: "corsa_client",
      }),
    ).toEqual(["via-kache", "bootstrap=corsa_client", ...crate, "-Zthreads=4"]);
    expect(run(workspace, ["-vV"], { CORSA_KACHE: workspace.kache })).toEqual([
      "via-kache",
      "bootstrap=",
      "-vV",
    ]);
    expect(run(workspace, ["-vV"], { CORSA_KACHE: "" })).toEqual(["bootstrap=", "-vV"]);
  });

  it("is exported by Rust CI jobs unless the job already chose a wrapper", () => {
    const dir = scratch("corsa-frontend-env-");
    let count = 0;
    const enable = (env: Record<string, string>) => {
      const githubEnv = path.join(dir, `env-${count++}`);
      fs.writeFileSync(githubEnv, "");
      execFileSync("bash", [path.join(repoRoot, enablePath)], {
        env: { PATH: process.env.PATH, GITHUB_WORKSPACE: repoRoot, GITHUB_ENV: githubEnv, ...env },
        stdio: "ignore",
      });
      return fs.readFileSync(githubEnv, "utf8");
    };

    expect(enable({ CORSA_RUSTC_FRONTEND_JOBS: "8" })).toBe(
      `RUSTC_WRAPPER=${path.join(repoRoot, wrapperPath)}\nCORSA_RUSTC_FRONTEND_JOBS=8\n`,
    );
    expect(enable({ CORSA_RUSTC_FRONTEND_JOBS: "8", RUSTC_WRAPPER: "sccache" })).toBe("");
    expect(enable({ CORSA_RUSTC_FRONTEND_JOBS: "8", GITHUB_WORKSPACE: dir })).toBe("");
    for (const jobs of ["", "0", "8 -Zother"]) {
      expect(() => enable({ CORSA_RUSTC_FRONTEND_JOBS: jobs })).toThrow();
    }
  });
});

describe("rustc wrapper wiring", () => {
  const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

  it("routes the dev shell through the wrapper and kache", () => {
    const flake = read("nix/flake-outputs.nix");
    expect(flake).toContain('"" | */scripts/rustc_wrapper.sh)');
    expect(flake).toContain("export CORSA_KACHE=\"''${CORSA_KACHE-${kachePkg}/bin/kache}\"");
    expect(flake).toContain(
      "export CORSA_RUSTC_FRONTEND_JOBS=\"''${CORSA_RUSTC_FRONTEND_JOBS:-8}\"",
    );
  });

  it("opts the Rust CI jobs in, and leaves release and benchmark workflows alone", () => {
    const action = read(".github/actions/rust-parallel-frontend/action.yml");
    expect(action).toContain("runner.os != 'Windows' && inputs.jobs != '1'");

    const ci = read(".github/workflows/ci.yml");
    const uses = ci.match(/uses: \.\/\.github\/actions\/rust-parallel-frontend/gu) ?? [];
    // rust-lint, build, test, public-facade, non-node-bindings, real-corsa-smoke
    expect(uses).toHaveLength(6);

    for (const workflow of fs.readdirSync(path.join(repoRoot, ".github/workflows"))) {
      if (workflow === "ci.yml") continue;
      expect(read(`.github/workflows/${workflow}`), workflow).not.toContain(
        "rust-parallel-frontend",
      );
    }
  });
});
