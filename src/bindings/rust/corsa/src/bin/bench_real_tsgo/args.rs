use std::{env, path::PathBuf};

use corsa::{
    api::ApiMode,
    fast::{CompactString, SmallVec},
};

const HELP: &str = "\
usage: cargo run -p corsa --bin bench_real_tsgo -- [options]

options:
  --tsgo PATH              tsgo executable (default: .cache/tsgo)
  --dataset PATH           tsconfig path to benchmark (repeatable)
  --json-output PATH       write machine-readable benchmark JSON
  --profile                enable detailed per-phase profiling output
  --transport TRANSPORT    jsonrpc | msgpack | both (default: both)
  --cold-iterations N      cold benchmark iterations (default: 5)
  --warm-iterations N      warm benchmark iterations (default: 20)
  --help                   show this message
";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RunMode {
    Benchmark,
    Profiling,
}

#[derive(Clone, Debug)]
pub struct Cli {
    pub root_dir: PathBuf,
    pub tsgo_path: PathBuf,
    pub dataset_paths: SmallVec<[PathBuf; 4]>,
    pub json_output_path: Option<PathBuf>,
    pub run_mode: RunMode,
    pub modes: SmallVec<[ApiMode; 2]>,
    pub cold_iterations: usize,
    pub warm_iterations: usize,
}

pub fn parse() -> Result<Option<Cli>, CompactString> {
    let root_dir = discover_root_dir()?;
    let mut tsgo_path = default_tsgo_path(&root_dir);
    let mut dataset_paths = SmallVec::<[PathBuf; 4]>::new();
    let mut json_output_path = None;
    let mut run_mode = RunMode::Benchmark;
    let mut modes = both_modes();
    let mut cold_iterations = 5_usize;
    let mut warm_iterations = 20_usize;
    let mut args = env::args_os().skip(1);
    while let Some(argument) = args.next() {
        let argument = CompactString::from(argument.to_string_lossy().as_ref());
        match argument.as_str() {
            "--help" | "-h" => {
                println!("{HELP}");
                return Ok(None);
            }
            "--tsgo" => {
                tsgo_path = read_path(&mut args, &argument, &root_dir)?;
            }
            "--dataset" => {
                dataset_paths.push(read_path(&mut args, &argument, &root_dir)?);
            }
            "--json-output" => {
                json_output_path = Some(read_path(&mut args, &argument, &root_dir)?);
            }
            "--profile" => {
                run_mode = RunMode::Profiling;
            }
            "--run-mode" => {
                run_mode = parse_run_mode(read_value(&mut args, &argument)?)?;
            }
            "--transport" | "--mode" => {
                modes = parse_transport(read_value(&mut args, &argument)?)?;
            }
            "--cold-iterations" => {
                cold_iterations = parse_usize(read_value(&mut args, &argument)?, &argument)?;
            }
            "--warm-iterations" => {
                warm_iterations = parse_usize(read_value(&mut args, &argument)?, &argument)?;
            }
            _ => {
                return Err(argument);
            }
        }
    }
    if dataset_paths.is_empty() {
        dataset_paths = default_datasets(&root_dir);
    }
    if dataset_paths.is_empty() {
        return Err(CompactString::from(
            "no datasets found; pass --dataset PATH explicitly",
        ));
    }
    if !tsgo_path.exists() {
        return Err(CompactString::from(tsgo_path.display().to_string()));
    }
    Ok(Some(Cli {
        root_dir,
        tsgo_path,
        dataset_paths,
        json_output_path,
        run_mode,
        modes,
        cold_iterations,
        warm_iterations,
    }))
}

fn discover_root_dir() -> Result<PathBuf, CompactString> {
    let cwd = env::current_dir().map_err(|error| CompactString::from(error.to_string()))?;
    for candidate in cwd.ancestors() {
        if candidate.join("pnpm-workspace.yaml").exists()
            && candidate.join("vite.config.ts").exists()
        {
            return Ok(candidate.to_path_buf());
        }
    }
    Ok(cwd)
}

fn both_modes() -> SmallVec<[ApiMode; 2]> {
    let mut modes = SmallVec::<[ApiMode; 2]>::new();
    modes.push(ApiMode::AsyncJsonRpcStdio);
    modes.push(ApiMode::SyncMsgpackStdio);
    modes
}

fn default_tsgo_path(root_dir: &std::path::Path) -> PathBuf {
    let candidates = [
        root_dir.join(".cache/tsgo"),
        root_dir.join(".cache/tsgo.exe"),
        root_dir.join("ref/typescript-go/.cache/tsgo"),
        root_dir.join("ref/typescript-go/.cache/tsgo.exe"),
        root_dir.join("origin/typescript-go/.cache/tsgo"),
        root_dir.join("origin/typescript-go/.cache/tsgo.exe"),
        root_dir.join("ref/typescript-go/built/local/tsgo"),
        root_dir.join("ref/typescript-go/built/local/tsgo.exe"),
        root_dir.join("origin/typescript-go/built/local/tsgo"),
        root_dir.join("origin/typescript-go/built/local/tsgo.exe"),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return candidate;
        }
    }
    root_dir.join(if cfg!(windows) {
        ".cache/tsgo.exe"
    } else {
        ".cache/tsgo"
    })
}

fn default_datasets(root_dir: &std::path::Path) -> SmallVec<[PathBuf; 4]> {
    let mut datasets = SmallVec::<[PathBuf; 4]>::new();
    for base in [
        root_dir.join("ref/typescript-go"),
        root_dir.join("origin/typescript-go"),
    ] {
        for path in [
            base.join("_packages/ast/tsconfig.json"),
            base.join("_packages/native-preview/tsconfig.json"),
            base.join("_packages/api/tsconfig.json"),
            base.join("_extension/tsconfig.json"),
        ] {
            if path.exists() {
                datasets.push(path);
            }
        }
        if !datasets.is_empty() {
            break;
        }
    }
    datasets
}

fn read_path(
    args: &mut impl Iterator<Item = std::ffi::OsString>,
    flag: &CompactString,
    root_dir: &std::path::Path,
) -> Result<PathBuf, CompactString> {
    let value = PathBuf::from(read_value(args, flag)?.as_str());
    if value.is_absolute() {
        Ok(value)
    } else {
        Ok(root_dir.join(value))
    }
}

fn read_value(
    args: &mut impl Iterator<Item = std::ffi::OsString>,
    flag: &CompactString,
) -> Result<CompactString, CompactString> {
    let Some(value) = args.next() else {
        return Err(CompactString::from(flag.as_str()));
    };
    Ok(CompactString::from(value.to_string_lossy().as_ref()))
}

fn parse_transport(value: CompactString) -> Result<SmallVec<[ApiMode; 2]>, CompactString> {
    match value.as_str() {
        "jsonrpc" => {
            let mut modes = SmallVec::<[ApiMode; 2]>::new();
            modes.push(ApiMode::AsyncJsonRpcStdio);
            Ok(modes)
        }
        "msgpack" => {
            let mut modes = SmallVec::<[ApiMode; 2]>::new();
            modes.push(ApiMode::SyncMsgpackStdio);
            Ok(modes)
        }
        "both" => Ok(both_modes()),
        _ => Err(value),
    }
}

fn parse_run_mode(value: CompactString) -> Result<RunMode, CompactString> {
    match value.as_str() {
        "benchmark" => Ok(RunMode::Benchmark),
        "profiling" => Ok(RunMode::Profiling),
        _ => Err(value),
    }
}

fn parse_usize(value: CompactString, _flag: &CompactString) -> Result<usize, CompactString> {
    value
        .parse::<usize>()
        .map_err(|_| CompactString::from(value.as_str()))
}

#[cfg(test)]
mod tests {
    use super::{RunMode, both_modes, parse_run_mode, parse_transport, parse_usize};
    use corsa::api::ApiMode;

    #[test]
    fn parse_transport_supports_both_variants() {
        assert_eq!(parse_transport("both".into()).unwrap(), both_modes());
        assert_eq!(
            parse_transport("jsonrpc".into()).unwrap().as_slice(),
            &[ApiMode::AsyncJsonRpcStdio]
        );
        assert_eq!(
            parse_transport("msgpack".into()).unwrap().as_slice(),
            &[ApiMode::SyncMsgpackStdio]
        );
    }

    #[test]
    fn parse_usize_rejects_invalid_numbers() {
        assert_eq!(parse_usize("42".into(), &"--n".into()).unwrap(), 42);
        assert!(parse_usize("nope".into(), &"--n".into()).is_err());
    }

    #[test]
    fn parse_run_mode_supports_profiling() {
        assert_eq!(
            parse_run_mode("benchmark".into()).unwrap(),
            RunMode::Benchmark
        );
        assert_eq!(
            parse_run_mode("profiling".into()).unwrap(),
            RunMode::Profiling
        );
        assert!(parse_run_mode("nope".into()).is_err());
    }
}
