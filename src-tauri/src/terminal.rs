//! PTY-based terminal integration.
//!
//! Each terminal session is assigned a caller-provided ID and spawns a shell
//! inside a pseudo-terminal.  Output is streamed to the frontend via the
//! `terminal-output` Tauri event.

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use tauri::{AppHandle, Emitter, State};

// ── Public event types emitted to the frontend ────────────────────────────────

/// Payload for the `terminal-output` Tauri event.
#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutput {
    pub id: String,
    pub data: String,
}

/// Snapshot of a live terminal session returned by `list_terminals`.
#[derive(Debug, Clone, Serialize)]
pub struct TerminalInfo {
    pub id: String,
    pub cwd: String,
    pub shell: String,
}

// ── Internal session state ────────────────────────────────────────────────────

struct TerminalSession {
    id: String,
    cwd: String,
    shell: String,
    /// PTY master — needed to resize the terminal.
    master: Box<dyn MasterPty + Send>,
    /// Writer end of the PTY — needed to send input.
    writer: Box<dyn Write + Send>,
    /// Handle to the spawned shell process.
    child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Setting this to `true` asks the reader thread to exit gracefully.
    stop_flag: Arc<AtomicBool>,
}

// ── Managed state ─────────────────────────────────────────────────────────────

pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalState {
    pub fn new() -> Self {
        TerminalState {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Spawn a new PTY terminal session identified by `id`.
///
/// Uses `$SHELL` (or `/bin/zsh` as fallback) when `shell` is `None`.
/// Terminal output is forwarded to the frontend as `terminal-output` events.
#[tauri::command]
pub fn spawn_terminal(
    id: String,
    cwd: String,
    shell: Option<String>,
    app: AppHandle,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let shell_path = shell
        .unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()));

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut cmd = CommandBuilder::new(&shell_path);
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn_command failed: {e}"))?;

    // Obtain reader/writer before the master is moved into the session struct.
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader failed: {e}"))?;

    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();
    let id_clone = id.clone();

    // Background thread: read PTY output and forward to frontend.
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            if stop_clone.load(Ordering::SeqCst) {
                break;
            }
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF — shell exited
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutput {
                            id: id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });

    let session = TerminalSession {
        id: id.clone(),
        cwd,
        shell: shell_path,
        master: pair.master,
        writer,
        child,
        stop_flag,
    };

    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, session);

    Ok(())
}

/// Send raw input bytes to a running terminal session.
#[tauri::command]
pub fn write_terminal(
    id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal session '{id}' not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write_all failed: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

/// Resize the PTY window for a running terminal session.
#[tauri::command]
pub fn resize_terminal(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("terminal session '{id}' not found"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize failed: {e}"))?;
    Ok(())
}

/// Kill a terminal session and free its resources.
#[tauri::command]
pub fn kill_terminal(id: String, state: State<'_, TerminalState>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.remove(&id) {
        session.stop_flag.store(true, Ordering::SeqCst);
        send_sigterm(&*session.child);
    }
    Ok(())
}

/// Return a snapshot of all currently active terminal sessions.
#[tauri::command]
pub fn list_terminals(state: State<'_, TerminalState>) -> Vec<TerminalInfo> {
    let Ok(sessions) = state.sessions.lock() else {
        return vec![];
    };
    sessions
        .values()
        .map(|s| TerminalInfo {
            id: s.id.clone(),
            cwd: s.cwd.clone(),
            shell: s.shell.clone(),
        })
        .collect()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Send SIGTERM (Unix) or call `taskkill` (Windows) to terminate a child.
fn send_sigterm(child: &dyn portable_pty::Child) {
    let Some(pid) = child.process_id() else {
        return;
    };

    #[cfg(unix)]
    {
        // SAFETY: kill(2) is always safe to call with a valid pid.
        unsafe {
            libc::kill(pid as libc::pid_t, libc::SIGTERM);
        }
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_state_starts_empty() {
        let state = TerminalState::new();
        let sessions = state.sessions.lock().unwrap();
        assert!(sessions.is_empty(), "fresh TerminalState should have no sessions");
    }

    #[test]
    fn terminal_info_serializes() {
        let info = TerminalInfo {
            id: "term-abc".to_string(),
            cwd: "/home/user/projects".to_string(),
            shell: "/bin/zsh".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("term-abc"));
        assert!(json.contains("/home/user/projects"));
        assert!(json.contains("/bin/zsh"));
    }

    #[test]
    fn terminal_output_serializes() {
        let out = TerminalOutput {
            id: "term-1".to_string(),
            data: "hello\r\n".to_string(),
        };
        let json = serde_json::to_string(&out).unwrap();
        assert!(json.contains("term-1"));
        assert!(json.contains("hello"));
    }

    #[test]
    fn session_map_insert_lookup_remove() {
        // Exercise the HashMap operations that back TerminalState.
        let mut map: HashMap<String, String> = HashMap::new();
        map.insert("s1".into(), "session-one".into());
        map.insert("s2".into(), "session-two".into());
        assert_eq!(map.len(), 2);
        assert!(map.contains_key("s1"));
        map.remove("s1");
        assert_eq!(map.len(), 1);
        assert!(!map.contains_key("s1"));
        assert!(map.contains_key("s2"));
    }

    #[test]
    fn stop_flag_roundtrip() {
        let flag = Arc::new(AtomicBool::new(false));
        assert!(!flag.load(Ordering::SeqCst));
        flag.store(true, Ordering::SeqCst);
        assert!(flag.load(Ordering::SeqCst));
    }
}
