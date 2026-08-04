//! The macOS menu bar. Tauri's default menu has no File submenu, so the whole
//! bar is built here to add one — and the standard App/Edit/Window submenus
//! have to be reconstructed alongside it or they disappear.

use tauri::menu::{AboutMetadata, Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::windows;

pub const MENU_EVENT: &str = "showmd://menu";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let new_window = MenuItem::with_id(app, "new", "New Window", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "open", "Open File…", true, Some("CmdOrCtrl+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "save_as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;

    let about = AboutMetadata {
        name: Some("showmd".into()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "showmd")
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .item(&open)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .close_window()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &window])
}

/// New and Open are handled entirely in Rust. Save needs the buffer, which
/// only the frontend has, so those are forwarded to the focused window.
pub fn handle(app: &AppHandle, id: &str) {
    match id {
        "new" => {
            if let Err(message) = windows::create_window(app, None) {
                eprintln!("showmd: {message}");
            }
        }
        "open" => pick_file(app),
        "save" | "save_as" => {
            if let Some(win) = focused(app) {
                let _ = app.emit_to(win.label(), MENU_EVENT, id);
            }
        }
        _ => {}
    }
}

fn focused(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.values().next())
        .cloned()
}

fn pick_file(app: &AppHandle) {
    use tauri_plugin_dialog::DialogExt;

    let handle = app.clone();
    app.dialog()
        .file()
        .set_title("Open Markdown File")
        .add_filter(
            "Markdown",
            &["md", "markdown", "mdown", "mkd", "mdx", "txt"],
        )
        .pick_file(move |selected| {
            let Some(path) = selected.and_then(|f| f.into_path().ok()) else {
                return;
            };
            // The picker callback is off the main thread; window creation
            // must be marshalled back onto it.
            let inner = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Err(message) = windows::open_path(&inner, path) {
                    eprintln!("showmd: {message}");
                }
            });
        });
}
