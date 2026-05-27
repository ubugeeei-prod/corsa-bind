use std::{env, path::PathBuf, process::ExitCode};

use corsa_core::fast::{CompactString, SmallVec, compact_format};
use corsa_ref::CorsaRefManager;

const HELP: &str = "\
usage: corsa_ref [status|verify|sync|pin-current] [LOCKFILE]

commands:
  status        print the current managed-ref status
  verify        fail when the managed ref drifts from the lockfile (default)
  sync          clone/fetch/switch the managed ref to the lockfile pin
  pin-current   rewrite the lockfile from the current managed ref
";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{}", err.diagnostic());
            ExitCode::FAILURE
        }
    }
}

fn run() -> corsa_core::Result<()> {
    let args = env::args()
        .skip(1)
        .map(CompactString::from)
        .collect::<SmallVec<[CompactString; 4]>>();
    let command = args.first().map(CompactString::as_str).unwrap_or("verify");
    if matches!(command, "--help" | "-h" | "help") {
        println!("{HELP}");
        return Ok(());
    }
    let lock_path = args
        .get(1)
        .map(|path| PathBuf::from(path.as_str()))
        .unwrap_or_else(|| PathBuf::from("corsa_ref.lock.toml"));
    let manager = CorsaRefManager::new(lock_path);
    match command {
        "status" => {
            let status = manager.status()?;
            println!("{}", status.describe());
            Ok(())
        }
        "verify" => manager.verify(),
        "sync" => manager.sync(),
        "pin-current" => manager.pin_current(),
        other => Err(corsa_core::CorsaError::Protocol(compact_format(
            format_args!(
                "unknown corsa_ref command: {other}\nhelp: valid commands are status, verify, sync, and pin-current"
            ),
        ))),
    }
}
