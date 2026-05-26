use crate::{
    Result, TsgoError,
    fast::{CompactString, SmallVec},
};
use std::{
    ffi::OsStr,
    path::PathBuf,
    process::{Child, Stdio},
    sync::{Mutex, TryLockError},
    thread,
    time::{Duration, Instant},
};

/// Immutable process template for launching Corsa.
///
/// The command is cheap to clone and can be reused across multiple clients.
///
/// # Examples
///
/// ```
/// use std::path::PathBuf;
/// use corsa_core::TsgoCommand;
///
/// let command = TsgoCommand::new("/opt/bin/corsa")
///     .with_cwd("/workspace")
///     .with_env("TSGO_TRACE", "0");
///
/// assert_eq!(command.cwd(), &PathBuf::from("/workspace"));
/// ```
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct TsgoCommand {
    executable: PathBuf,
    cwd: PathBuf,
    env: SmallVec<[(CompactString, CompactString); 4]>,
}

impl TsgoCommand {
    /// Creates a new command template rooted at the current working directory.
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            env: SmallVec::new(),
        }
    }

    /// Returns a clone with a different working directory.
    pub fn with_cwd(mut self, cwd: impl Into<PathBuf>) -> Self {
        self.cwd = cwd.into();
        self
    }

    /// Returns a clone with an extra environment variable.
    pub fn with_env(
        mut self,
        key: impl Into<CompactString>,
        value: impl Into<CompactString>,
    ) -> Self {
        let key = key.into();
        let value = value.into();
        if let Some((_, entry)) = self.env.iter_mut().find(|(existing, _)| existing == key) {
            *entry = value;
        } else {
            self.env.push((key, value));
        }
        self
    }

    /// Returns the working directory used for child processes.
    pub fn cwd(&self) -> &PathBuf {
        &self.cwd
    }

    /// Returns the executable path used for child processes.
    pub fn executable(&self) -> &PathBuf {
        &self.executable
    }

    /// Spawns a child process with piped stdin/stdout for request/response flows.
    pub fn spawn_async<I, S>(&self, args: I) -> std::io::Result<Child>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.spawn(args)
    }

    /// Spawns a child process for blocking protocols such as the msgpack transport.
    pub fn spawn_blocking<I, S>(&self, args: I) -> std::io::Result<std::process::Child>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.spawn(args)
    }

    fn spawn<I, S>(&self, args: I) -> std::io::Result<std::process::Child>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut command = std::process::Command::new(&self.executable);
        command
            .args(args)
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .envs(
                self.env
                    .iter()
                    .map(|(key, value)| (key.as_str(), value.as_str())),
            );
        command.spawn()
    }
}

/// Owns a child process and guarantees it is eventually terminated.
///
/// This guard exists to keep long-running editors, tests, and benchmarks from
/// leaking Corsa subprocesses. Shutdown attempts a graceful wait first and
/// then forcefully kills and reaps the child when necessary.
#[derive(Debug)]
pub struct AsyncChildGuard {
    child: Mutex<Option<Child>>,
}

impl AsyncChildGuard {
    /// Wraps a running child process.
    pub fn new(child: Child) -> Self {
        Self {
            child: Mutex::new(Some(child)),
        }
    }

    /// Waits for graceful exit and force-kills the process when the deadline expires.
    ///
    /// The process is always reaped before this method returns successfully.
    pub async fn shutdown(&self, wait_for: Duration) -> Result<()> {
        let (mut child, poisoned) = match self.child.lock() {
            Ok(child) => (child, false),
            Err(poisoned) => (poisoned.into_inner(), true),
        };
        let Some(mut child) = child.take() else {
            return if poisoned {
                Err(process_guard_poisoned())
            } else {
                Ok(())
            };
        };
        wait_for_child_exit(&mut child, wait_for)?;
        if poisoned {
            return Err(process_guard_poisoned());
        }
        Ok(())
    }
}

impl Drop for AsyncChildGuard {
    fn drop(&mut self) {
        let mut child = match self.child.try_lock() {
            Ok(child) => child,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return,
        };
        if let Some(child) = child.as_mut() {
            let _ = terminate_child_process(child);
        }
    }
}

fn process_guard_poisoned() -> TsgoError {
    TsgoError::Join(CompactString::from("process guard lock poisoned"))
}

/// Waits for a child process to exit and forcefully terminates it after a timeout.
///
/// This helper is safe to use in cleanup code because it guarantees that a
/// killed child is reaped before returning.
pub fn wait_for_child_exit(child: &mut Child, wait_for: Duration) -> std::io::Result<()> {
    let deadline = Instant::now() + wait_for;
    loop {
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return terminate_child_process(child);
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// Terminates a child process if it is still running and always reaps it before returning.
///
/// Reaping matters just as much as killing: without the final `wait`, exited
/// children can remain as zombies on Unix-like systems.
pub fn terminate_child_process(child: &mut Child) -> std::io::Result<()> {
    if child.try_wait()?.is_some() {
        return Ok(());
    }
    match child.kill() {
        Ok(()) => {}
        Err(error) => {
            if child.try_wait()?.is_none() {
                return Err(error);
            }
            return Ok(());
        }
    }
    let _ = child.wait()?;
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::{terminate_child_process, wait_for_child_exit};
    use std::{process::Command, time::Duration};

    #[test]
    fn terminate_child_process_reaps_running_child() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 30")
            .spawn()
            .expect("spawn sleeper");
        terminate_child_process(&mut child).expect("terminate child");
        assert!(child.try_wait().expect("try_wait").is_some());
    }

    #[test]
    fn wait_for_child_exit_times_out_and_reaps() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 30")
            .spawn()
            .expect("spawn sleeper");
        wait_for_child_exit(&mut child, Duration::from_millis(10)).expect("wait with timeout");
        assert!(child.try_wait().expect("try_wait").is_some());
    }

    #[test]
    fn terminate_child_process_is_ok_after_natural_exit() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("exit 0")
            .spawn()
            .expect("spawn exiting child");
        let _ = child.wait().expect("wait");
        terminate_child_process(&mut child).expect("terminate exited child");
    }
}
