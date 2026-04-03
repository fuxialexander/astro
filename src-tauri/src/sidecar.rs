use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use serde::Serialize;

pub struct SidecarState {
    pub child: Mutex<Option<Child>>,
    pub started_at: Mutex<Option<u64>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            started_at: Mutex::new(None),
        }
    }
}

#[derive(Serialize)]
pub struct SidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub version: Option<String>,
    pub uptime: Option<u64>,
}

fn sidecar_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    // Production: resources are bundled next to the binary
    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join("sidecar").join("index.mjs");
        if p.exists() {
            return Some(p);
        }
    }

    // Dev mode: binary is at src-tauri/target/debug/astro-desktop
    // sidecar is at src-tauri/sidecar/index.mjs
    if let Ok(exe) = std::env::current_exe() {
        // target/debug/ → ../../sidecar/
        if let Some(parent) = exe.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
            let p = parent.join("sidecar").join("index.mjs");
            if p.exists() {
                return Some(p);
            }
        }
    }

    None
}

#[tauri::command]
pub fn sidecar_status(state: State<SidecarState>) -> SidecarStatus {
    let mut child = state.child.lock().unwrap();

    let running = if let Some(ref mut c) = *child {
        match c.try_wait() {
            Ok(None) => true,
            _ => {
                *child = None;
                false
            }
        }
    } else {
        false
    };

    let pid = if running {
        child.as_ref().map(|c| c.id())
    } else {
        None
    };

    let uptime = if running {
        let started_at = state.started_at.lock().unwrap();
        started_at.map(|t| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .saturating_sub(t)
        })
    } else {
        None
    };

    SidecarStatus {
        running,
        pid,
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        uptime,
    }
}

#[tauri::command]
pub fn start_sidecar(app: AppHandle, state: State<SidecarState>) -> Result<(), String> {
    let mut child_lock = state.child.lock().unwrap();

    // Already running?
    if let Some(ref mut c) = *child_lock {
        if let Ok(None) = c.try_wait() {
            return Ok(());
        }
    }

    let index_path = sidecar_path(&app)
        .ok_or_else(|| "Sidecar index.mjs not found. Run npm run tauri:sidecar first.".to_string())?;

    let child = Command::new("node")
        .arg(&index_path)
        .env("ASTRO_MODE", "local")
        .env("ASTRO_DESKTOP", "1")
        .env("PORT", "3001")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn node: {e}"))?;

    *child_lock = Some(child);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    *state.started_at.lock().unwrap() = Some(now);

    Ok(())
}

#[tauri::command]
pub fn stop_sidecar(state: State<SidecarState>) -> Result<(), String> {
    let mut child = state.child.lock().unwrap();
    if let Some(ref mut c) = *child {
        c.kill().map_err(|e| e.to_string())?;
    }
    *child = None;
    *state.started_at.lock().unwrap() = None;
    Ok(())
}
