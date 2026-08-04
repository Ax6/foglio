mod commands;
mod geometry;
mod macos;
mod menu;
mod state;
mod windows;

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use tauri::Manager;

use state::AppState;

/// Opening a document must never take the process down, but a silent failure
/// leaves an invisible window and no explanation.
fn report(result: Result<(), String>) {
    if let Err(message) = result {
        eprintln!("showmd: {message}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be registered before any other plugin.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = windows::paths_from_args(&argv, Some(&PathBuf::from(cwd)));
            if paths.is_empty() {
                report(windows::create_window(app, None).map(|_| ()));
            }
            for path in paths {
                report(windows::open_path(app, path));
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle(app, event.id().as_ref()))
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap,
            commands::ready,
            commands::read_file,
            commands::save_file,
            commands::set_dirty,
            commands::open_path,
            commands::stat_mtime,
            commands::force_close,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            *state.last_size.lock().unwrap() = geometry::load(app.handle());

            let args: Vec<String> = std::env::args().collect();
            let paths = windows::paths_from_args(&args, None);
            state.pending.lock().unwrap().extend(paths);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build showmd");

    app.run(|app, event| match event {
        // Finder double-click, dock drop and `open -a` all arrive here — never
        // through argv. This can fire before `Ready`, so queue instead of emit.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        tauri::RunEvent::Opened { urls } => {
            let paths: Vec<PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            let state = app.state::<AppState>();
            if state.ready.load(Ordering::SeqCst) {
                for path in paths {
                    report(windows::open_path(app, path));
                }
            } else {
                state.pending.lock().unwrap().extend(paths);
            }
        }
        tauri::RunEvent::Ready => {
            let state = app.state::<AppState>();
            state.ready.store(true, Ordering::SeqCst);
            let pending = std::mem::take(&mut *state.pending.lock().unwrap());
            if pending.is_empty() {
                report(windows::create_window(app, None).map(|_| ()));
            } else {
                for path in pending {
                    report(windows::open_path(app, path));
                }
            }
        }
        tauri::RunEvent::Exit => {
            let size = *app.state::<AppState>().last_size.lock().unwrap();
            geometry::save(app, size);
        }
        _ => {}
    });
}
