# Logbook

## v2.0.0 – Major image comparison release (2026-07-11)

Published image-focused feature set as 2.0.0. Video comparison not included yet.

### Distribution
- GitHub Release ships **`flick-and-slide.zip`** with runtime files only (no README/logbook/stylesheet).
- Full repo still has docs for the project page; install instructions point at the release zip.

### Comparison window
- Dedicated OS window (not in-page overlay): Small / Medium / Maximised / Full Screen
- Close via ×, Esc, footer Close tool, or OS/Chrome close fully exits the tool
- Modes: Flick, Comparison Slider, Side by Side

### Flick
- Swap button + left/right keys (both keys toggle A ↔ B)
- Optional **source image**: left pane fixed; A/B flick on the right
- Add / change source without losing A/B selection

### Selection
- Strict one A / one B; no double-select same visual
- Fixed border rings + A/B/S badges glued to images
- Banner with Close tool; source-pick banner with Cancel

### Display
- Default fill-frame; click to toggle original size (Flick / Side by Side)
- AR corner badges (nearest common ratio labels only — no image distortion)
- Slider AR mismatch: centre red modal → Proceed anyway → compact red bar (≥ 8%)

### Other
- Right-click toolbar icon → Check for updates… (GitHub version compare; manual update for unpacked)
- Extension-context-invalidated safety after Reload
- Files: comparison.html/js/css, update-check.html/js

## v1.0.1 – README install guide

- Expanded main README with step-by-step Load unpacked install instructions.

## v1.0 – Initial implementation per spec

- One-shot generation on 2026-07-10.
- MV3 dynamic inject; in-page floating panel; Flick + Slider; basic selection.
