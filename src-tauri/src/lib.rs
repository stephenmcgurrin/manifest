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
                use objc2::msg_send;
                use objc2::sel;
                use objc2::runtime::AnyObject;

                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(ns_window_ptr) = window.ns_window() {
                        unsafe {
                            let ns_window: &AnyObject = &*(ns_window_ptr as *const AnyObject);

                            // 1. Make NSWindow non-opaque and clear its background
                            let _: () = msg_send![ns_window, setOpaque: false];
                            let _: () = msg_send![ns_window, setTitlebarAppearsTransparent: true];

                            // 2. Get the content view and make it layer-backed + clear
                            let content_view: *mut AnyObject = msg_send![ns_window, contentView];
                            let _: () = msg_send![content_view, setWantsLayer: true];
                            let layer: *mut AnyObject = msg_send![content_view, layer];
                            let _: () = msg_send![layer, setOpaque: false];

                            // 3. Find subviews that can be made transparent
                            let subviews: *mut AnyObject = msg_send![content_view, subviews];
                            let count: isize = msg_send![subviews, count];
                            for i in 0..count {
                                let subview: *mut AnyObject = msg_send![subviews, objectAtIndex: i];
                                let _: () = msg_send![subview, setOpaque: false];
                                // Only call setDrawsBackground: if the view responds to it
                                let responds: bool = msg_send![subview, respondsToSelector: sel!(setDrawsBackground:)];
                                if responds {
                                    let _: () = msg_send![subview, setDrawsBackground: false];
                                }
                            }
                        }
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
