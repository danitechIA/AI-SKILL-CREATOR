mod commands;

use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub project_path: Mutex<Option<PathBuf>>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            project_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::select_project,
            commands::get_project_info,
            commands::read_file,
            commands::write_file,
            commands::delete_file,
            commands::create_skill,
            commands::delete_skill,
            commands::check_ai_engine,
            commands::install_ai_engine,
            commands::run_ai,
            commands::check_for_updates,
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
