# Flick and Slide

**Flick and Slide** is a Chrome extension (Manifest V3) that lets you select any two images on a webpage and compare them instantly in a floating window.

- **Flick mode** – quick swap between Image A and Image B for pixel-perfect visual diffing (same display size, zero lag).
- **Comparison Slider** – classic before/after overlay with a smooth, touch-friendly vertical handle.

No frameworks, no external libraries, no network calls. Vanilla JavaScript + CSS only.

---

## Aims

1. Make side-by-side visual QA of any two page images as fast as two clicks.
2. Prefer fair comparison: both images always share the same rendered box (`object-fit: contain`).
3. Stay lightweight: inject only when the user activates the tool; clean up completely on exit.
4. Stay maintainable: design tokens and class names are documented in `stylesheet.md`; changes are recorded in `logbook.md`.

Similar tools that inspired this project include PixelParallel-style overlay comparison and vanilla slider patterns from [sneas/img-comparison-slider](https://github.com/sneas/img-comparison-slider) (adapted with no dependencies).

---

## Features

| Feature | Detail |
|---------|--------|
| Toolbar activation | Click the extension icon to enter selection mode on the current tab |
| Image selection | Hover outline → click Image A (green) → click Image B (blue) |
| Deselect | Click a selected image again; if both are cleared, the tool deactivates |
| Compare FAB | “Compare Images” pill appears bottom-right once A and B are set |
| Flick mode | One image at a time + “Swap to Image X” |
| Slider mode | Left = A, right = B, draggable handle (“Drag to compare”) |
| View sizes | Small (~600×400), Normal (~900×600), Maximised (90% viewport) |
| Draggable panel | Drag the header to reposition |
| Keyboard | `Esc` closes window or exits selection; `C` opens compare when ready |
| Cleanup | All injected DOM, classes, and listeners are removed on deactivate |

---

## Installation (load unpacked)

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this folder (`flick-and-slide-extension`).
5. Pin the extension if you like; the icon appears in the toolbar.

---

## Usage

1. Open any normal webpage that contains images (not `chrome://` pages).
2. Click the **Flick and Slide** toolbar icon.
3. Read the banner: **Select the two images to compare**.
4. Click the first image (badge **A**, green border), then the second (badge **B**, blue border).
5. Click **Compare Images** (or press **C**).
6. Use **Flick Between Images** or **Comparison Slider**.
7. Resize with **Small / Normal / Maximised**.
8. Close with **×**, **Esc**, or **Reset & Return to Selection** (keeps selection mode active).
9. Deselect both images, or click the toolbar icon again, to fully exit.

---

## Architecture

```
Toolbar click
    → background.js (service worker)
        → insertCSS(content.css) + executeScript(content.js)
        → or sendMessage FAS_TOGGLE if already injected
    → content.js
        → selection UI (banner, highlights, badges, FAB)
        → comparison panel (flick + slider)
```

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, `activeTab` + `scripting`, no popup |
| `background.js` | `chrome.action.onClicked` → inject or toggle |
| `content.js` | All page DOM interaction and comparison UI |
| `content.css` | Dark theme UI (injected with the content script) |
| `icons/` | 48×48 and 128×128 toolbar icons |
| `stylesheet.md` | Design tokens + class catalogue |
| `logbook.md` | Version history for future iterations |

Selected image data (`src`, natural dimensions, element refs) is held **in memory only**. No `chrome.storage` and no base64 conversion unless the page already uses a data URL.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Esc` | Close comparison window if open; otherwise deactivate selection mode |
| `C` | Open comparison when both images are selected and the window is closed |

---

## Permissions

- **`activeTab`** – access the tab the user is on when they click the icon.
- **`scripting`** – inject the content script and CSS into that tab.

No broad host permissions are requested.

---

## Limitations (v1.0)

- Cross-origin **iframes**: images inside inaccessible iframes cannot be selected (browser security).
- Restricted URLs (`chrome://`, Chrome Web Store, etc.) cannot run content scripts.
- Dynamic SPAs: a `MutationObserver` marks new images while selection mode is active.
- Dark theme only.

---

## Development notes

- After editing files, open `chrome://extensions/` and click **Reload** on the extension card, then reload the test page (or re-click the icon).
- Prefer updating `stylesheet.md` when adding tokens or classes, then mirror in `content.css`.
- Append entries to `logbook.md` for each meaningful version.

---

## Version

**1.0.0** – Initial implementation per product specification (2026-07-10).
