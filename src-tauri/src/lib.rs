//! Astro Desktop — Tauri application library.
//!
//! This module exposes the Tauri app builder and all command handlers.
//! The sidecar lifecycle (start/stop/health) is managed in [`sidecar`].
//! Native desktop features (tray, menus, deep links) are in [`tray`] and [`menu`].

pub mod sidecar;
mod menu;
mod tray;

use log::{error, info};
use sidecar::{SidecarState, SidecarStatus};
use tauri::{Manager, RunEvent, WindowEvent};

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

/// Tauri command: update sidecar status indicator in the system tray.
#[tauri::command]
fn set_sidecar_status(app: tauri::AppHandle, connected: bool) {
    tray::update_sidecar_status(&app, connected);
}

/// Tauri command: navigate to a specific project (for deep link handling).
#[tauri::command]
fn navigate_to_project(app: tauri::AppHandle, project_id: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&format!(
            "window.location.href = '/projects/{}'",
            project_id
        ));
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

/// Build and run the Tauri application.
///
/// This is called from `main.rs`. It:
/// 1. Registers managed state (`SidecarState`)
/// 2. Registers Tauri commands
/// 3. Sets up plugins (shell, log, deep-link, window-state)
/// 4. Creates system tray and native menu bar
/// 5. Hooks into the app lifecycle to start/stop the sidecar
/// 6. Keeps app running in tray when window is closed
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        // Plugin: structured logging
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
        // Plugin: shell (open URLs in browser)
        .plugin(tauri_plugin_shell::init())
        // Plugin: deep links (astro:// URL scheme)
        .plugin(tauri_plugin_deep_link::init())
        // Managed state
        .manage(SidecarState::default())
        // Register Tauri commands
        .invoke_handler(tauri::generate_handler![
            sidecar_status,
            sidecar_restart,
            set_sidecar_status,
            navigate_to_project,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Plugin: window state persistence (remember size/position)
            #[cfg(desktop)]
            handle.plugin(tauri_plugin_window_state::Builder::default().build())?;

            // Create the native menu bar
            let app_menu = menu::create_menu(&handle)?;
            app.set_menu(app_menu)?;

            // Create the system tray
            tray::create_tray(&handle)?;

            // Handle deep link events (astro:// URL scheme)
            #[cfg(desktop)]
            {
                let handle_clone = handle.clone();
                app.listen("deep-link://new-url", move |event| {
                    let payload = event.payload();
                    log::info!("Deep link received: {}", payload);
                    handle_deep_link(&handle_clone, payload);
                });
            }

            // Start the sidecar
            info!("Astro Desktop starting up...");
            let state = app.state::<SidecarState>();

            match sidecar::start_sidecar(&state) {
                Ok(()) => {
                    info!("Sidecar start initiated.");

                    // Spawn an async task to wait for readiness.
                    // We don't block setup — the frontend will see a loading
                    // state until `sidecar_status` returns healthy.
                    let ready_handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        match sidecar::wait_for_ready().await {
                            Ok(()) => {
                                info!("Sidecar is ready — app fully operational.");
                                // Update tray status to connected
                                tray::update_sidecar_status(&ready_handle, true);
                            }
                            Err(e) => {
                                error!("Sidecar failed to become ready: {}", e);
                                tray::update_sidecar_status(&ready_handle, false);
                                // Notify frontend of the error
                                if let Some(window) =
                                    ready_handle.get_webview_window("main")
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
                    tray::update_sidecar_status(&handle, false);
                    let msg = format!(
                        "Failed to start the Astro backend server.\n\n\
                         Error: {}\n\n\
                         The application may not work correctly. \
                         Check ~/.astro/logs/tauri-sidecar.log for details.",
                        e
                    );
                    error!("{}", msg);
                    // We intentionally don't return Err here — let the app
                    // open so the user can see diagnostic info in the UI.
                }
            }

            log::info!("Astro desktop app initialized");
            Ok(())
        })
        // Handle menu events globally
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        });

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Keep app running in tray when window is closed
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { api, .. },
                label,
                ..
            } => {
                if label == "main" {
                    // Don't exit — hide the window instead so sidecar keeps running
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                    log::info!("Main window hidden to tray");
                }
            }
            // On window destruction, stop the sidecar
            RunEvent::WindowEvent {
                event: WindowEvent::Destroyed,
                ..
            } => {
                let state = app.state::<SidecarState>();
                info!("Window destroyed — stopping sidecar.");
                if let Err(e) = sidecar::stop_sidecar(&state) {
                    error!("Error stopping sidecar on exit: {}", e);
                }
            }
            RunEvent::ExitRequested { api, .. } => {
                // Prevent default exit when all windows are closed
                // The app stays alive in the system tray
                api.prevent_exit();
            }
            _ => {}
        });
}

/// Parses and handles deep link URLs.
///
/// Supported URL formats:
/// - `astro://project/{project_id}` — navigates to a specific project
fn handle_deep_link<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &str) {
    // Strip the scheme and parse the path
    let url = url.trim_matches('"');
    if let Some(path) = url.strip_prefix("astro://") {
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        match parts.as_slice() {
            ["project", project_id] => {
                log::info!("Deep link: opening project {}", project_id);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(&format!(
                        "window.location.href = '/projects/{}'",
                        project_id
                    ));
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                log::warn!("Unhandled deep link path: {}", path);
                // Just show the main window for unknown paths
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    }
}
