# Flick and Slide

**v2.0.0** · Chrome extension (Manifest V3)

Select any two images on a webpage and compare them in a **dedicated Chrome window** (not trapped inside the page). Vanilla JS/CSS only — no frameworks.

**Repo:** https://github.com/clarkemcrobb/flick-and-slide-extension

---

## Features (v2.0)

| Area | What you get |
|------|----------------|
| **Selection** | Toolbar icon → pick Image **A** (green) then **B** (blue); re-click to deselect; strict one-A/one-B rules |
| **Compare window** | Opens as a real OS window — resize, maximise, full screen, drag to another monitor |
| **Flick** | Instant A ↔ B swap; button or **← / →** keys |
| **Source image** | Optional third image in Flick: fixed on the left while A/B flick on the right |
| **Side by Side** | A left, B right |
| **Comparison Slider** | Classic before/after drag; warning if aspect ratios differ by ≥ 8% |
| **Fit** | Default: fill the frame; click image to toggle original size (Flick / Side by Side) |
| **Aspect ratios** | Corner badges snap labels to common ratios (display only — images are never stretched) |
| **View sizes** | Small / Medium / Maximised / Full Screen |
| **Close** | ×, Esc, or OS window close fully exits the tool |
| **Updates** | Right-click toolbar icon → **Check for updates…** (compares with GitHub; manual install for unpacked) |

---

## Install (unpacked)

1. Download **Code → Download ZIP** from this repo (or `git clone`).
2. Unzip so you have a folder containing `manifest.json`.
3. Chrome → `chrome://extensions/` → enable **Developer mode**.
4. **Load unpacked** → select that folder.
5. Pin **Flick and Slide** to the toolbar.

### Update later

Right-click the toolbar icon → **Check for updates…**, or re-download the ZIP and **Reload** the extension on `chrome://extensions/`.

Unpacked extensions **cannot** auto-update; the checker only reports a newer GitHub version and how to install it.

---

## Usage

1. Open a normal webpage with images (not `chrome://` pages).
2. Click the extension icon → banner: *Select the two images to compare*.
3. Click image A, then image B → **Compare Images** (or press **C**).
4. Choose **Flick Between Images**, **Comparison Slider**, or **Side by Side**.
5. Optional (Flick): **Add a source image** → pick a third image on the page → window reopens with source on the left.
6. Close the comparison window to fully exit (clears selection and UI).

### Keyboard

| Key | Action |
|-----|--------|
| **C** | Open compare when A and B are selected |
| **← / →** | Flick A ↔ B (same action either key) |
| **Esc** | Close comparison (full exit), or cancel source pick, or exit selection |
| **F11** | Full screen comparison window |

---

## Architecture

```
Toolbar click → background.js injects content.js + content.css
Select A/B   → content.js (page UI)
Compare      → chrome.windows → comparison.html (Flick / Slider / Side by Side)
```

| File | Role |
|------|------|
| `manifest.json` | MV3, permissions |
| `background.js` | Inject, comparison window, update check, context menu |
| `content.js` / `content.css` | Selection mode on the page |
| `comparison.html` / `.js` / `.css` | Comparison UI window |
| `update-check.html` / `.js` | Update check results |
| `stylesheet.md` | Design tokens / class guide |
| `logbook.md` | Version history |

---

## Permissions

- **activeTab** / **scripting** — inject on the current tab after you click the icon  
- **storage** — session data for the comparison window  
- **contextMenus** — “Check for updates…” on the toolbar icon  
- **Host (GitHub)** — read remote `manifest.json` for version check only  

---

## Limitations

- Unpacked install only (not Chrome Web Store auto-update).
- Cross-origin iframes cannot be selected.
- Slider is a fair overlay only when aspect ratios are similar (warning at ≥ 8% difference).
- Images are never distorted; AR badges are labels only.
- **Video comparison is not included in v2.0** (planned later).

---

## Version

**2.0.0** — Dedicated comparison window, Side by Side, source image, AR tools, stricter selection, full exit on close, update checker.

See `logbook.md` for history.
