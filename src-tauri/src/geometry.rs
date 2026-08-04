//! Window sizing. Every document window should open at the size you last used,
//! which is one remembered size rather than a per-window record — document
//! windows are interchangeable and their labels are not stable across launches.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const DEFAULT_WIDTH: f64 = 900.0;
pub const DEFAULT_HEIGHT: f64 = 720.0;
pub const MIN_WIDTH: f64 = 420.0;
pub const MIN_HEIGHT: f64 = 300.0;

/// Each new window steps down-right from the last, the way macOS document
/// apps do, so a second document is never hidden behind the first. The cascade
/// restarts after this many steps rather than marching off the screen.
pub const CASCADE_STEP: f64 = 26.0;
pub const CASCADE_WRAP: usize = 8;

#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

impl Default for Size {
    fn default() -> Self {
        Size {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
        }
    }
}

impl Size {
    /// Guards against a corrupt or stale file leaving an unusable window.
    fn sane(self) -> Option<Self> {
        let ok = self.width >= MIN_WIDTH
            && self.height >= MIN_HEIGHT
            && self.width <= 20_000.0
            && self.height <= 20_000.0;
        ok.then_some(self)
    }
}

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("window.json"))
}

pub fn load(app: &AppHandle) -> Size {
    file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<Size>(&raw).ok())
        .and_then(Size::sane)
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, size: Size) {
    let Some(path) = file(app) else { return };
    let Some(size) = size.sane() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(raw) = serde_json::to_string(&size) {
        let _ = std::fs::write(path, raw);
    }
}
