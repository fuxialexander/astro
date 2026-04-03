mod fs_commands;
mod sidecar;
mod terminal;
mod watcher;

use sidecar::SidecarState;
use terminal::TerminalState;
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SidecarState::new())
        .manage(TerminalState::new())
        .manage(WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            // Filesystem & git commands
            fs_commands::list_files,
            fs_commands::git_ls_files,
            fs_commands::git_status,
            fs_commands::git_diff,
            fs_commands::git_commit,
            fs_commands::git_push,
            fs_commands::git_create_branch,
            fs_commands::open_in_editor,
            fs_commands::detect_editors,
            fs_commands::pick_directory,
            fs_commands::git_current_branch,
            fs_commands::read_file,
            fs_commands::search_files,
            fs_commands::get_file_tree,
            // Terminal (PTY) commands
            terminal::spawn_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::kill_terminal,
            terminal::list_terminals,
            // Filesystem watcher commands
            watcher::watch_directory,
            watcher::unwatch,
            // Sidecar management
            sidecar::sidecar_status,
            sidecar::start_sidecar,
            sidecar::stop_sidecar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
