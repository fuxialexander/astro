mod fs_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fs_commands::list_files,
            fs_commands::git_ls_files,
            fs_commands::git_status,
            fs_commands::read_file,
            fs_commands::search_files,
            fs_commands::get_file_tree,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
