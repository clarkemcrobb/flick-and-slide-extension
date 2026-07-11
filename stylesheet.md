# Flick and Slide – Stylesheet Guide

This document is the **design system** for the extension UI. The runtime implementation lives in `content.css`. Future iterations should keep tokens and class names in sync between this file and `content.css`.

All classes are prefixed with **`fas-`** (Flick and Slide) to avoid collisions with host page styles.

---

## CSS custom properties

Defined on `:root` in `content.css`.

### Colours

| Variable | Default | Role |
|----------|---------|------|
| `--fas-bg` | `#0d1117` | Panel / deep background |
| `--fas-surface` | `#161b22` | Header, footer, banner surface |
| `--fas-surface-elevated` | `#1c2330` | Buttons, elevated chips |
| `--fas-border` | `#30363d` | Primary borders |
| `--fas-border-subtle` | `#21262d` | Soft dividers / stage borders |
| `--fas-text` | `#e6edf3` | Primary text |
| `--fas-text-muted` | `#8b949e` | Secondary text |
| `--fas-text-dim` | `#6e7681` | Tertiary / disabled feel |
| `--fas-accent` | `#58a6ff` | Hover outlines, focus, B accent |
| `--fas-accent-hover` | `#79b8ff` | Accent hover |
| `--fas-accent-a` | `#3fb950` | Image A selection / labels |
| `--fas-accent-a-soft` | `rgba(63, 185, 80, 0.2)` | Soft A glow |
| `--fas-accent-b` | `#58a6ff` | Image B selection / labels |
| `--fas-accent-b-soft` | `rgba(88, 166, 255, 0.2)` | Soft B glow |
| `--fas-danger` | `#f85149` | Close hover danger |
| `--fas-danger-hover` | `#ff7b72` | Danger hover |
| `--fas-focus-ring` | `rgba(88, 166, 255, 0.45)` | Focus rings |

### Typography

| Variable | Default |
|----------|---------|
| `--fas-font` | System sans stack (`-apple-system`, `Segoe UI`, `Roboto`, …) |
| `--fas-font-mono` | System mono stack |

### Spacing

| Variable | Value |
|----------|-------|
| `--fas-space-1` | `4px` |
| `--fas-space-2` | `8px` |
| `--fas-space-3` | `12px` |
| `--fas-space-4` | `16px` |
| `--fas-space-5` | `20px` |
| `--fas-space-6` | `24px` |
| `--fas-space-8` | `32px` |

### Radii & shadows

| Variable | Value |
|----------|-------|
| `--fas-radius-sm` | `6px` |
| `--fas-radius-md` | `10px` |
| `--fas-radius-lg` | `14px` |
| `--fas-radius-pill` | `999px` |
| `--fas-shadow-sm` | Soft small elevation |
| `--fas-shadow-md` | Medium (banner, FAB) |
| `--fas-shadow-lg` | Large (panel) |

### Z-index ladder

| Variable | Value | Layer |
|----------|-------|--------|
| `--fas-z-badge` | `2147482900` | A/B badges over page images |
| `--fas-z-banner` | `2147483000` | Top selection banner |
| `--fas-z-fab` | `2147483100` | Compare Images button |
| `--fas-z-panel` | `2147483200` | Comparison window |

### Slider runtime variable

| Variable | Role |
|----------|------|
| `--fas-exposure` | Horizontal split position (`0%`–`100%`). Set by JS on `.fas-slider`. Left of handle = Image A (via `clip-path`). |

### Motion

| Variable | Value |
|----------|-------|
| `--fas-transition` | `120ms ease` |

Honours `prefers-reduced-motion: reduce` (animations/transitions disabled).

---

## Class catalogue

### Selection – page images

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-selectable` | `img` | Temporary selectable state; pointer cursor; transparent outline ready for hover |
| `.fas-selectable:hover` | `img` | Subtle blue outline + soft glow |
| `.fas-selected-a` | `img` | Green border for Image A |
| `.fas-selected-b` | `img` | Blue border for Image B |
| `.fas-badge` | `div` | Absolute/fixed letter badge over selected image |
| `.fas-badge--a` | `div` | Green “A” badge |
| `.fas-badge--b` | `div` | Blue “B” badge |

### Banner

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-banner` | `div` | Fixed top-center pill: “Select the two images to compare” |

### Floating action button

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-fab` | `button` | Bottom-right pill: “Compare Images” |

### Comparison panel shell

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-panel` | `div` | Fixed floating dialog shell |
| `.fas-panel--small` | modifier | ~600×400 |
| `.fas-panel--normal` | modifier | ~900×600 |
| `.fas-panel--maximised` | modifier | ~90vw × 90vh |
| `.fas-panel__header` | `div` | Draggable top bar |
| `.fas-panel__header-left` | `div` | Close control cluster |
| `.fas-panel__header-right` | `div` | View toggles + mode tabs |
| `.fas-panel__title` | `div` | “Image Comparison – A vs B” |
| `.fas-panel__body` | `div` | Main content region |
| `.fas-panel__footer` | `div` | Labels + reset action |
| `.fas-panel__footer-labels` | `div` | “Image A” / “Image B” colour-coded text |

### Buttons & chrome

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-btn` | `button` | Base button |
| `.fas-btn--close` | `button` | × close control |
| `.fas-btn--primary` | `button` | Primary CTA (swap) |
| `.fas-btn--ghost` | `button` | Secondary/footer action |
| `.fas-btn.is-active` | state | Active toggle / tab |
| `.fas-view-toggles` | `div` | Small / Normal / Maximised group |
| `.fas-mode-tabs` | `div` | Flick / Slider tab group |

### Flick mode

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-mode-pane` | `div` | Mode container (hidden by default) |
| `.fas-mode-pane.is-visible` | state | Shown mode |
| `.fas-flick` | `div` | Flick layout column |
| `.fas-flick__stage` | `div` | Image stage (letterboxed) |
| `.fas-flick__img` | `img` | Currently displayed image |
| `.fas-flick__img.is-fading` | state | ~100 ms crossfade helper |
| `.fas-flick__label` | `div` | “Image A” / “Image B” |
| `.fas-flick__controls` | `div` | Label + swap button stack |

### Comparison slider

| Class | Element | Purpose |
|-------|---------|---------|
| `.fas-slider` | `div` | Slider root; sets `--fas-exposure` |
| `.fas-slider__layer` | `div` | Full-bleed image layer |
| `.fas-slider__layer--a` | `div` | Clipped Image A (left) |
| `.fas-slider__layer--b` | `div` | Full Image B (right underlay) |
| `.fas-slider__handle` | `div` | Vertical handle track at exposure |
| `.fas-slider__line` | `div` | White divider line |
| `.fas-slider__grip` | `div` | Circular grip control |
| `.fas-slider__grip-label` | `div` | “Drag to compare” |

---

## Slider technique (reference)

Adapted from [sneas/img-comparison-slider](https://github.com/sneas/img-comparison-slider) without dependencies:

1. Stack two absolutely positioned layers of **identical size**.
2. Bottom layer = Image B (full).
3. Top layer = Image A with  
   `clip-path: inset(0 calc(100% - var(--fas-exposure)) 0 0)`  
   so the left portion shows A and the right reveals B.
4. Handle positioned at `left: var(--fas-exposure)`.
5. Pointer events update exposure from `clientX` relative to the slider bounding rect (0–100%).

Both images use `object-fit: contain` inside the same container so rendered pixel bounds match for fair comparison.

---

## Copy & capitalisation (must match UI)

| Location | Exact string |
|----------|--------------|
| Banner | Select the two images to compare |
| FAB | Compare Images |
| Panel title | Image Comparison – A vs B |
| Close tooltip | Close comparison tool |
| Mode tab | Flick Between Images |
| Mode tab | Comparison Slider |
| Swap button | Swap to Image A / Swap to Image B |
| View toggles | Small, Normal, Maximised |
| Grip label | Drag to compare |
| Footer labels | Image A, Image B |
| Footer action | Reset & Return to Selection |

---

## Accessibility notes

- Interactive controls use real `<button>` elements.
- Close button has `title` and `aria-label`.
- Slider exposes `role="slider"` and `aria-valuenow`.
- Focus-visible outlines use accent blue.
- Banner uses `role="status"` + `aria-live="polite"`.

---

## Theme

**Dark theme only** in v1.0. Soft shadows, rounded corners, system sans-serif. No light-theme toggle yet.

---

## v2.0 UI notes

### Comparison window (comparison.css)
- Full-window app shell (`.fas-app`), not injected into the host page.
- View sizes: Small / Medium / Maximised / Full Screen (OS window states via background).
- Flick with source: `.fas-flick.has-source` → left `.fas-flick__source`, right `.fas-flick__main`.
- Fit modes: `.is-fit-fill` / `.is-fit-original` on `.fas-app` (cursor zoom-out when filled, zoom-in when original).
- AR badges: `.fas-ar-badge`; slider mismatch modal `.fas-ar-modal` + bar `.fas-ar-warning--bar`.

### Page selection (content.css)
- Rings: `.fas-ring--a` (green), `.fas-ring--b` (blue), `.fas-ring--s` (amber source).
- Badges: `.fas-badge--a|b|s`.
- Banner: `.fas-banner` + `.fas-banner__close` (Close tool / Cancel).
- Tokens: `--fas-accent-s` / `--fas-accent-s-soft` for source.

### Copy (user-facing)
| Location | Text |
|----------|------|
| Banner | Select the two images to compare |
| Source pick banner | Select a source image (A and B stay selected) |
| FAB | Compare Images |
| Flick source button | Add a source image / Change source image |
| Fit hint (fill) | Showing the image filling the frame - click an image to return to original size |
| Fit hint (original) | Showing original size - click an image to fill the frame |
| Close footer | Close tool |
| AR badge | AR: 16:9 (example) |
