//! The chosen appearance. Following macOS is the default; an explicit choice is
//! remembered across launches, alongside the window size.

use std::str::FromStr;

use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    #[default]
    System,
    Light,
    Dark,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::System => "system",
            Mode::Light => "light",
            Mode::Dark => "dark",
        }
    }

    /// The menu item id this mode is bound to.
    pub fn menu_id(self) -> &'static str {
        match self {
            Mode::System => "theme:system",
            Mode::Light => "theme:light",
            Mode::Dark => "theme:dark",
        }
    }

    pub const ALL: [Mode; 3] = [Mode::System, Mode::Light, Mode::Dark];
}

impl FromStr for Mode {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim() {
            "system" => Ok(Mode::System),
            "light" => Ok(Mode::Light),
            "dark" => Ok(Mode::Dark),
            _ => Err(()),
        }
    }
}

fn file(app: &AppHandle) -> Option<std::path::PathBuf> {
    Some(app.path().app_config_dir().ok()?.join("appearance"))
}

/// An unreadable or unrecognised file falls back to following the system, which
/// is always a reasonable appearance.
pub fn load(app: &AppHandle) -> Mode {
    file(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| raw.parse().ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, mode: Mode) {
    let Some(path) = file(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, mode.as_str());
}
