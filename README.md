# ❏ Manifest

![Manifest](https://i.imgur.com/sdKEe3H.png)

A grid-based pinboard for note-taking. Click and drag anywhere to create a note, snap it to the grid set by your window size, then move, resize, or delete it. Notes persist to disk between sessions and the app works fully offline.

This is a personal macOS desktop build of [jonathontoon/manifest](https://github.com/jonathontoon/manifest), wrapped in a Tauri 2 shell with a theming engine, an opacity slider, and a transparent window so themes can reveal the desktop wallpaper beneath.

## Install

Download `Manifest_1.2.0_aarch64.dmg` from the [latest release](https://github.com/stephenmcgurrin/manifest/releases/latest), open it, and drag `Manifest.app` to `/Applications`.

Apple Silicon only.

### First launch

The app is signed ad-hoc rather than with a paid Apple Developer ID, so macOS blocks the first launch of a downloaded copy with "Apple could not verify Manifest is free of malware" (older releases of macOS word it "cannot be opened because Apple cannot check it for malicious software").

Dismiss the dialog, open **System Settings → Privacy & Security**, scroll to the note about Manifest being blocked, and click **Open Anyway**. Once only; subsequent launches are normal.

## Themes

Fourteen built-in presets: Light, Dark, the four Catppuccin variants (Latte, Frappé, Macchiato, Mocha), Dracula, Nord, Tokyo Night, Gruvbox (Dark and Light), Solarized (Dark and Light), and Rosé Pine.

Add or edit your own from the settings panel. An opacity slider on the background colour lets the desktop wallpaper show through.

Toggle the last-used theme with <kbd>Alt</kbd>+<kbd>T</kbd>.

## Privacy

No analytics. No server. No telemetry. All notes and theme data live on your own disk.

## Built with

Vanilla JS and SASS bundled with Parcel, wrapped in Tauri 2 (Rust).

## Licence

See [LICENSE](LICENSE).

## Acknowledgements

Built on the original [Manifest](https://github.com/jonathontoon/manifest) by Jonathon Toon, with grid-snapping logic by [bnjm](https://www.github.com/bnjm).
