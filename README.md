# Flick and Slide

Chrome extension for comparing **images or videos** on any webpage.

Pick two images or two videos, open them in a dedicated comparison window, and switch between **Flick**, **Side by Side**, and **Comparison Slider**. Optionally pin a third **source** so you can check both versions against the same original.

Built with Manifest V3 and plain JavaScript/CSS — no frameworks.

---

## Features

- **Images and videos** — select two of the same type (images or videos; mixing is not allowed)
- **Select on the page** — activate from the toolbar, click A then B (green and blue highlights)
- **Dedicated window** — move to another monitor; Small, Medium, Maximised, or Full Screen
- **Flick** — instant swap between A and B (button or arrow keys)
- **Source media** — keep a reference on the left while A and B flick on the right
- **Side by Side** — view A and B next to each other
- **Comparison Slider** — drag to compare overlays; warns when aspect ratios differ a lot
- **Synced video playback** — A and B (and source, if set) play from the start together; shorter clips hold at the end until the longest finishes, then all loop from zero
- **Compare to reference images** (video) — pick up to 10 stills from the page; flick references on the left and videos A/B on the right (← / →)
- **Video transport** — play/pause, mute, scrubber, and millisecond timestamps
- **Fill or original size** — media fills the frame by default; click to toggle native size
- **Aspect ratio labels** — common ratios shown as badges (media is never stretched)
- **Check for updates** — right-click the toolbar icon (for unpacked installs)

---

## Install

This extension is loaded unpacked (not from the Chrome Web Store).

1. Open the [**latest release**](https://github.com/clarkemcrobb/flick-and-slide-extension/releases/latest).
2. Download **`flick-and-slide.zip`**.
3. Unzip it. Use the `flick-and-slide` folder (it contains `manifest.json`).
4. Open Chrome and go to `chrome://extensions/`.
5. Turn on **Developer mode**.
6. Click **Load unpacked** and select the `flick-and-slide` folder.
7. Pin **Flick and Slide** to the toolbar if you like.

### Updating

1. Right-click the toolbar icon and choose **Check for updates…**.
2. If a newer version is available, download the latest zip from the [releases page](https://github.com/clarkemcrobb/flick-and-slide-extension/releases/latest).
3. Replace your extension folder with the new files (or load the new folder).
4. On `chrome://extensions/`, click **Reload** for Flick and Slide.

Unpacked extensions are not updated automatically by Chrome.

---

## How to use

1. Open a normal webpage that has images or HTML5 videos.
2. Click the **Flick and Slide** icon in your extensions toolbar dropdown, or pin it to your toolbar for one-click activation.
3. Click the first item (A), then the second (B). Both must be images **or** both must be videos.
4. Click **Compare**, or press **C**.
5. Choose a mode: **Flick**, **Comparison Slider**, **Side by Side**, or (for videos) **Compare to Reference Images**.
6. For videos, use the transport bar to play, pause, mute, or scrub (time is shown in milliseconds).
7. In Flick mode you can **Add a source** image or video (matching the type you selected), then pick a third item on the page for a fixed reference on the left.
8. In **Compare to Reference Images**, pick up to 10 stills from the page, then flick references on the left and videos A/B on the right (← / → keys).
9. Close the comparison window when you are done — the tool exits fully.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| **C** | Open comparison when A and B are selected |
| **←** / **→** | Switch between A and B in Flick mode |
| **Space** | Play or pause (video sessions) |
| **Esc** | Close the comparison window or leave selection mode |
| **F11** | Full screen the comparison window |

---

## Project layout

| Path | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Service worker: injection, window, updates |
| `content.js` / `content.css` | Page selection UI |
| `comparison.html` / `.js` / `.css` | Comparison window |
| `update-check.html` / `.js` | Update check UI |
| `stylesheet.md` | Style guide for contributors |
| `logbook.md` | Release history |

---

## Permissions

| Permission | Why |
|------------|-----|
| `activeTab`, `scripting` | Run on the current tab after you click the icon |
| `storage` | Hold comparison session data while the window is open |
| `contextMenus` | “Check for updates…” on the toolbar icon |
| GitHub hosts | Read the published version for the update check |

---

## License / contributing

Issues and pull requests are welcome on [GitHub](https://github.com/clarkemcrobb/flick-and-slide-extension).

**Current version:** 3.1.0 — see `logbook.md` for release notes.
