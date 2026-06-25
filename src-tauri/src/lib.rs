use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use objc2::class;
                use objc2::msg_send;
                use objc2::runtime::AnyObject;

                // "backgroundColor": "#00000000" in tauri.conf.json already makes wry (via the
                // `transparent` cargo feature) disable the WKWebView's own background drawing:
                //   * private `drawsBackground = false` on the webview config
                //   * `underPageBackgroundColor = clearColor` (the default light-gray repaint layer)
                //   * `webview.setOpaque(false)` + `webview.setBackgroundColor(clear)`
                // That removes the gray that was visible behind translucent theme backgrounds in
                // both windowed and full-screen modes (see issue #3).
                //
                // Below we handle only the NSWindow-level chrome, which wry does not touch.
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(ns_window_ptr) = window.ns_window() {
                        unsafe {
                            let ns_window: &AnyObject = &*(ns_window_ptr as *const AnyObject);

                            // The window itself must be non-opaque with a transparent titlebar
                            // so the see-through WKWebView shows the desktop through it.
                            let _: () = msg_send![ns_window, setOpaque: false];
                            let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: true];

                            // Clear window background so macOS never paints a backdrop behind it.
                            // macOS fullscreen transitions can reset compositor state, so setting this
                            // explicitly keeps the backdrop clear in both windowed and fullscreen.
                            let clear_color: *mut AnyObject = msg_send![class!(NSColor), clearColor];
                            let _: () = msg_send![ns_window, setBackgroundColor: clear_color];
                        }
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
