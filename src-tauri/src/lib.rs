//! Astro Desktop — Tauri application library.
//!
//! This module exposes the Tauri app builder and all command handlers.
//! The sidecar lifecycle (start/stop/health) is managed in [`sidecar`].

pub mod sidecar;

use log::{error, info};
use sidecar::{SidecarState, SidecarStatus};

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Frontend-callable command to check sidecar health and status.
#[tauri::command]
async fn sidecar_status(state: tauri::State<'_, SidecarState>) -> Result<SidecarStatus, String> {
    Ok(sidecar::get_status(&state).await)
}

/// Frontend-callable command to restart the sidecar (stop + start + wait).
#[tauri::command]
async fn sidecar_restart(state: tauri::State<'_, SidecarState>) -> Result<SidecarStatus, String> {
    info!("Restart requested by frontend");

    // Stop existing
    if let Err(e) = sidecar::stop_sidecar(&state) {
        error!("Error stopping sidecar during restart: {}", e);
    }

    // Start fresh
    sidecar::start_sidecar(&state)?;
    sidecar::wait_for_ready().await?;

    Ok(sidecar::get_status(&state).await)
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

/// Build and run the Tauri application.
///
/// This is called from `main.rs`. It:
/// 1. Registers managed state (`SidecarState`)
/// 2. Registers Tauri commands (`sidecar_status`, `sidecar_restart`)
/// 3. Hooks into the app lifecycle to start/stop the sidecar
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("astro-desktop".into()),
                    },
                ))
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .level(log::LevelFilter::Info)
                .build(),
        )
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![sidecar_status, sidecar_restart])
        .setup(|app| {
            info!("Astro Desktop starting up...");

            let state = app.state::<SidecarState>();

            // Start the sidecar synchronously during setup
            match sidecar::start_sidecar(&state) {
                Ok(()) => {
                    info!("Sidecar start initiated.");

                    // Spawn an async task to wait for readiness.
                    // We don't block setup — the frontend will see a loading
                    // state until `sidecar_status` returns healthy.
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        match sidecar::wait_for_ready().await {
                            Ok(()) => {
                                info!("Sidecar is ready — app fully operational.");
                            }
                            Err(e) => {
                                error!("Sidecar failed to become ready: {}", e);
                                // Show an error dialog to the user
                                if let Some(window) =
                                    handle.get_webview_window("main")
                                {
                                    let _ = window.eval(&format!(
                                        "window.__ASTRO_SIDECAR_ERROR__ = {};",
                                        serde_json::json!(e)
                                    ));
                                }
                            }
                        }
                    });
                }
                Err(e) => {
                    error!("Failed to start sidecar: {}", e);
                    // Show a native dialog for critical startup failure
                    let msg = format!(
                        "Failed to start the Astro backend server.\n\n\
                         Error: {}\n\n\
                         The application may not work correctly. \
                         Check ~/.astro/logs/tauri-sidecar.log for details.",
                        e
                    );
                    // Use tauri dialog API if available, otherwise log
                    error!("{}", msg);

                    // We intentionally don't return Err here — let the app
                    // open so the user can see diagnostic info in the UI.
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Handle window close to stop the sidecar
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let state = app.state::<SidecarState>();
                info!("Window destroyed — stopping sidecar.");
                if let Err(e) = sidecar::stop_sidecar(&state) {
                    error!("Error stopping sidecar on exit: {}", e);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
