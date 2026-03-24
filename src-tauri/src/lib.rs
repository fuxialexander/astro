mod fs_commands;
mod terminal;
mod watcher;

use terminal::TerminalState;
use watcher::WatcherState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::new())
        .manage(WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            // Filesystem & git commands
            fs_commands::list_files,
            fs_commands::git_ls_files,
            fs_commands::git_status,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
