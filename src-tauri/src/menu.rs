//! The macOS menu bar. Tauri's default menu has no File submenu, so the whole
//! bar is built here to add one — and the standard App/Edit/Window submenus
//! have to be reconstructed alongside it or they disappear.

use tauri::menu::{AboutMetadata, CheckMenuItem, Menu, MenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::appearance::{self, Mode};
use crate::windows;

pub const MENU_EVENT: &str = "foglio://menu";
pub const THEME_EVENT: &str = "foglio://theme";

pub fn build<R: Runtime>(app: &AppHandle<R>, mode: Mode) -> tauri::Result<Menu<R>> {
    let new_window = MenuItem::with_id(app, "new", "New Window", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "open", "Open File…", true, Some("CmdOrCtrl+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "save_as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;

    let about = AboutMetadata {
        name: Some("Foglio MD".into()),
        version: Some(app.package_info().version.to_string()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, "Foglio MD")
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

    // muda has no radio group, so these are check items kept mutually exclusive
    // by hand whenever the mode changes.
    let mut view = SubmenuBuilder::new(app, "View");
    let items: Vec<CheckMenuItem<R>> = Mode::ALL
        .iter()
        .map(|m| {
            let label = match m {
                Mode::System => "Match System",
                Mode::Light => "Light",
                Mode::Dark => "Dark",
            };
            CheckMenuItem::with_id(app, m.menu_id(), label, true, *m == mode, None::<&str>)
        })
        .collect::<tauri::Result<_>>()?;
    for item in &items {
        view = view.item(item);
    }
    let view = view.build()?;

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

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
}

/// New and Open are handled entirely in Rust. Save needs the buffer, which
/// only the frontend has, so those are forwarded to the focused window.
pub fn handle(app: &AppHandle, id: &str) {
    match id {
        "new" => {
            if let Err(message) = windows::create_window(app, None) {
                eprintln!("foglio: {message}");
            }
        }
        "open" => pick_file(app),
        "theme:system" => set_mode(app, Mode::System),
        "theme:light" => set_mode(app, Mode::Light),
        "theme:dark" => set_mode(app, Mode::Dark),
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
                    eprintln!("foglio: {message}");
                }
            });
        });
}

/// Persist the chosen appearance, correct the check marks, and tell every open
/// window — appearance is app-wide, not per document.
fn set_mode(app: &AppHandle, mode: Mode) {
    appearance::save(app, mode);
    sync_checks(app, mode);
    for (label, _) in app.webview_windows() {
        let _ = app.emit_to(label.as_str(), THEME_EVENT, mode.as_str());
    }
}

/// Only one mode may look selected. The items live inside the View submenu, so
/// the lookup has to descend into it rather than scanning the top level.
///
/// Also used at startup: the menu is built before Tauri has managed the path
/// resolver, so the stored mode cannot be read in time to build the check marks
/// correctly and has to be applied here instead.
pub fn sync_checks(app: &AppHandle, mode: Mode) {
    let Some(menu) = app.menu() else { return };
    let Ok(items) = menu.items() else { return };
    for kind in items {
        let Some(submenu) = kind.as_submenu() else {
            continue;
        };
        for candidate in Mode::ALL {
            if let Some(item) = submenu.get(candidate.menu_id()) {
                if let Some(check) = item.as_check_menuitem() {
                    let _ = check.set_checked(candidate == mode);
                }
            }
        }
    }
}
