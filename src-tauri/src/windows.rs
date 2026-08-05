use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::geometry::{self, CASCADE_STEP, CASCADE_WRAP, MIN_HEIGHT, MIN_WIDTH};
use crate::state::{AppState, DocState};

pub fn normalize(path: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical;
    }
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    }
}

pub fn title_for(path: Option<&Path>) -> String {
    path.and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_owned())
}

pub fn mtime_ms(path: &Path) -> Option<u64> {
    let modified = std::fs::metadata(path).and_then(|m| m.modified()).ok()?;
    let since = modified
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .ok()?;
    Some(since.as_millis() as u64)
}

/// A path that does not exist yet is still a valid target — it becomes an
/// empty buffer that saves to that location, so `foglio notes.md` works.
pub fn read_or_empty(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Pull file arguments out of an argv vector. macOS appends `-psn_…` on some
/// launches and Finder never passes files here at all, so anything that looks
/// like a flag is dropped.
pub fn paths_from_args<S: AsRef<str>>(args: &[S], cwd: Option<&Path>) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .map(|a| a.as_ref())
        .filter(|a| !a.is_empty() && !a.starts_with('-'))
        .map(|a| {
            let p = Path::new(a);
            match cwd {
                Some(cwd) if p.is_relative() => cwd.join(p),
                _ => p.to_path_buf(),
            }
        })
        .collect()
}

/// The single funnel every open route ends up in: CLI argv, Apple Events
/// (Finder / dock / `open -a`), a second launch, and drag-and-drop.
pub fn open_path(app: &AppHandle, path: PathBuf) -> Result<(), String> {
    let path = normalize(&path);
    let state = app.state::<AppState>();

    // Already on screen? Just bring it forward.
    let existing = {
        let docs = state.docs.lock().unwrap();
        docs.iter()
            .find(|(_, d)| d.path.as_deref() == Some(path.as_path()))
            .map(|(label, _)| label.clone())
    };
    if let Some(label) = existing {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.set_focus();
            return Ok(());
        }
        state.docs.lock().unwrap().remove(&label);
    }

    // An untouched, empty window gets the file rather than opening a second one.
    let reusable = {
        let docs = state.docs.lock().unwrap();
        docs.iter()
            .find(|(label, d)| d.reusable() && app.get_webview_window(label).is_some())
            .map(|(label, _)| label.clone())
    };
    if let Some(label) = reusable {
        if let Some(win) = app.get_webview_window(&label) {
            let content = read_or_empty(&path)?;
            state.docs.lock().unwrap().insert(
                label,
                DocState {
                    path: Some(path.clone()),
                    dirty: false,
                },
            );
            let _ = win.set_title(&title_for(Some(&path)));
            app.emit_to(
                win.label(),
                "foglio://open",
                serde_json::json!({
                    "path": path.to_string_lossy(),
                    "content": content,
                    "mtime": mtime_ms(&path),
                }),
            )
            .map_err(|e| e.to_string())?;
            let _ = win.show();
            let _ = win.set_focus();
            return Ok(());
        }
    }

    create_window(app, Some(path)).map(|_| ())
}

/// Windows are built hidden and revealed by the frontend once the editor has
/// mounted — that is what keeps startup free of a blank white flash.
pub fn create_window(app: &AppHandle, path: Option<PathBuf>) -> Result<WebviewWindow, String> {
    let state = app.state::<AppState>();
    let index = state.counter.fetch_add(1, Ordering::SeqCst);
    let label = format!("doc-{index}");

    state.docs.lock().unwrap().insert(
        label.clone(),
        DocState {
            path: path.clone(),
            dirty: false,
        },
    );

    let size = *state.last_size.lock().unwrap();

    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(title_for(path.as_deref()))
        .inner_size(size.width, size.height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .visible(false);

    // Step off the first window's position so documents never land stacked.
    // The very first window is left to the OS so it centres normally.
    let origin = *state.cascade_origin.lock().unwrap();
    if let Some((x, y)) = origin {
        let step = state.cascade_step.fetch_add(1, Ordering::SeqCst) % CASCADE_WRAP + 1;
        let offset = CASCADE_STEP * step as f64;
        builder = builder.position(x + offset, y + offset);
    }

    let win = builder.build().map_err(|e| e.to_string())?;

    if origin.is_none() {
        if let (Ok(position), Ok(scale)) = (win.outer_position(), win.scale_factor()) {
            let logical = position.to_logical::<f64>(scale);
            *state.cascade_origin.lock().unwrap() = Some((logical.x, logical.y));
        }
    }

    let handle = app.clone();
    let cleanup_label = label.clone();
    win.on_window_event(move |event| match event {
        // Remember the size the user settled on, for the next window.
        tauri::WindowEvent::Resized(size) => {
            if let Some(win) = handle.get_webview_window(&cleanup_label) {
                let scale = win.scale_factor().unwrap_or(1.0);
                let logical = size.to_logical::<f64>(scale);
                if logical.width >= MIN_WIDTH && logical.height >= MIN_HEIGHT {
                    *handle.state::<AppState>().last_size.lock().unwrap() = geometry::Size {
                        width: logical.width,
                        height: logical.height,
                    };
                }
            }
        }
        tauri::WindowEvent::Destroyed => {
            handle
                .state::<AppState>()
                .docs
                .lock()
                .unwrap()
                .remove(&cleanup_label);
        }
        _ => {}
    });

    Ok(win)
}
