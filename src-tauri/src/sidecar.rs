//! Sidecar lifecycle manager for the Node.js Hono API server.
//!
//! Manages spawning, health-checking, and stopping the bundled sidecar
//! process (`sidecar/astro-sidecar.js`). The child process handle is
//! stored in a `Mutex<Option<Child>>` and registered as Tauri managed state.

use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use log::{error, info, warn};

/// Default port for the sidecar Hono server.
pub const SIDECAR_PORT: u16 = 3001;

/// How long `wait_for_ready` polls before giving up.
const READY_TIMEOUT: Duration = Duration::from_secs(10);

/// Interval between health-check polls during startup.
const POLL_INTERVAL: Duration = Duration::from_millis(200);

/// Grace period before SIGKILL after sending SIGTERM.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);

/// Tauri managed state holding the sidecar child process.
pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }
}

/// Result of a sidecar status check.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SidecarStatus {
    /// Whether the sidecar process is running (has a live child handle).
    pub running: bool,
    /// Whether the HTTP health endpoint returned 200.
    pub healthy: bool,
    /// The port the sidecar is expected to be on.
    pub port: u16,
    /// If an external process was detected on the port instead of our sidecar.
    pub external_process: bool,
}

// ---------------------------------------------------------------------------
// Port conflict detection
// ---------------------------------------------------------------------------

/// Check if `port` is already bound by some process.
pub fn is_port_in_use(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port))
        .map(|_| true)
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

/// Return the path to the sidecar log file, creating parent dirs as needed.
fn log_file_path() -> std::path::PathBuf {
    let base = dirs::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".astro")
        .join("logs");
    let _ = fs::create_dir_all(&base);
    base.join("tauri-sidecar.log")
}

/// Spawn a background thread that reads lines from `reader` and writes them
/// to the log file and the `log` crate at `info` level.
fn pipe_to_log(reader: impl std::io::Read + Send + 'static, label: &'static str) {
    let log_path = log_file_path();
    std::thread::spawn(move || {
        let buf = BufReader::new(reader);
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();
        for line in buf.lines() {
            match line {
                Ok(text) => {
                    info!("[sidecar:{}] {}", label, text);
                    if let Some(ref mut f) = file {
                        use std::io::Write;
                        let _ = writeln!(f, "[{}] {}", label, text);
                    }
                }
                Err(e) => {
                    warn!("[sidecar:{}] read error: {}", label, e);
                    break;
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Core lifecycle functions
// ---------------------------------------------------------------------------

/// Resolve the path to the sidecar JS entry point.
///
/// Searches (in order):
///   1. `<app_dir>/sidecar/astro-sidecar.js`  (bundled next to the binary)
///   2. `./sidecar/astro-sidecar.js`           (dev fallback)
fn resolve_sidecar_path() -> Result<std::path::PathBuf, String> {
    // When running in a Tauri bundle the binary lives at
    // `<bundle>/Contents/MacOS/astro-desktop` (macOS) or similar.
    // The sidecar bundle is placed alongside or inside the resources dir.
    let candidates: Vec<std::path::PathBuf> = vec![
        // Relative to current exe
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("sidecar").join("astro-sidecar.js")))
            .unwrap_or_default(),
        // Relative to cwd (useful during `tauri dev`)
        std::path::PathBuf::from("sidecar/astro-sidecar.js"),
        // Relative to project root during development
        std::path::PathBuf::from("../sidecar/astro-sidecar.js"),
    ];

    for c in &candidates {
        if c.exists() {
            return Ok(c.clone());
        }
    }

    Err(format!(
        "Sidecar script not found. Searched: {:?}",
        candidates
    ))
}

/// Spawn the Node.js sidecar server.
///
/// Sets `ASTRO_TAURI=1` and `PORT=3001` in the child environment. Stdout and
/// stderr are piped to the Tauri log plugin and `~/.astro/logs/tauri-sidecar.log`.
///
/// Returns an error if the port is already in use (port conflict) or if the
/// process fails to spawn.
pub fn start_sidecar(state: &SidecarState) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| format!("lock error: {}", e))?;

    // Already running?
    if let Some(ref mut child) = *guard {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // Process exited — clear handle and proceed to respawn.
                info!("Previous sidecar process has exited; respawning.");
            }
            Ok(None) => {
                info!("Sidecar already running (pid {})", child.id());
                return Ok(());
            }
            Err(e) => {
                warn!("Error checking sidecar status: {}; will respawn.", e);
            }
        }
    }

    // Port conflict detection
    if is_port_in_use(SIDECAR_PORT) {
        // Check if the existing server is an Astro health endpoint
        if health_check_sync() {
            info!(
                "Port {} already has a healthy Astro server — reusing it.",
                SIDECAR_PORT
            );
            // Don't spawn a new process; the frontend can connect to the existing one.
            *guard = None;
            return Ok(());
        }
        return Err(format!(
            "Port {} is already in use by another process. \
             Please stop the process using that port (e.g., a running `npm run dev`) \
             or choose a different port.",
            SIDECAR_PORT
        ));
    }

    let sidecar_path = resolve_sidecar_path()?;
    info!("Starting sidecar: node {}", sidecar_path.display());

    let mut cmd = Command::new("node");
    cmd.arg(&sidecar_path)
        .env("ASTRO_TAURI", "1")
        .env("PORT", SIDECAR_PORT.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to spawn sidecar (node {}): {}",
            sidecar_path.display(),
            e
        )
    })?;

    info!("Sidecar spawned with pid {}", child.id());

    // Pipe stdout/stderr to log
    if let Some(stdout) = child.stdout.take() {
        pipe_to_log(stdout, "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        pipe_to_log(stderr, "stderr");
    }

    *guard = Some(child);
    Ok(())
}

/// Stop the sidecar process gracefully.
///
/// Sends SIGTERM (Unix) or kills (Windows), waits up to 3 seconds for graceful
/// shutdown, then sends SIGKILL if the process is still alive.
pub fn stop_sidecar(state: &SidecarState) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| format!("lock error: {}", e))?;

    let child = match guard.take() {
        Some(c) => c,
        None => {
            info!("No sidecar process to stop.");
            return Ok(());
        }
    };

    let pid = child.id();
    info!("Stopping sidecar (pid {})", pid);

    // Platform-specific graceful shutdown
    #[cfg(unix)]
    {
        // Send SIGTERM
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }

    #[cfg(not(unix))]
    {
        // On Windows, we just kill directly (no graceful SIGTERM equivalent)
        let _ = child.kill();
        return Ok(());
    }

    // Wait for graceful exit with timeout
    let mut child = child;
    let deadline = Instant::now() + SHUTDOWN_GRACE;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                info!("Sidecar exited with status: {}", status);
                return Ok(());
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    warn!("Sidecar did not exit within {}s; sending SIGKILL", SHUTDOWN_GRACE.as_secs());
                    let _ = child.kill();
                    let _ = child.wait();
                    info!("Sidecar force-killed.");
                    return Ok(());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                error!("Error waiting for sidecar: {}", e);
                let _ = child.kill();
                return Err(format!("Error waiting for sidecar: {}", e));
            }
        }
    }
}

/// Synchronous HTTP health check against `localhost:3001/api/health`.
///
/// Returns `true` if the server responds with HTTP 200.
fn health_check_sync() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|client| {
            client
                .get(format!("http://127.0.0.1:{}/api/health", SIDECAR_PORT))
                .send()
                .ok()
        })
        .map(|resp| resp.status().is_success())
        .unwrap_or(false)
}

/// Async HTTP health check against `localhost:3001/api/health`.
///
/// Returns `true` if the server responds with HTTP 200.
pub async fn health_check() -> bool {
    let url = format!("http://127.0.0.1:{}/api/health", SIDECAR_PORT);
    match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client
            .get(&url)
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Poll `health_check()` every 200ms for up to 10 seconds.
///
/// Returns `Ok(())` once the server is healthy, or `Err` if the timeout expires.
pub async fn wait_for_ready() -> Result<(), String> {
    let deadline = Instant::now() + READY_TIMEOUT;
    let mut attempt = 0u32;

    info!(
        "Waiting for sidecar to be ready (timeout: {}s)...",
        READY_TIMEOUT.as_secs()
    );

    loop {
        attempt += 1;
        if health_check().await {
            info!("Sidecar is ready after {} attempts.", attempt);
            return Ok(());
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "Sidecar failed to become ready within {}s ({} attempts). \
                 Check ~/.astro/logs/tauri-sidecar.log for details.",
                READY_TIMEOUT.as_secs(),
                attempt
            ));
        }

        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

/// Get the current sidecar status (for the Tauri command).
pub async fn get_status(state: &SidecarState) -> SidecarStatus {
    let running = {
        let guard = state.child.lock().unwrap_or_else(|e| e.into_inner());
        guard.is_some()
    };

    let healthy = health_check().await;

    // If the port has a healthy server but we didn't spawn it, flag as external
    let external_process = !running && healthy;

    SidecarStatus {
        running,
        healthy,
        port: SIDECAR_PORT,
        external_process,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_port_check_unbound() {
        // Port 39999 is very unlikely to be in use
        assert!(!is_port_in_use(39999));
    }

    #[test]
    fn test_sidecar_state_default() {
        let state = SidecarState::default();
        let guard = state.child.lock().unwrap();
        assert!(guard.is_none());
    }
}
