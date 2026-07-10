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

## Install (Chrome – step by step)

This extension is **not** on the Chrome Web Store. You install it manually as an **unpacked** extension from this repository. It takes about two minutes.

### Part A — Download the extension folder

**Option 1: Download ZIP (easiest, no Git required)**

1. Open this repository in your browser:  
   **https://github.com/clarkemcrobb/flick-and-slide-extension**
2. Click the green **Code** button (near the top of the page, above the file list).
3. In the menu that opens, click **Download ZIP**.
4. When the download finishes, open your **Downloads** folder (or wherever your browser saves files).
5. Find the file named something like **`flick-and-slide-extension-main.zip`**.
6. **Unzip** it:
   - **macOS:** double-click the ZIP file.
   - **Windows:** right-click the ZIP → **Extract All…** → choose a location → **Extract**.
7. You should now have a folder named **`flick-and-slide-extension-main`** (or similar).  
   Open it and confirm you can see files such as `manifest.json`, `background.js`, `content.js`, and an `icons` folder.  
   **You will select this folder in Chrome** (the folder that *contains* `manifest.json`, not a parent folder and not a single file).

**Option 2: Clone with Git (if you already use Git)**

```bash
git clone https://github.com/clarkemcrobb/flick-and-slide-extension.git
cd flick-and-slide-extension
```

Use the `flick-and-slide-extension` folder that contains `manifest.json` in the steps below.

---

### Part B — Load the extension in Google Chrome

1. Open **Google Chrome**.
2. In the address bar, type exactly:  
   `chrome://extensions/`  
   then press **Enter**.  
   (Or: click the three-dot menu **⋮** → **Extensions** → **Manage extensions**.)
3. In the top-right of the Extensions page, turn **Developer mode** **ON** (the toggle should be blue/active).
4. A new row of buttons appears. Click **Load unpacked**.
5. In the file picker dialog:
   - Navigate to the folder you unzipped (or cloned) in Part A.
   - Select the folder that **directly contains** `manifest.json`  
     (e.g. `flick-and-slide-extension-main` or `flick-and-slide-extension`).
   - Click **Select** / **Open** (wording depends on your OS).
6. **Flick and Slide** should appear in your extensions list with its icon.
7. **Pin it to the toolbar (recommended):**
   - Click the puzzle-piece **Extensions** icon to the right of Chrome’s address bar.
   - Find **Flick and Slide**.
   - Click the **pin** icon so it stays visible on the toolbar.

You only need to do this once. Chrome will keep the extension until you remove it. If you move or rename the folder later, Chrome may disable the extension until you load it again from the new path.

---

### Part C — Quick check that it works

1. Open a normal website that has images (for example a news or shopping page).  
   Do **not** use `chrome://` pages or the Chrome Web Store — those cannot run extensions like this.
2. Click the **Flick and Slide** icon on the toolbar.
3. You should see a banner near the top: **Select the two images to compare**.
4. Click one image (green **A** badge), then another (blue **B** badge).
5. Click **Compare Images** (bottom-right) or press **C**.
6. A floating comparison window should open.

---

### Updating to a newer version

1. Download the latest ZIP again (or `git pull` if you cloned).
2. Replace your old folder with the new files (or unzip to a new folder).
3. Go to `chrome://extensions/`.
4. Find **Flick and Slide** and click the **Reload** (circular arrow) button on its card.  
   If you installed from a new folder path, remove the old entry and use **Load unpacked** again.
5. Refresh any open tabs you want to use the extension on.

---

### Troubleshooting

| Problem | What to try |
|---------|-------------|
| **Load unpacked** is missing | Turn **Developer mode** ON (top right of `chrome://extensions/`). |
| “Manifest file is missing or unreadable” | You selected the wrong folder. Select the folder that **contains** `manifest.json` (not the ZIP, not a parent Downloads folder only). |
| Icon does nothing / no banner | Reload the webpage, then click the icon again. Some pages (`chrome://`, Web Store) are blocked. |
| After you edit files, nothing changes | On `chrome://extensions/`, click **Reload** on the extension card, then reload the test page. |
| Extension shows errors after moving the folder | Load it again with **Load unpacked** from the new location. |

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
