# Logbook

## v1.0 – Initial implementation per spec

- One-shot generation on 2026-07-10.
- Manifest V3 service worker dynamically injects `content.css` + `content.js` on toolbar click.
- Selection mode: top banner, selectable page images, A/B badges and borders, deselect-to-deactivate.
- Floating comparison window: draggable header, Small / Normal / Maximised views.
- Modes: **Flick Between Images** (instant swap + short crossfade) and **Comparison Slider** (clip-path + pointer events, adapted from https://github.com/sneas/img-comparison-slider).
- Keyboard: Esc closes window / deactivates; C opens compare when both images are selected.
- Docs: `README.md`, `stylesheet.md`, this logbook.
- Icons: placeholder 48×48 and 128×128 PNG (frames + magnifying glass).
