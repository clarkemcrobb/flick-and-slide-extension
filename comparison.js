/**
 * Flick and Slide – Comparison window page script
 * Runs in a dedicated Chrome window (comparison.html).
 */

'use strict';

const FAS_GET_COMPARISON = 'FAS_GET_COMPARISON';
const FAS_CLOSE_COMPARISON = 'FAS_CLOSE_COMPARISON';
const FAS_RESIZE_COMPARISON = 'FAS_RESIZE_COMPARISON';
const FAS_REQUEST_SOURCE_PICK = 'FAS_REQUEST_SOURCE_PICK';

const state = {
  imageA: null,
  imageB: null,
  imageSource: null,
  mode: 'flick',
  flickSide: 'A',
  viewSize: 'normal',
  sliderPct: 50,
  sliderDragging: false,
  /** @type {'fill'|'original'} Default: fill available frame as large as aspect ratio allows */
  imageFit: 'fill',
  /** User dismissed the full AR mismatch modal for this slider visit */
  arWarningDismissed: false,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function attachImageFallback(img, label) {
  if (!img) return;
  img.addEventListener('error', function onErr() {
    img.removeEventListener('error', onErr);
    img.alt = (label || 'Image') + ' could not be loaded';
    img.style.opacity = '0.4';
  });
}

function $(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  const el = $('status');
  if (!el) return;
  if (text) {
    el.hidden = false;
    el.textContent = text;
  } else {
    el.hidden = true;
  }
}

function closeWindow() {
  // Prefer service-worker close so source tab is notified cleanly.
  chrome.runtime.sendMessage({ type: FAS_CLOSE_COMPARISON }, () => {
    // Fallback if message fails
    try {
      window.close();
    } catch (_) {}
  });
}

/** Close comparison temporarily so the user can pick a source image (A/B kept). */
function requestSourcePick() {
  chrome.runtime.sendMessage({ type: FAS_REQUEST_SOURCE_PICK }, () => {
    try {
      window.close();
    } catch (_) {}
  });
}

const MODE_TITLES = {
  flick: 'Flick Between Images – A vs B',
  slider: 'Comparison Slider – A vs B',
  side: 'Side by Side – A vs B',
};

/**
 * Common aspect ratios to snap to (order does not matter; closest match wins).
 * Includes landscape, portrait, and cinematic standards.
 */
const COMMON_ASPECT_RATIOS = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [21, 9],
  [18, 9],
  [2, 1],
  [5, 3],
  [3, 1],
  [4, 5],
  [3, 4],
  [2, 3],
  [10, 16],
  [9, 16],
  [9, 21],
  [9, 18],
  [1, 2],
];

/** Relative difference above this → “significantly different” for slider warning */
const AR_SIGNIFICANT_DIFF = 0.08;

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

/**
 * Snap natural dimensions to the nearest common aspect ratio label.
 * Falls back to a reduced integer fraction if nothing is reasonably close.
 * @returns {{ w: number, h: number, label: string, ratio: number }|null}
 */
function nearestAspectRatio(naturalW, naturalH) {
  const w = Number(naturalW) || 0;
  const h = Number(naturalH) || 0;
  if (w < 1 || h < 1) return null;

  const actual = w / h;
  let best = null;
  let bestScore = Infinity;

  for (let i = 0; i < COMMON_ASPECT_RATIOS.length; i++) {
    const aw = COMMON_ASPECT_RATIOS[i][0];
    const ah = COMMON_ASPECT_RATIOS[i][1];
    const cand = aw / ah;
    // Log-space distance is scale-invariant and treats 16:9 vs 9:16 fairly
    const score = Math.abs(Math.log(actual / cand));
    if (score < bestScore) {
      bestScore = score;
      best = { w: aw, h: ah, ratio: cand };
    }
  }

  // If very far from every common ratio (~>8% linear), use reduced exact fraction
  if (!best || bestScore > 0.08) {
    const g = gcd(w, h);
    let rw = Math.round(w / g);
    let rh = Math.round(h / g);
    // Keep labels readable
    if (rw > 50 || rh > 50) {
      const scale = 50 / Math.max(rw, rh);
      rw = Math.max(1, Math.round(rw * scale));
      rh = Math.max(1, Math.round(rh * scale));
    }
    return { w: rw, h: rh, label: rw + ':' + rh, ratio: actual };
  }

  return {
    w: best.w,
    h: best.h,
    label: best.w + ':' + best.h,
    ratio: actual,
  };
}

function dimsForImageData(data, fallbackImg) {
  let w = data && data.naturalWidth ? data.naturalWidth : 0;
  let h = data && data.naturalHeight ? data.naturalHeight : 0;
  if ((!w || !h) && fallbackImg) {
    w = fallbackImg.naturalWidth || 0;
    h = fallbackImg.naturalHeight || 0;
  }
  return { w, h };
}

function formatArLine(side, data, fallbackImg) {
  const { w, h } = dimsForImageData(data, fallbackImg);
  const ar = nearestAspectRatio(w, h);
  if (!ar) return side + ' AR: —';
  return side + ' AR: ' + ar.label;
}

function aspectRatiosDifferSignificantly() {
  const a = dimsForImageData(state.imageA, $('slider-img-a') || $('flick-img'));
  const b = dimsForImageData(state.imageB, $('slider-img-b') || $('side-img-b'));
  if (!a.w || !a.h || !b.w || !b.h) return false;
  const rA = a.w / a.h;
  const rB = b.w / b.h;
  // Relative difference of ratios
  const rel = Math.abs(rA - rB) / Math.max(rA, rB);
  return rel >= AR_SIGNIFICANT_DIFF;
}

function updateAspectRatioUi() {
  const flickAr = $('flick-ar');
  const sideArA = $('side-ar-a');
  const sideArB = $('side-ar-b');

  const flickImg = $('flick-img');
  const sideImgA = $('side-img-a');
  const sideImgB = $('side-img-b');

  // Flick: show both A and B in the top-left of the stage
  if (flickAr) {
    const lineA = formatArLine('A', state.imageA, flickImg || sideImgA);
    const lineB = formatArLine('B', state.imageB, sideImgB || $('slider-img-b'));
    flickAr.innerHTML =
      '<span class="fas-ar-line--a">' +
      lineA +
      '</span><span class="fas-ar-line--b">' +
      lineB +
      '</span>';
    flickAr.hidden = false;
  }

  // Side by Side: one badge per panel
  if (sideArA) {
    const ar = nearestAspectRatio(
      dimsForImageData(state.imageA, sideImgA).w,
      dimsForImageData(state.imageA, sideImgA).h
    );
    sideArA.textContent = ar ? 'AR: ' + ar.label : 'AR: —';
    sideArA.hidden = false;
  }
  if (sideArB) {
    const ar = nearestAspectRatio(
      dimsForImageData(state.imageB, sideImgB).w,
      dimsForImageData(state.imageB, sideImgB).h
    );
    sideArB.textContent = ar ? 'AR: ' + ar.label : 'AR: —';
    sideArB.hidden = false;
  }

  // Source AR when present
  const sourceAr = $('source-ar');
  const sourceImg = $('source-img');
  if (sourceAr) {
    if (state.imageSource) {
      const dims = dimsForImageData(state.imageSource, sourceImg);
      const ar = nearestAspectRatio(dims.w, dims.h);
      sourceAr.textContent = ar ? 'AR: ' + ar.label : 'AR: -';
      sourceAr.hidden = false;
    } else {
      sourceAr.hidden = true;
    }
  }

  // Slider AR mismatch: modal first, then compact red bar after "Proceed anyway"
  updateArWarningDisplay();
}

function buildArWarningMessage() {
  const a = nearestAspectRatio(
    dimsForImageData(state.imageA, $('slider-img-a')).w,
    dimsForImageData(state.imageA, $('slider-img-a')).h
  );
  const b = nearestAspectRatio(
    dimsForImageData(state.imageB, $('slider-img-b')).w,
    dimsForImageData(state.imageB, $('slider-img-b')).h
  );
  const labelA = a ? a.label : '-';
  const labelB = b ? b.label : '-';
  return (
    'These images have different aspect ratios (Image A AR: ' +
    labelA +
    ', Image B AR: ' +
    labelB +
    '). The comparison slider may not align features fairly - try Flick or Side by Side instead.'
  );
}

/**
 * Modal (blocking, centre) until Proceed anyway; then solid red bar above the slider.
 */
function updateArWarningDisplay() {
  const modal = $('ar-warning-modal');
  const modalText = $('ar-warning-modal-text');
  const bar = $('ar-warning-bar');
  const significant =
    state.mode === 'slider' && aspectRatiosDifferSignificantly();

  if (!significant) {
    if (modal) modal.hidden = true;
    if (bar) {
      bar.hidden = true;
      bar.textContent = '';
    }
    return;
  }

  const message = buildArWarningMessage();

  if (state.arWarningDismissed) {
    // Minimised but still obvious
    if (modal) modal.hidden = true;
    if (bar) {
      bar.hidden = false;
      bar.textContent = message;
    }
  } else {
    // Full centre alert — cannot ignore without Proceed anyway
    if (bar) {
      bar.hidden = true;
      bar.textContent = '';
    }
    if (modal) {
      modal.hidden = false;
      if (modalText) modalText.textContent = message;
      const proceed = $('ar-warning-proceed');
      if (proceed) {
        window.setTimeout(() => {
          try {
            proceed.focus();
          } catch (_) {}
        }, 0);
      }
    }
  }
}

function proceedArWarning() {
  state.arWarningDismissed = true;
  updateArWarningDisplay();
}

function setMode(mode) {
  if (!MODE_TITLES[mode]) mode = 'flick';
  const prevMode = state.mode;
  state.mode = mode;

  // Re-show full modal each time user enters Slider with a mismatch
  if (mode === 'slider' && prevMode !== 'slider') {
    state.arWarningDismissed = false;
  }

  $('pane-flick').classList.toggle('is-visible', mode === 'flick');
  $('pane-slider').classList.toggle('is-visible', mode === 'slider');
  const paneSide = $('pane-side');
  if (paneSide) paneSide.classList.toggle('is-visible', mode === 'side');

  const titleText = MODE_TITLES[mode];
  const titleEl = $('panel-title');
  if (titleEl) titleEl.textContent = titleText;
  document.title = titleText;

  const sliderHint = $('slider-hint');
  if (sliderHint) {
    // Only relevant in slider mode
    sliderHint.hidden = mode !== 'slider';
  }

  // Fit toggle only applies to Flick and Side by Side
  const fitHint = $('fit-hint');
  if (fitHint) {
    fitHint.hidden = mode === 'slider';
  }

  document.querySelectorAll('#mode-tabs .fas-btn').forEach((btn) => {
    const active = btn.getAttribute('data-mode') === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  applyImageFit();
  updateAspectRatioUi();
}

/**
 * Apply fill-frame (default) or original-size display for Flick + Side by Side.
 * Slider always fills its frame and is unchanged by this.
 */
function applyImageFit() {
  const app = document.getElementById('app');
  if (!app) return;

  const isOriginal = state.imageFit === 'original';
  app.classList.toggle('is-fit-fill', !isOriginal);
  app.classList.toggle('is-fit-original', isOriginal);

  // Stage scroll when showing true original pixels that may exceed the frame
  document.querySelectorAll('.fas-flick__stage, .fas-side__stage').forEach((stage) => {
    stage.classList.toggle('is-original-fit', isOriginal);
  });

  // Set intrinsic dimensions for original mode so layout uses natural pixels
  const fitImgs = document.querySelectorAll('.fas-fit-img');
  fitImgs.forEach((img) => {
    if (isOriginal) {
      const nw = img.naturalWidth || 0;
      const nh = img.naturalHeight || 0;
      if (nw > 0 && nh > 0) {
        img.style.width = nw + 'px';
        img.style.height = nh + 'px';
      } else {
        img.style.width = 'auto';
        img.style.height = 'auto';
      }
    } else {
      img.style.width = '';
      img.style.height = '';
    }
  });

  updateFitHintText();
}

function updateFitHintText() {
  const fitHint = $('fit-hint');
  if (!fitHint || fitHint.hidden) return;
  if (state.imageFit === 'fill') {
    fitHint.textContent =
      'Showing the image filling the frame - click an image to return to original size';
  } else {
    fitHint.textContent =
      'Showing original size - click an image to fill the frame';
  }
}

function toggleImageFit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  // Only meaningful in flick / side modes
  if (state.mode === 'slider') return;
  state.imageFit = state.imageFit === 'fill' ? 'original' : 'fill';
  applyImageFit();
}

/** @type {number} Monotonic token so only the latest size click is treated as current. */
let viewSizeRequestId = 0;

function updateViewSizeButtons(size) {
  document.querySelectorAll('#view-toggles .fas-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-size') === size);
  });
}

/**
 * Always apply the clicked view size. Retries once if the service worker fails.
 * @param {string} size
 */
function setViewSize(size) {
  if (!size) return;
  // Accept "medium" as alias if ever used in markup
  if (size === 'medium') size = 'normal';

  state.viewSize = size;
  updateViewSizeButtons(size);

  const requestId = ++viewSizeRequestId;

  function send(attempt) {
    // A newer click supersedes this request
    if (requestId !== viewSizeRequestId) return;

    chrome.runtime.sendMessage(
      { type: FAS_RESIZE_COMPARISON, size },
      (response) => {
        if (requestId !== viewSizeRequestId) return;

        const err = chrome.runtime.lastError;
        const failed = !!(err || !response || !response.ok);

        if (failed) {
          console.warn(
            '[Flick and Slide] Resize attempt failed:',
            err && err.message,
            response && response.error
          );
          if (attempt < 2) {
            window.setTimeout(() => send(attempt + 1), 80);
          }
          return;
        }

        // Keep button highlight in sync with what we requested
        if (requestId === viewSizeRequestId) {
          state.viewSize = size;
          updateViewSizeButtons(size);
        }
      }
    );
  }

  send(1);
}

function applySliderPct(pct) {
  state.sliderPct = clamp(pct, 0, 100);
  const slider = $('slider');
  if (!slider) return;
  slider.style.setProperty('--fas-exposure', state.sliderPct + '%');
  slider.setAttribute('aria-valuenow', String(Math.round(state.sliderPct)));
}

function updateSliderFromEvent(e, root) {
  const rect = root.getBoundingClientRect();
  if (!rect.width) return;
  const x = e.clientX - rect.left;
  applySliderPct((x / rect.width) * 100);
}

/**
 * Show a specific side in Flick mode, or toggle if side is omitted.
 * @param {'A'|'B'|null|undefined} side
 */
function showFlickSide(side) {
  if (!state.imageA || !state.imageB) return;

  let next;
  if (side === 'A' || side === 'B') {
    next = side;
  } else {
    next = state.flickSide === 'A' ? 'B' : 'A';
  }
  if (next === state.flickSide) return;

  const data = next === 'A' ? state.imageA : state.imageB;
  const flickImg = $('flick-img');
  const flickLabel = $('flick-label');
  const swapBtn = $('btn-swap');

  flickImg.classList.add('is-fading');
  window.setTimeout(() => {
    flickImg.src = data.src;
    flickImg.alt = 'Image ' + next;
    flickImg.classList.remove('is-fading');
    // Keep fill/original sizing consistent after swap
    if (state.imageFit === 'original') {
      const applyNat = () => applyImageFit();
      if (flickImg.complete && flickImg.naturalWidth) applyNat();
      else flickImg.addEventListener('load', applyNat, { once: true });
    }
  }, 50);

  state.flickSide = next;
  flickLabel.textContent = 'Image ' + next;
  flickLabel.setAttribute('data-side', next);
  swapBtn.textContent = 'Swap to Image ' + (next === 'A' ? 'B' : 'A');
}

function swapFlick() {
  showFlickSide(null);
}

function wireSlider() {
  const root = $('slider');
  if (!root) return;

  const onPointerDown = (e) => {
    e.preventDefault();
    state.sliderDragging = true;
    try {
      root.setPointerCapture(e.pointerId);
    } catch (_) {}
    updateSliderFromEvent(e, root);
    document.body.style.userSelect = 'none';
  };

  const onPointerMove = (e) => {
    if (!state.sliderDragging) return;
    e.preventDefault();
    updateSliderFromEvent(e, root);
  };

  const onPointerUp = (e) => {
    if (!state.sliderDragging) return;
    state.sliderDragging = false;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch (_) {}
    document.body.style.userSelect = '';
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);
  root.addEventListener('pointercancel', onPointerUp);

  root.addEventListener('keydown', (e) => {
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -2;
    if (e.key === 'ArrowRight') delta = 2;
    if (!delta) return;
    e.preventDefault();
    applySliderPct(state.sliderPct + delta);
  });
}


/**
 * Show/hide left source column in Flick mode and wire source image.
 */
function applySourceLayout() {
  const root = $('flick-root');
  const sourcePane = $('flick-source');
  const sourceImg = $('source-img');
  const btnSource = $('btn-source');
  const hasSource = !!(state.imageSource && state.imageSource.src);

  if (root) root.classList.toggle('has-source', hasSource);
  if (sourcePane) sourcePane.hidden = !hasSource;

  if (sourceImg && hasSource) {
    sourceImg.src = state.imageSource.src;
    sourceImg.alt = 'Source image';
    attachImageFallback(sourceImg, 'Source image');
  }

  if (btnSource) {
    btnSource.textContent = hasSource ? 'Change source image' : 'Add a source image';
  }

  // Source AR badge
  const sourceAr = $('source-ar');
  if (sourceAr) {
    if (hasSource) {
      const dims = dimsForImageData(state.imageSource, sourceImg);
      const ar = nearestAspectRatio(dims.w, dims.h);
      sourceAr.textContent = ar ? 'AR: ' + ar.label : 'AR: -';
      sourceAr.hidden = false;
    } else {
      sourceAr.hidden = true;
    }
  }
}

function loadImages(comparison) {
  state.imageA = comparison.imageA;
  state.imageB = comparison.imageB;
  state.imageSource = comparison.imageSource || null;

  const flickImg = $('flick-img');
  const imgA = $('slider-img-a');
  const imgB = $('slider-img-b');
  const sideA = $('side-img-a');
  const sideB = $('side-img-b');
  const sourceImg = $('source-img');

  flickImg.src = state.imageA.src;
  imgA.src = state.imageA.src;
  imgB.src = state.imageB.src;
  if (sideA) sideA.src = state.imageA.src;
  if (sideB) sideB.src = state.imageB.src;

  attachImageFallback(flickImg, 'Image A');
  attachImageFallback(imgA, 'Image A');
  attachImageFallback(imgB, 'Image B');
  if (sideA) attachImageFallback(sideA, 'Image A');
  if (sideB) attachImageFallback(sideB, 'Image B');

  applySourceLayout();
  if (sourceImg && state.imageSource) {
    // Already set in applySourceLayout; ensure fit-img click wired once via wireUi
  }

  state.flickSide = 'A';
  state.imageFit = 'fill';
  $('flick-label').textContent = 'Image A';
  $('flick-label').setAttribute('data-side', 'A');
  $('btn-swap').textContent = 'Swap to Image B';
  applySliderPct(50);
  setMode('flick');

  // Re-apply fit + AR once natural dimensions are known
  const fitImgs = [
    $('flick-img'),
    $('source-img'),
    $('side-img-a'),
    $('side-img-b'),
    $('slider-img-a'),
    $('slider-img-b'),
  ].filter(Boolean);
  let pending = fitImgs.length;
  const onReady = () => {
    pending -= 1;
    // Refresh dims from loaded imgs into state when available
    if (state.imageA && $('flick-img') && $('flick-img').naturalWidth) {
      state.imageA.naturalWidth = $('flick-img').naturalWidth;
      state.imageA.naturalHeight = $('flick-img').naturalHeight;
    }
    // side/slider A may have more accurate dims for A
    const imgA = $('side-img-a') || $('slider-img-a');
    if (state.imageA && imgA && imgA.naturalWidth) {
      state.imageA.naturalWidth = imgA.naturalWidth;
      state.imageA.naturalHeight = imgA.naturalHeight;
    }
    const imgB = $('side-img-b') || $('slider-img-b');
    if (state.imageB && imgB && imgB.naturalWidth) {
      state.imageB.naturalWidth = imgB.naturalWidth;
      state.imageB.naturalHeight = imgB.naturalHeight;
    }
    applyImageFit();
    updateAspectRatioUi();
  };
  fitImgs.forEach((img) => {
    if (img.complete && img.naturalWidth) onReady();
    else {
      img.addEventListener('load', onReady, { once: true });
      img.addEventListener('error', onReady, { once: true });
    }
  });

  applyImageFit();
  updateAspectRatioUi();
  setStatus(null);
}

function wireUi() {
  $('btn-close').addEventListener('click', () => closeWindow());
  $('btn-reset').addEventListener('click', () => closeWindow());
  $('btn-swap').addEventListener('click', () => swapFlick());

  const btnSource = $('btn-source');
  if (btnSource) {
    btnSource.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestSourcePick();
    });
  }

  document.querySelectorAll('#view-toggles .fas-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const size = btn.getAttribute('data-size');
      if (size) setViewSize(size);
    });
  });

  document.querySelectorAll('#mode-tabs .fas-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.getAttribute('data-mode')));
  });

  // Click image to toggle fill frame ↔ original size (Flick + Side by Side)
  document.querySelectorAll('.fas-fit-img').forEach((img) => {
    img.addEventListener('click', toggleImageFit);
  });

  const proceedBtn = $('ar-warning-proceed');
  if (proceedBtn) {
    proceedBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      proceedArWarning();
    });
  }

  // Backdrop does not dismiss — user must click Proceed anyway
  const modal = $('ar-warning-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      // Only block interaction; do not close on backdrop click
      if (e.target && e.target.classList && e.target.classList.contains('fas-ar-modal__backdrop')) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  wireSlider();

  document.addEventListener('keydown', (e) => {
    // F11 → full screen (same as the Full Screen button)
    if (e.key === 'F11') {
      e.preventDefault();
      setViewSize('fullscreen');
      return;
    }

    // Flick mode: either arrow key toggles A ↔ B (no directionality)
    if (state.mode === 'flick' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      swapFlick();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      // If full screen, first exit to maximised/normal rather than closing.
      if (state.viewSize === 'fullscreen') {
        setViewSize('normal');
        return;
      }
      closeWindow();
    }
  });
}

function init() {
  wireUi();
  setStatus('Loading images…');

  chrome.runtime.sendMessage({ type: FAS_GET_COMPARISON }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('Could not load comparison data. Close this window and try again.');
      return;
    }
    if (!response || !response.ok || !response.comparison) {
      setStatus('No images to compare. Close this window and select two images again.');
      return;
    }
    try {
      loadImages(response.comparison);
    } catch (err) {
      console.error(err);
      setStatus('Failed to display images.');
    }
  });
}

init();
