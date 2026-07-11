# Flick and Slide

Chrome extension for comparing images on any webpage.

Pick two images, open them in a dedicated comparison window, and switch between **Flick**, **Side by Side**, and **Comparison Slider**. Optionally pin a third **source** image so you can check both versions against the same original.

Built with Manifest V3 and plain JavaScript/CSS — no frameworks.

---

## Features

- **Select on the page** — activate from the toolbar, click Image A then Image B (green and blue highlights)
- **Dedicated window** — move to another monitor; Small, Medium, Maximised, or Full Screen
- **Flick** — instant swap between A and B (button or arrow keys)
- **Source image** — keep a reference on the left while A and B flick on the right
- **Side by Side** — view A and B next to each other
- **Comparison Slider** — drag to compare overlays; warns when aspect ratios differ a lot
- **Fill or original size** — images fill the frame by default; click to toggle native size
- **Aspect ratio labels** — common ratios shown as badges (images are never stretched)
- **Check for updates** — right-click the toolbar icon (for unpacked installs)

---

## Install

This extension is loaded unpacked (not from the Chrome Web Store).

1. Download the repository (**Code → Download ZIP**) or clone it with Git.
2. Unzip if needed. Use the folder that contains `manifest.json`.
3. Open Chrome and go to `chrome://extensions/`.
4. Turn on **Developer mode**.
5. Click **Load unpacked** and select that folder.
6. Pin **Flick and Slide** to the toolbar if you like.

### Updating

Right-click the toolbar icon and choose **Check for updates…**, or download the latest files and click **Reload** on the extension card in `chrome://extensions/`.

Unpacked extensions do not update automatically; the update checker only tells you when a newer version is available on GitHub.

---

## How to use

1. Open a normal webpage that has images.
2. Click the **Flick and Slide** icon.
3. Click the first image (A), then the second (B).
4. Click **Compare Images**, or press **C**.
5. Choose a mode: **Flick Between Images**, **Comparison Slider**, or **Side by Side**.
6. In Flick mode you can **Add a source image**, then select a third image on the page for a fixed reference on the left.
7. Close the comparison window when you are done — the tool exits fully.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| **C** | Open comparison when A and B are selected |
| **←** / **→** | Switch between A and B in Flick mode |
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

**Current version:** 2.0.0 — see `logbook.md` for release notes.
