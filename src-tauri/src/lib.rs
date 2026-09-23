// macOS transparency contract — read this before re-adding any objc2 code here.
//
// This app runs `transparent: true` + `macOSPrivateApi: true`, and every piece of the
// AppKit/WebKit dance that transparency needs is already performed by the dependency
// stack. The `setup()` hook that used to live here duplicated some of it and papered
// over the rest with a scattergun `respondsToSelector:` loop over the content view's
// subviews, which was both redundant and the sort of private-API guesswork that breaks
// silently on an OS bump. Verified against tauri 2.11.6 / tauri-runtime-wry 2.11.4 /
// tao 0.35.3 / wry 0.55.1:
//
//   * NSWindow `setOpaque:NO` and `setBackgroundColor:[NSColor clearColor]`
//     — tao does both at window creation whenever `transparent` is set
//       (tao/src/platform_impl/macos/window.rs, the `win_attribs.transparent` branch).
//
//   * WKWebViewConfiguration private KVC key `drawsBackground = NO`
//     — wry does this when `transparent` OR `backgroundColor` is set, gated behind its
//       `transparent` cargo feature, which tauri's `macos-private-api` feature turns on
//       (tauri-runtime-wry enables `wry/transparent` + `wry/fullscreen`).
//
//   * WKWebView `underPageBackgroundColor` (public API, macOS 12+)
//     — this is the under-page / over-scroll repaint layer, and it is the light-grey
//       that used to sit between the desktop and a translucent theme background.
//       wry only sets it when a `backgroundColor` is supplied on the window config;
//       `transparent: true` alone does NOT reach it. Hence `"backgroundColor":
//       "#00000000"` in tauri.conf.json — the window config's colour is copied into the
//       webview attributes by tauri (`WebviewAttributes::from(&WindowConfig)`), so one
//       config key drives both the window and the webview layer.
//
//   * `titlebarAppearsTransparent = YES`
//     — expressed declaratively as `"titleBarStyle": "Overlay"`. Tauri's default
//       (`Visible`) already sets NSFullSizeContentView, so Overlay is exactly the old
//       manual `setTitlebarAppearsTransparent:` call with no layout change.
//
//   * The titlebar's "Manifest" text
//     — `"hiddenTitle": true` maps to `setTitleVisibility:NSWindowTitleHidden`, which
//       hides the drawn text while leaving the window's title string intact for the
//       accessibility label and the Window menu. Blanking `title` would have cost both.
//
// Nothing re-asserts on full-screen enter/exit, and nothing needs to: none of the four
// properties above is window-state dependent, and AppKit's native full-screen transition
// reparents the window into a new space without touching `isOpaque`, `backgroundColor`,
// or any WKWebView property. What *does* differ in full screen is the backdrop itself —
// a full-screen space composites no desktop wallpaper behind the window — and that is a
// platform behaviour, not something this process can override.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
