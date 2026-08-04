//! The macOS close-box "edited" dot. Tauri does not surface tao's
//! `set_is_document_edited`, so this reaches the NSWindow directly.

#[cfg(target_os = "macos")]
pub fn set_document_edited(window: &tauri::WebviewWindow, edited: bool) {
    use objc2::runtime::{AnyObject, Bool};

    let win = window.clone();
    let _ = window.run_on_main_thread(move || {
        let Ok(ptr) = win.ns_window() else { return };
        if ptr.is_null() {
            return;
        }
        unsafe {
            let ns_window = &*(ptr as *mut AnyObject);
            let _: () = objc2::msg_send![ns_window, setDocumentEdited: Bool::new(edited)];
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn set_document_edited(_window: &tauri::WebviewWindow, _edited: bool) {}
