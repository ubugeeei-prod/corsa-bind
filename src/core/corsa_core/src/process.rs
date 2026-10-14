use crate::process_receipt::{ProcessObservation, ProcessObserver, ProcessTermination};
use crate::{
    CorsaError, Result,
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
/// use corsa_core::CorsaCommand;
///
/// let command = CorsaCommand::new("/opt/bin/corsa")
///     .with_cwd("/workspace")
///     .with_env("CORSA_TRACE", "0");
///
/// assert_eq!(command.cwd(), &PathBuf::from("/workspace"));
/// ```
#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct CorsaCommand {
    executable: PathBuf,
    cwd: PathBuf,
    env: SmallVec<[(CompactString, CompactString); 4]>,
    process_observer: Option<ProcessObserver>,
}

impl CorsaCommand {
    /// Creates a new command template rooted at the current working directory.
    pub fn new(executable: impl Into<PathBuf>) -> Self {
        Self {
            executable: executable.into(),
            cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
            env: SmallVec::new(),
            process_observer: None,
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

    /// Captures full stderr and terminal custody for explicitly observed spawns.
    /// Existing unobserved spawn methods keep inherited stderr.
    pub fn with_process_observer(mut self, observer: ProcessObserver) -> Self {
        self.process_observer = Some(observer);
        self
    }

    /// Bind an opt-in observation directly to the actual child and its guard.
    pub fn spawn_observed_async<I, S>(
        &self,
        args: I,
    ) -> std::io::Result<(Child, Option<ProcessObservation>)>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let mut child = self.spawn_with_stderr(args, self.process_observer.is_some())?;
        let observation = if let Some(observer) = &self.process_observer {
            let Some(stderr) = child.stderr.take() else {
                let _ = terminate_child_process(&mut child);
                return Err(std::io::Error::other("missing stderr"));
            };
            match observer.start(child.id(), stderr) {
                Ok(observation) => Some(observation),
                Err(error) => {
                    let _ = terminate_child_process(&mut child);
                    return Err(error);
                }
            }
        } else {
            None
        };
        Ok((child, observation))
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
        self.spawn_with_stderr(args, false)
    }

    fn spawn_with_stderr<I, S>(&self, args: I, capture: bool) -> std::io::Result<Child>
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
            .stderr(if capture {
                Stdio::piped()
            } else {
                Stdio::inherit()
            })
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
    observation: Mutex<Option<ProcessObservation>>,
}

impl AsyncChildGuard {
    /// Wraps a running child process.
    pub fn new(child: Child) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            observation: Mutex::new(None),
        }
    }

    /// Owns the observation returned alongside this exact child.
    pub fn new_observed(child: Child, observation: Option<ProcessObservation>) -> Self {
        Self {
            child: Mutex::new(Some(child)),
            observation: Mutex::new(observation),
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
        let terminal = wait_for_child_exit_receipt(&mut child, wait_for);
        if let Some(observation) = self
            .observation
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            observation.finish(child.id(), terminal, wait_for)?;
        } else {
            terminal?;
        }
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
            let terminal = terminate_child_process_receipt(child, false);
            if let Some(observation) = self
                .observation
                .get_mut()
                .unwrap_or_else(|e| e.into_inner())
                .take()
            {
                let _ = observation.finish(child.id(), terminal, Duration::from_secs(2));
            }
        }
    }
}

fn process_guard_poisoned() -> CorsaError {
    CorsaError::Join(CompactString::from("process guard lock poisoned"))
}

/// Waits for a child process to exit and forcefully terminates it after a timeout.
///
/// This helper is safe to use in cleanup code because it guarantees that a
/// killed child is reaped before returning.
pub fn wait_for_child_exit(child: &mut Child, wait_for: Duration) -> std::io::Result<()> {
    wait_for_child_exit_receipt(child, wait_for).map(|_| ())
}

fn wait_for_child_exit_receipt(
    child: &mut Child,
    wait_for: Duration,
) -> std::io::Result<ProcessTermination> {
    let deadline = Instant::now() + wait_for;
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(ProcessTermination {
                status,
                timed_out: false,
                kill_requested: false,
            });
        }
        if Instant::now() >= deadline {
            return terminate_child_process_receipt(child, true);
        }
        thread::sleep(Duration::from_millis(10));
    }
}

/// Terminates a child process if it is still running and always reaps it before returning.
///
/// Reaping matters just as much as killing: without the final `wait`, exited
/// children can remain as zombies on Unix-like systems.
pub fn terminate_child_process(child: &mut Child) -> std::io::Result<()> {
    terminate_child_process_receipt(child, false).map(|_| ())
}

fn terminate_child_process_receipt(
    child: &mut Child,
    timed_out: bool,
) -> std::io::Result<ProcessTermination> {
    if let Some(status) = child.try_wait()? {
        return Ok(ProcessTermination {
            status,
            timed_out,
            kill_requested: false,
        });
    }
    match child.kill() {
        Ok(()) => {}
        Err(error) => {
            if child.try_wait()?.is_none() {
                return Err(error);
            }
            return child.wait().map(|status| ProcessTermination {
                status,
                timed_out,
                kill_requested: true,
            });
        }
    }
    child.wait().map(|status| ProcessTermination {
        status,
        timed_out,
        kill_requested: true,
    })
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

    /// `AsyncChildGuard::shutdown` never awaits, so a busy-poll is enough here.
    fn run<F: std::future::Future>(future: F) -> F::Output {
        let mut future = std::pin::pin!(future);
        let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
        loop {
            if let std::task::Poll::Ready(value) = future.as_mut().poll(&mut cx) {
                return value;
            }
        }
    }

    #[test]
    fn observed_spawn_records_stderr_and_exit_status() {
        let observer = crate::ProcessObserver::default();
        let (child, observation) = crate::CorsaCommand::new("sh")
            .with_process_observer(observer.clone())
            .spawn_observed_async(["-c", "printf 'corsa failed' >&2; exit 3"])
            .expect("spawn observed child");
        assert!(observation.is_some());
        let guard = crate::AsyncChildGuard::new_observed(child, observation);
        run(guard.shutdown(Duration::from_secs(10))).expect("shutdown");

        let receipts = observer.receipts();
        assert_eq!(receipts.len(), 1);
        let receipt = &receipts[0];
        assert_eq!(receipt.stderr, b"corsa failed");
        assert!(receipt.stderr_complete);
        assert_eq!(
            receipt.exit_status.and_then(|status| status.code()),
            Some(3)
        );
        assert!(receipt.completed && receipt.reaped);
        assert!(!receipt.timed_out && !receipt.kill_requested);
    }

    #[test]
    fn observed_shutdown_deadline_kills_and_reaps() {
        let observer = crate::ProcessObserver::default();
        let (child, observation) = crate::CorsaCommand::new("sh")
            .with_process_observer(observer.clone())
            .spawn_observed_async(["-c", "exec sleep 30"])
            .expect("spawn observed sleeper");
        let guard = crate::AsyncChildGuard::new_observed(child, observation);
        run(guard.shutdown(Duration::from_millis(20))).expect("shutdown");

        let receipt = observer.receipts().pop().expect("one receipt");
        assert!(receipt.timed_out && receipt.kill_requested && receipt.reaped);
        assert!(receipt.completed);
    }

    #[test]
    fn unobserved_spawn_returns_no_observation() {
        let (child, observation) = crate::CorsaCommand::new("sh")
            .spawn_observed_async(["-c", "exit 0"])
            .expect("spawn child");
        assert!(observation.is_none());
        let guard = crate::AsyncChildGuard::new_observed(child, observation);
        run(guard.shutdown(Duration::from_secs(10))).expect("shutdown");
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
