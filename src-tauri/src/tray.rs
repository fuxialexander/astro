use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

/// Creates and configures the system tray icon with menu items.
///
/// Menu items:
/// - "Open Astro" — brings the main window to focus
/// - "Sidecar Status" — shows current sidecar connection status
/// - Separator
/// - "Quit" — exits the application
pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Open Astro", true, None::<&str>)?;
    let status_i = MenuItem::with_id(
        app,
        "sidecar_status",
        "Sidecar: Checking...",
        false,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit Astro", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open_i, &status_i, &separator, &quit_i])?;

    let _ = TrayIconBuilder::with_id("main-tray")
        .icon(
            Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("failed to load embedded tray icon"),
        )
        .icon_as_template(true)
        .tooltip("Astro")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => {
                show_main_window(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Updates the sidecar status indicator in the tray menu.
///
/// Shows a green circle emoji when connected, red when disconnected.
pub fn update_sidecar_status<R: Runtime>(app: &AppHandle<R>, connected: bool) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        if let Some(menu) = tray.menu() {
            if let Some(item) = menu.get("sidecar_status") {
                let status_text = if connected {
                    "Sidecar: Connected"
                } else {
                    "Sidecar: Disconnected"
                };
                let _ = item.as_menuitem_unchecked().set_text(status_text);
            }
        }
    }
}

/// Helper to show and focus the main window.
fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
