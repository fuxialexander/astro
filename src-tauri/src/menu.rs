use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};

/// Creates the native menu bar for the application.
///
/// Menu structure:
/// - **File**: New Project (Cmd+N), Open Project, separator, Quit (Cmd+Q)
/// - **Edit**: Undo (Cmd+Z), Redo (Cmd+Shift+Z), separator, Cut (Cmd+X), Copy (Cmd+C), Paste (Cmd+V), Select All (Cmd+A)
/// - **View**: Reload (Cmd+R), Toggle DevTools (Cmd+Opt+I), separator, Zoom In, Zoom Out, Actual Size
/// - **Help**: Documentation, separator, About Astro
pub fn create_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file_menu = create_file_menu(app)?;
    let edit_menu = create_edit_menu(app)?;
    let view_menu = create_view_menu(app)?;
    let help_menu = create_help_menu(app)?;

    let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &view_menu, &help_menu])?;

    Ok(menu)
}

/// Creates the File menu with project management items.
fn create_file_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let new_project = MenuItemBuilder::with_id("new_project", "New Project")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let open_project = MenuItemBuilder::with_id("open_project", "Open Project...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let separator = PredefinedMenuItem::separator(app)?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Astro"))?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .items(&[&new_project, &open_project, &separator, &quit])
        .build()?;

    Ok(file_menu)
}

/// Creates the Edit menu with standard text editing operations.
/// These are essential for webview text editing to work properly on macOS.
fn create_edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let separator1 = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .items(&[
            &undo,
            &redo,
            &separator1,
            &cut,
            &copy,
            &paste,
            &separator2,
            &select_all,
        ])
        .build()?;

    Ok(edit_menu)
}

/// Creates the View menu with reload, devtools, and zoom controls.
fn create_view_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let reload = MenuItemBuilder::with_id("reload", "Reload")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let force_reload = MenuItemBuilder::with_id("force_reload", "Force Reload")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;

    let toggle_devtools = MenuItemBuilder::with_id("toggle_devtools", "Toggle Developer Tools")
        .accelerator("CmdOrCtrl+Alt+I")
        .build(app)?;

    let separator1 = PredefinedMenuItem::separator(app)?;

    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In")
        .accelerator("CmdOrCtrl+=")
        .build(app)?;

    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out")
        .accelerator("CmdOrCtrl+-")
        .build(app)?;

    let actual_size = MenuItemBuilder::with_id("actual_size", "Actual Size")
        .accelerator("CmdOrCtrl+0")
        .build(app)?;

    let separator2 = PredefinedMenuItem::separator(app)?;

    let fullscreen = MenuItemBuilder::with_id("fullscreen", "Toggle Full Screen")
        .accelerator("F11")
        .build(app)?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .items(&[
            &reload,
            &force_reload,
            &toggle_devtools,
            &separator1,
            &zoom_in,
            &zoom_out,
            &actual_size,
            &separator2,
            &fullscreen,
        ])
        .build()?;

    Ok(view_menu)
}

/// Creates the Help menu with documentation and about links.
fn create_help_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    let documentation = MenuItemBuilder::with_id("documentation", "Documentation").build(app)?;

    let separator = PredefinedMenuItem::separator(app)?;

    let about = PredefinedMenuItem::about(app, Some("About Astro"), None)?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .items(&[&documentation, &separator, &about])
        .build()?;

    Ok(help_menu)
}

/// Handles menu events from the native menu bar.
///
/// Routes menu item clicks to the appropriate action:
/// - Navigation commands are emitted as events to the frontend
/// - View commands (reload, devtools, zoom) operate on the webview directly
/// - Help commands open external URLs
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event_id: &str) {
    match event_id {
        // File menu
        "new_project" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu-event", "new_project");
            }
        }
        "open_project" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.emit("menu-event", "open_project");
            }
        }

        // View menu
        "reload" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        "force_reload" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.location.reload()");
            }
        }
        "toggle_devtools" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_devtools_open() {
                    window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "zoom_in" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(
                    "document.body.style.zoom = (parseFloat(document.body.style.zoom || 1) + 0.1).toString()"
                );
            }
        }
        "zoom_out" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(
                    "document.body.style.zoom = Math.max(0.5, parseFloat(document.body.style.zoom || 1) - 0.1).toString()"
                );
            }
        }
        "actual_size" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("document.body.style.zoom = '1'");
            }
        }
        "fullscreen" => {
            if let Some(window) = app.get_webview_window("main") {
                let is_fullscreen = window.is_fullscreen().unwrap_or(false);
                let _ = window.set_fullscreen(!is_fullscreen);
            }
        }

        // Help menu
        "documentation" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("window.open('https://astroanywhere.com/docs', '_blank')");
            }
        }

        _ => {}
    }
}
