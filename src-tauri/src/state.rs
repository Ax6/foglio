use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::Mutex;

/// What a single document window is showing.
#[derive(Default, Clone)]
pub struct DocState {
    pub path: Option<PathBuf>,
    pub dirty: bool,
}

impl DocState {
    /// A window with no file and no unsaved edits can be recycled for an
    /// incoming open request instead of spawning another window.
    pub fn reusable(&self) -> bool {
        self.path.is_none() && !self.dirty
    }
}

#[derive(Default)]
pub struct AppState {
    /// window label -> document
    pub docs: Mutex<HashMap<String, DocState>>,
    /// Files handed to us before `RunEvent::Ready`, drained once windows can exist.
    pub pending: Mutex<Vec<PathBuf>>,
    pub counter: AtomicUsize,
    pub ready: AtomicBool,
    /// Size the next window opens at; persisted on exit.
    pub last_size: Mutex<crate::geometry::Size>,
    /// Where the first window landed, and how many steps the cascade has taken.
    pub cascade_origin: Mutex<Option<(f64, f64)>>,
    pub cascade_step: AtomicUsize,
}
