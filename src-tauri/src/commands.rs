use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::state::{AppState, DocState};
use crate::windows;

#[derive(Serialize)]
pub struct Doc {
    pub path: Option<String>,
    pub content: String,
    pub mtime: Option<u64>,
}

#[derive(Serialize)]
pub struct Saved {
    /// Canonicalized, so the frontend tracks the same path Rust does.
    pub path: String,
    pub mtime: Option<u64>,
}

/// The frontend pulls its document on startup rather than waiting for an
/// event, because `RunEvent::Opened` can fire before any webview is listening.
#[tauri::command]
pub fn bootstrap(window: WebviewWindow, state: State<AppState>) -> Result<Doc, String> {
    let path = state
        .docs
        .lock()
        .unwrap()
        .get(window.label())
        .and_then(|d| d.path.clone());

    match path {
        Some(path) => Ok(Doc {
            content: windows::read_or_empty(&path)?,
            mtime: windows::mtime_ms(&path),
            path: Some(path.to_string_lossy().into_owned()),
        }),
        None => Ok(Doc {
            path: None,
            content: String::new(),
            mtime: None,
        }),
    }
}

/// Reveal the window now that the editor has painted.
#[tauri::command]
pub fn ready(window: WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

#[tauri::command]
pub fn read_file(path: String) -> Result<Doc, String> {
    let path = PathBuf::from(path);
    Ok(Doc {
        content: windows::read_or_empty(&path)?,
        mtime: windows::mtime_ms(&path),
        path: Some(path.to_string_lossy().into_owned()),
    })
}

/// Write via a sibling temp file plus rename so an interrupted save cannot
/// leave a truncated document behind. Symlinks are resolved first so we
/// replace the target rather than the link, and the original mode is kept.
#[tauri::command]
pub fn save_file(
    window: WebviewWindow,
    state: State<AppState>,
    path: String,
    content: String,
) -> Result<Saved, String> {
    let path = windows::normalize(Path::new(&path));
    let dir = path.parent().ok_or("file has no parent directory")?;

    let tmp = dir.join(format!(
        ".{}.foglio-tmp",
        path.file_name().unwrap_or_default().to_string_lossy()
    ));

    std::fs::write(&tmp, content.as_bytes()).map_err(|e| format!("{}: {e}", tmp.display()))?;

    if let Ok(meta) = std::fs::metadata(&path) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }

    if let Err(e) = std::fs::rename(&tmp, &path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("{}: {e}", path.display()));
    }

    let mut docs = state.docs.lock().unwrap();
    docs.insert(
        window.label().to_owned(),
        DocState {
            path: Some(path.clone()),
            dirty: false,
        },
    );
    drop(docs);

    let _ = window.set_title(&windows::title_for(Some(&path)));
    crate::macos::set_document_edited(&window, false);

    Ok(Saved {
        mtime: windows::mtime_ms(&path),
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn set_dirty(window: WebviewWindow, state: State<AppState>, dirty: bool) {
    if let Some(doc) = state.docs.lock().unwrap().get_mut(window.label()) {
        doc.dirty = dirty;
    }
    crate::macos::set_document_edited(&window, dirty);
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    windows::open_path(&app, PathBuf::from(path))
}

/// Cheap external-change check, run when a window regains focus.
#[tauri::command]
pub fn stat_mtime(path: String) -> Option<u64> {
    windows::mtime_ms(Path::new(&path))
}

/// Close without re-triggering the frontend's unsaved-changes prompt.
#[tauri::command]
pub fn force_close(window: WebviewWindow) {
    let _ = window.destroy();
}

/// The frontend resolves "system" itself, so it only needs the stored choice.
#[tauri::command]
pub fn appearance_mode(app: AppHandle) -> String {
    crate::appearance::load(&app).as_str().to_string()
}
