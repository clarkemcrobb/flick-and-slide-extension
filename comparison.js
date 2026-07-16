/**
 * Flick and Slide – Comparison window page script
 * Runs in a dedicated Chrome window (comparison.html).
 */

'use strict';

const FAS_GET_COMPARISON = 'FAS_GET_COMPARISON';
const FAS_CLOSE_COMPARISON = 'FAS_CLOSE_COMPARISON';
const FAS_RESIZE_COMPARISON = 'FAS_RESIZE_COMPARISON';
const FAS_REQUEST_SOURCE_PICK = 'FAS_REQUEST_SOURCE_PICK';
const FAS_REQUEST_REF_PICK = 'FAS_REQUEST_REF_PICK';

const state = {
  imageA: null,
  imageB: null,
  imageSource: null,
  /** @type {Array<{src:string,naturalWidth:number,naturalHeight:number,kind?:string}>} */
  referenceImages: [],
  refIndex: 0,
  /** @type {'image'|'video'} */
  mediaKind: 'image',
  mode: 'flick',
  flickSide: 'A',
  viewSize: 'normal',
  sliderPct: 50,
  sliderDragging: false,
  /** @type {'fill'|'original'} Default: fill available frame as large as aspect ratio allows */
  imageFit: 'fill',
  /** User dismissed the full AR mismatch modal for this slider visit */
  arWarningDismissed: false,
  videoMutedAll: false,
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

function requestRefPick() {
  chrome.runtime.sendMessage({ type: FAS_REQUEST_REF_PICK }, () => {
    try {
      window.close();
    } catch (_) {}
  });
}

function getModeTitles() {
  if (state.mediaKind === 'video') {
    return {
      flick: 'Flick Between Videos – A vs B',
      slider: 'Comparison Slider – A vs B',
      side: 'Side by Side – A vs B',
      refs: 'Compare to Reference Images – A vs B',
    };
  }
  return {
    flick: 'Flick Between Images – A vs B',
    slider: 'Comparison Slider – A vs B',
    side: 'Side by Side – A vs B',
    refs: 'Compare to Reference Images – A vs B',
  };
}

function nounA() {
  return state.mediaKind === 'video' ? 'Video A' : 'Image A';
}
function nounB() {
  return state.mediaKind === 'video' ? 'Video B' : 'Image B';
}
function nounSource() {
  return state.mediaKind === 'video' ? 'Source video' : 'Source image';
}


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

function dimsForImageData(data, fallbackEl) {
  let w = data && data.naturalWidth ? data.naturalWidth : 0;
  let h = data && data.naturalHeight ? data.naturalHeight : 0;
  if ((!w || !h) && fallbackEl) {
    if (fallbackEl.nodeName === 'VIDEO') {
      w = fallbackEl.videoWidth || 0;
      h = fallbackEl.videoHeight || 0;
    } else {
      w = fallbackEl.naturalWidth || 0;
      h = fallbackEl.naturalHeight || 0;
    }
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
  const titles = getModeTitles();
  if (!titles[mode]) mode = 'flick';
  const prevMode = state.mode;
  state.mode = mode;

  // Re-show full modal each time user enters Slider with a mismatch
  if (mode === 'slider' && prevMode !== 'slider') {
    state.arWarningDismissed = false;
  }

  // Video-only mode: entering without refs starts the pick flow
  if (mode === 'refs') {
    if (state.mediaKind !== 'video') {
      mode = 'flick';
    } else if (!state.referenceImages || state.referenceImages.length < 1) {
      requestRefPick();
      return;
    }
  }

  $('pane-flick').classList.toggle('is-visible', mode === 'flick');
  $('pane-slider').classList.toggle('is-visible', mode === 'slider');
  const paneSide = $('pane-side');
  if (paneSide) paneSide.classList.toggle('is-visible', mode === 'side');
  const paneRefs = $('pane-refs');
  if (paneRefs) paneRefs.classList.toggle('is-visible', mode === 'refs');

  const titleText = titles[mode];
  const titleEl = $('panel-title');
  if (titleEl) titleEl.textContent = titleText;
  document.title = titleText;

  // Mode tab labels for video
  const tabFlick = $('tab-flick');
  if (tabFlick) {
    tabFlick.textContent =
      state.mediaKind === 'video' ? 'Flick Between Videos' : 'Flick Between Images';
  }

  const sliderHint = $('slider-hint');
  if (sliderHint) {
    sliderHint.hidden = mode !== 'slider';
  }

  const isVideo = state.mediaKind === 'video';
  const fitHint = $('fit-hint');
  const fitHintVideo = $('fit-hint-video');
  if (fitHint) {
    // Image sessions: standalone hint under content (hidden in slider)
    fitHint.hidden = isVideo || mode === 'slider';
  }
  if (fitHintVideo) {
    fitHintVideo.hidden = !isVideo;
  }
  placeVideoChrome();

  const tabRefs = $('tab-refs');
  if (tabRefs) {
    tabRefs.hidden = state.mediaKind !== 'video';
  }

  if (mode === 'refs') {
    updateRefsView();
  }

  document.querySelectorAll('#mode-tabs .fas-btn').forEach((btn) => {
    const active = btn.getAttribute('data-mode') === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // When switching modes, keep video timeline but ensure visibility layers correct
  if (state.mediaKind === 'video') {
    updateVideoLayerVisibility();
    if (window.__fasVideoSync) {
      window.__fasVideoSync.refreshDurations();
      window.__fasVideoSync.applyMutePolicy();
    }
  }

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
  document
    .querySelectorAll('.fas-flick__stage, .fas-side__stage, .fas-refs__stage')
    .forEach((stage) => {
      stage.classList.toggle('is-original-fit', isOriginal);
    });

  // Set intrinsic dimensions for original mode so layout uses natural pixels
  document.querySelectorAll('.fas-fit-img').forEach((el) => {
    if (el.hidden) {
      el.style.width = '';
      el.style.height = '';
      return;
    }
    if (isOriginal) {
      let nw = 0;
      let nh = 0;
      if (el.nodeName === 'VIDEO') {
        nw = el.videoWidth || 0;
        nh = el.videoHeight || 0;
      } else {
        nw = el.naturalWidth || 0;
        nh = el.naturalHeight || 0;
      }
      if (nw > 0 && nh > 0) {
        el.style.width = nw + 'px';
        el.style.height = nh + 'px';
      } else {
        el.style.width = 'auto';
        el.style.height = 'auto';
      }
    } else {
      el.style.width = '';
      el.style.height = '';
    }
  });

  updateFitHintText();
}

function updateFitHintText() {
  const fillText =
    state.mediaKind === 'video'
      ? 'Showing the image filling the frame - click an image to return to original size'
      : 'Showing fill frame - scroll to zoom · drag to pan · click to toggle original · double-click resets zoom';
  const originalText =
    state.mediaKind === 'video'
      ? 'Showing original size - click an image to fill the frame'
      : 'Showing original size - scroll to zoom · drag to pan · click to fill frame · double-click resets zoom';
  const text = state.imageFit === 'fill' ? fillText : originalText;
  ['fit-hint', 'fit-hint-video'].forEach((id) => {
    const el = $(id);
    if (el) el.textContent = text;
  });
}


// ---------------------------------------------------------------------------
// Image zoom / pan (all image modes, including linked slider zoom)
// Scroll = zoom toward cursor · drag = pan when zoomed · double-click = reset
// ---------------------------------------------------------------------------

const ZOOM_MIN = 1;
const ZOOM_MAX = 12;
const ZOOM_STEP = 1.12;

/** Held for pan-while-zoomed on the slider (Space, like design tools). */
let zoomSpaceHeld = false;

/** @type {Map<string, ReturnType<typeof createZoomController>>} */
const zoomControllers = new Map();

/**
 * Should this pointer gesture pan the zoomed image?
 * Slider: left-drag always moves the split — pan with Space, Alt, or middle mouse.
 * Other modes: left-drag pans when zoomed.
 */
function wantsZoomPan(e, viewport, scale) {
  if (scale <= 1.001) return false;
  if (e.button === 1) return true; // middle mouse
  if (e.altKey || zoomSpaceHeld) return true;
  const id = viewport.getAttribute('data-zoom-id');
  // On the comparison slider, plain left-drag is reserved for the split
  if (id === 'slider') return false;
  return e.button === 0;
}

function createZoomController(viewport) {
  const layer = viewport.querySelector('[data-zoom-layer]');
  if (!layer) {
    return {
      getScale: () => 1,
      reset: () => {},
      destroy: () => {},
      isPanning: () => false,
      didPan: () => false,
    };
  }

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let panning = false;
  let panStartX = 0;
  let panStartY = 0;
  let originTx = 0;
  let originTy = 0;
  let moved = false;
  let enabled = true;

  function apply() {
    layer.style.transform =
      'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
    viewport.classList.toggle('is-zoomed', scale > 1.001);
    viewport.classList.toggle('is-panning', panning);
    // Hint on slider when zoomed
    if (viewport.getAttribute('data-zoom-id') === 'slider') {
      let hint = viewport.querySelector('.fas-zoom-hint');
      if (scale > 1.001) {
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'fas-zoom-hint';
          viewport.appendChild(hint);
        }
        hint.textContent =
          'Drag to move split · hold Space or Alt and drag to pan · scroll to zoom';
        hint.hidden = false;
      } else if (hint) {
        hint.hidden = true;
      }
    }
  }

  /** Map a screen point into the zoom layer's unscaled local coordinates. */
  function screenToLocal(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      x: (px - tx) / scale,
      y: (py - ty) / scale,
    };
  }

  function clampPan() {
    if (scale <= 1) {
      tx = 0;
      ty = 0;
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const limX = w * scale;
    const limY = h * scale;
    tx = Math.min(w * 0.5, Math.max(-limX + w * 0.5, tx));
    ty = Math.min(h * 0.5, Math.max(-limY + h * 0.5, ty));
  }

  function reset() {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  }

  function zoomAt(clientX, clientY, factor) {
    if (!enabled) return;
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cx = (px - tx) / scale;
    const cy = (py - ty) / scale;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale * factor));
    if (Math.abs(next - scale) < 0.0001) return;
    scale = next;
    if (scale <= 1.001) {
      reset();
      return;
    }
    tx = px - cx * scale;
    ty = py - cy * scale;
    clampPan();
    apply();
  }

  function onWheel(e) {
    if (!enabled) return;
    if (e.target.closest && e.target.closest('.fas-video-chrome, .fas-slider__handle')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const direction = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    const factor = e.ctrlKey ? Math.exp(-e.deltaY * 0.01) : direction;
    zoomAt(e.clientX, e.clientY, factor);
  }

  function onPointerDown(e) {
    if (!enabled) return;
    if (e.target.closest && e.target.closest('.fas-slider__handle, .fas-video-chrome, button, input')) {
      return;
    }
    if (!wantsZoomPan(e, viewport, scale)) return;
    panning = true;
    moved = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    originTx = tx;
    originTy = ty;
    try {
      viewport.setPointerCapture(e.pointerId);
    } catch (_) {}
    e.preventDefault();
    e.stopPropagation();
    apply();
  }

  function onPointerMove(e) {
    if (!panning) return;
    const dx = e.clientX - panStartX;
    const dy = e.clientY - panStartY;
    if (Math.hypot(dx, dy) > 3) moved = true;
    tx = originTx + dx;
    ty = originTy + dy;
    clampPan();
    apply();
  }

  function onPointerUp(e) {
    if (!panning) return;
    panning = false;
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch (_) {}
    apply();
  }

  function onDblClick(e) {
    if (!enabled) return;
    if (e.target.closest && e.target.closest('.fas-slider__handle, .fas-video-chrome, button, input')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (scale > 1.001) {
      reset();
    } else {
      zoomAt(e.clientX, e.clientY, 2.5);
    }
  }

  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);
  viewport.addEventListener('dblclick', onDblClick);

  apply();

  return {
    getScale: () => scale,
    getTransform: () => ({ scale: scale, tx: tx, ty: ty }),
    screenToLocal: screenToLocal,
    didPan: () => moved,
    isPanning: () => panning,
    reset,
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) reset();
    },
    destroy() {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerUp);
      viewport.removeEventListener('dblclick', onDblClick);
      reset();
    },
  };
}

function initZoomControllers() {
  zoomControllers.forEach((c) => c.destroy && c.destroy());
  zoomControllers.clear();
  document.querySelectorAll('.fas-zoom-viewport[data-zoom-id]').forEach((vp) => {
    const id = vp.getAttribute('data-zoom-id');
    if (!id) return;
    zoomControllers.set(id, createZoomController(vp));
  });
  updateZoomEnabled();
}

function updateZoomEnabled() {
  // Image zoom only (reference stills count as images)
  const imageSession = state.mediaKind !== 'video';
  zoomControllers.forEach((c, id) => {
    if (id === 'refs-img') {
      // Reference images pane: always allow zoom when that mode is used
      c.setEnabled(true);
      return;
    }
    c.setEnabled(imageSession);
  });
}

function resetAllZooms() {
  zoomControllers.forEach((c) => c.reset && c.reset());
}

/**
 * Block slider-split drag only when the user is panning the zoom
 * (Space / Alt / middle mouse). Plain left-drag always moves the split.
 */
function isZoomBlockingSliderDrag(e) {
  if (!e) return false;
  if (e.target && e.target.closest && e.target.closest('.fas-slider__handle')) {
    return false;
  }
  const sliderZoom = zoomControllers.get('slider');
  if (!sliderZoom || sliderZoom.getScale() <= 1.001) return false;
  // Pan gesture in progress or requested — don't start a split drag
  if (e.button === 1 || e.altKey || zoomSpaceHeld) return true;
  if (sliderZoom.isPanning && sliderZoom.isPanning()) return true;
  return false;
}

/**
 * Attach the transport bar to the bottom of the active video frame
 * (Flick stage, Side by Side area, Slider, or refs video stage).
 */
function placeVideoChrome() {
  const chrome = $('video-chrome');
  if (!chrome) return;

  // Isolate transport from parent stage/slider drag & zoom handlers.
  // Bubble phase only — capture would block the Play/Mute buttons themselves.
  if (!chrome.dataset.eventsBound) {
    chrome.dataset.eventsBound = '1';
    const stop = (e) => {
      e.stopPropagation();
    };
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click', 'mousedown', 'mouseup', 'touchstart'].forEach(
      (type) => {
        chrome.addEventListener(type, stop, false);
      }
    );
  }

  if (state.mediaKind !== 'video') {
    chrome.hidden = true;
    // Park outside stages so it is not left inside a hidden pane
    const body = $('body');
    if (body && chrome.parentElement !== body) body.appendChild(chrome);
    return;
  }

  let host = null;
  if (state.mode === 'flick') {
    host = $('flick-stage');
  } else if (state.mode === 'slider') {
    // Prefer a dedicated host so controls are not under the slider hit-target tree
    host = $('slider-chrome-host') || $('slider');
  } else if (state.mode === 'side') {
    host = document.querySelector('#pane-side .fas-side');
  } else if (state.mode === 'refs') {
    host = document.querySelector('.fas-refs__panel--right .fas-refs__stage');
  }

  if (!host) {
    chrome.hidden = true;
    return;
  }

  if (chrome.parentElement !== host) {
    host.appendChild(chrome);
  }
  chrome.hidden = false;
}

function toggleImageFit(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  // Only meaningful in flick / side / refs modes
  if (state.mode === 'slider') return;
  // Ignore click-to-fit after a pan gesture
  if (e && e.currentTarget) {
    const vp = e.currentTarget.closest && e.currentTarget.closest('.fas-zoom-viewport');
    if (vp) {
      const id = vp.getAttribute('data-zoom-id');
      const z = id && zoomControllers.get(id);
      if (z && (z.getScale() > 1.001 || z.didPan())) return;
    }
  }
  state.imageFit = state.imageFit === 'fill' ? 'original' : 'fill';
  applyImageFit();
  resetAllZooms();
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
  const layer = root.querySelector('[data-zoom-layer]');
  const layoutW = (layer && layer.offsetWidth) || root.clientWidth || 0;
  if (!layoutW) return;

  // Convert pointer to zoom-layer local X so the split tracks under the cursor when zoomed
  let localX;
  const z = zoomControllers.get('slider');
  if (z && typeof z.screenToLocal === 'function' && z.getScale() > 1.001) {
    localX = z.screenToLocal(e.clientX, e.clientY).x;
  } else {
    const rect = root.getBoundingClientRect();
    localX = e.clientX - rect.left;
  }
  applySliderPct((localX / layoutW) * 100);
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
  if (next === state.flickSide && side !== 'A' && side !== 'B') {
    // allow forced refresh when side specified as current
  }

  const data = next === 'A' ? state.imageA : state.imageB;
  const flickImg = $('flick-img');
  const flickLabel = $('flick-label');
  const swapBtn = $('btn-swap');
  const vidA = $('flick-vid-a');
  const vidB = $('flick-vid-b');

  if (state.mediaKind === 'video') {
    state.flickSide = next;
    if (vidA) vidA.hidden = next !== 'A';
    if (vidB) vidB.hidden = next !== 'B';
    if (flickImg) flickImg.hidden = true;
    if (flickLabel) {
      flickLabel.textContent = next === 'A' ? nounA() : nounB();
      flickLabel.setAttribute('data-side', next);
    }
    if (swapBtn) {
      swapBtn.textContent =
        'Swap to ' + (next === 'A' ? nounB() : nounA());
    }
    if (window.__fasVideoSync) window.__fasVideoSync.applyMutePolicy();
    return;
  }

  if (next === state.flickSide && flickImg && flickImg.src === data.src) {
    // still update labels
  }

  if (flickImg) {
    flickImg.classList.add('is-fading');
    window.setTimeout(() => {
      flickImg.src = data.src;
      flickImg.alt = next === 'A' ? nounA() : nounB();
      flickImg.classList.remove('is-fading');
      if (state.imageFit === 'original') applyImageFit();
    }, 50);
  }

  state.flickSide = next;
  if (flickLabel) {
    flickLabel.textContent = next === 'A' ? nounA() : nounB();
    flickLabel.setAttribute('data-side', next);
  }
  if (swapBtn) {
    swapBtn.textContent = 'Swap to ' + (next === 'A' ? nounB() : nounA());
  }
}

function swapFlick() {
  showFlickSide(null);
}

function showReferenceAt(index) {
  const refs = state.referenceImages || [];
  if (!refs.length) return;
  const n = refs.length;
  let i = ((index % n) + n) % n;
  state.refIndex = i;
  const item = refs[i];
  const img = $('refs-img');
  const label = $('refs-label');
  const ar = $('refs-ar');
  if (img && item) {
    img.src = item.src;
    img.alt = 'Reference ' + (i + 1);
    attachImageFallback(img, 'Reference ' + (i + 1));
  }
  if (label) {
    label.textContent = 'Reference ' + (i + 1) + ' of ' + n;
  }
  if (ar && item) {
    const dims = dimsForImageData(item, img);
    const nearest = nearestAspectRatio(dims.w, dims.h);
    ar.textContent = nearest ? 'AR: ' + nearest.label : 'AR: -';
    ar.hidden = false;
  }
  if (state.imageFit === 'original') applyImageFit();
}

function stepReference(delta) {
  const refs = state.referenceImages || [];
  if (!refs.length) return;
  showReferenceAt(state.refIndex + (delta || 1));
}

function showRefsVideoSide(side) {
  if (!state.imageA || !state.imageB) return;
  let next;
  if (side === 'A' || side === 'B') next = side;
  else next = state.flickSide === 'A' ? 'B' : 'A';
  state.flickSide = next;
  const vA = $('refs-vid-a');
  const vB = $('refs-vid-b');
  if (vA) vA.hidden = next !== 'A';
  if (vB) vB.hidden = next !== 'B';
  const label = $('refs-video-label');
  const swapBtn = $('btn-ref-swap-video');
  if (label) {
    label.textContent = next === 'A' ? nounA() : nounB();
    label.setAttribute('data-side', next);
  }
  if (swapBtn) {
    swapBtn.textContent = 'Swap to ' + (next === 'A' ? nounB() : nounA());
  }
  if (window.__fasVideoSync) window.__fasVideoSync.applyMutePolicy();
}

function updateRefsView() {
  showReferenceAt(state.refIndex || 0);
  showRefsVideoSide(state.flickSide || 'A');
  const arStack = $('refs-video-ar');
  if (arStack) {
    const lineA = formatArLine('A', state.imageA, $('refs-vid-a'));
    const lineB = formatArLine('B', state.imageB, $('refs-vid-b'));
    arStack.innerHTML =
      '<span class="fas-ar-line--a">' +
      lineA +
      '</span><span class="fas-ar-line--b">' +
      lineB +
      '</span>';
    arStack.hidden = false;
  }
}


function wireSlider() {
  const root = $('slider');
  if (!root) return;

  const onPointerDown = (e) => {
    // Only primary button moves the split
    if (e.button !== 0) return;
    // Space/Alt/middle-mouse pan when zoomed — don't steal that for the split
    if (isZoomBlockingSliderDrag(e)) {
      return;
    }
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



// ---------------------------------------------------------------------------
// Video sync: play from 0 together; short clips hold end until all finish; loop
// ---------------------------------------------------------------------------

/**
 * High-granularity timestamp: m:ss.mmm (milliseconds).
 * @param {number} sec
 */
function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const totalMs = Math.round(sec * 1000);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return (
    m +
    ':' +
    String(s).padStart(2, '0') +
    '.' +
    String(ms).padStart(3, '0')
  );
}

/** Scrubber range resolution (higher = finer seek steps). */
const SCRUB_STEPS = 100000;

function createVideoSyncController() {
  /** @type {HTMLVideoElement[]} */
  let videos = [];
  let playing = false;
  let raf = 0;
  let scrubbing = false;
  let wasPlayingBeforeScrub = false;
  /** @type {number|null} Latest scrub target (seconds), applied on rAF */
  let pendingScrubTime = null;
  let scrubFlushRaf = 0;
  /** Display time while scrubbing (slider drives this) */
  let scrubDisplayTime = 0;

  function list() {
    return videos.filter((v) => v && v.isConnected);
  }

  /**
   * Videos that matter for the current mode (fewer seeks = smoother scrubbing).
   * Full list is still updated when scrub ends so modes stay aligned.
   */
  function activeVideos() {
    const all = list();
    const byId = (id) => all.find((v) => v.id === id) || null;
    if (state.mode === 'flick') {
      return [byId('flick-vid-a'), byId('flick-vid-b'), byId('source-vid')].filter(Boolean);
    }
    if (state.mode === 'side') {
      return [byId('side-vid-a'), byId('side-vid-b')].filter(Boolean);
    }
    if (state.mode === 'slider') {
      return [byId('slider-vid-a'), byId('slider-vid-b')].filter(Boolean);
    }
    if (state.mode === 'refs') {
      return [byId('refs-vid-a'), byId('refs-vid-b')].filter(Boolean);
    }
    return all;
  }

  function seekElement(v, t) {
    if (!v) return;
    const d = v.duration && isFinite(v.duration) ? v.duration : null;
    let target = t;
    if (d != null && d > 0) {
      target = Math.min(Math.max(0, t), Math.max(0, d - 0.001));
    } else {
      target = Math.max(0, t);
    }
    // Skip tiny no-ops
    if (Math.abs(v.currentTime - target) < 0.0005) return;
    try {
      // fastSeek is designed for scrubbing (keyframe-accurate, lower latency)
      if (typeof v.fastSeek === 'function') {
        v.fastSeek(target);
      } else {
        v.currentTime = target;
      }
    } catch (_) {
      try {
        v.currentTime = target;
      } catch (_) {}
    }
  }

  function maxDuration() {
    let t = 0;
    list().forEach((v) => {
      if (v.duration && isFinite(v.duration) && v.duration > t) t = v.duration;
    });
    return t;
  }

  function allFinished() {
    const vs = list();
    if (!vs.length) return true;
    return vs.every((v) => {
      if (!v.duration || !isFinite(v.duration) || v.duration <= 0) return true;
      return v.ended || v.currentTime >= v.duration - 0.05;
    });
  }

  function masterTime() {
    // Use max currentTime among videos still before their end
    let t = 0;
    list().forEach((v) => {
      if (!v.duration || !isFinite(v.duration)) return;
      const ct = Math.min(v.currentTime, v.duration);
      if (ct > t && ct < v.duration - 0.05) t = ct;
      else if (v.ended || ct >= v.duration - 0.05) {
        /* ended short clip — don't pull master past others */
      } else if (ct > t) t = ct;
    });
    // Fallback: max of all currentTimes
    if (t === 0) {
      list().forEach((v) => {
        if (v.currentTime > t) t = v.currentTime;
      });
    }
    return t;
  }

  function updateTransportUi() {
    const scrub = $('scrub');
    const timeEl = $('transport-time');
    const playBtn = $('btn-play');
    const T = maxDuration();
    const t = scrubbing ? scrubDisplayTime : masterTime();
    if (scrub && T > 0 && !scrubbing) {
      scrub.max = String(SCRUB_STEPS);
      scrub.value = String(Math.round((t / T) * SCRUB_STEPS));
    } else if (scrub && T > 0 && scrubbing) {
      scrub.max = String(SCRUB_STEPS);
    }
    if (timeEl) {
      timeEl.textContent = formatTime(t) + ' / ' + formatTime(T);
    }
    if (playBtn) {
      playBtn.textContent = playing && !scrubbing ? 'Pause' : 'Play';
    }
  }

  function applyMutePolicy() {
    const vs = list();
    // Side by Side and Slider: no audio. Mute-all control also silences everything.
    const forceMuteAll =
      state.videoMutedAll || state.mode === 'slider' || state.mode === 'side';
    const side = state.flickSide === 'B' ? 'B' : 'A';

    vs.forEach((v) => {
      if (forceMuteAll) {
        v.muted = true;
        return;
      }
      // Flick / reference mode: only the visible A or B video plays audio
      let audible = false;
      if (state.mode === 'flick') {
        audible =
          (side === 'A' && v.id === 'flick-vid-a') ||
          (side === 'B' && v.id === 'flick-vid-b');
      } else if (state.mode === 'refs') {
        audible =
          (side === 'A' && v.id === 'refs-vid-a') ||
          (side === 'B' && v.id === 'refs-vid-b');
      }
      v.muted = !audible;
    });

    const muteBtn = $('btn-mute');
    if (muteBtn) {
      // In side/slider, audio is always off — reflect that on the control
      if (state.mode === 'slider' || state.mode === 'side') {
        muteBtn.textContent = 'Muted';
        muteBtn.disabled = true;
        muteBtn.title = 'Audio is disabled in Side by Side and Slider modes';
      } else {
        muteBtn.disabled = false;
        muteBtn.title = 'Mute all';
        muteBtn.textContent = state.videoMutedAll ? 'Unmute' : 'Mute';
      }
    }
  }

  function tick() {
    if (scrubbing) {
      // Keep UI live while scrubbing without fighting seeks
      updateTransportUi();
      raf = window.requestAnimationFrame(tick);
      return;
    }
    if (!playing) {
      updateTransportUi();
      return;
    }
    const vs = list();

    // Hold short clips at end
    vs.forEach((v) => {
      if (!v.duration || !isFinite(v.duration)) return;
      if (v.currentTime >= v.duration - 0.04 && !v.paused) {
        v.pause();
        seekElement(v, v.duration);
      }
    });

    // Light drift correction toward master among still-playing
    const m = masterTime();
    vs.forEach((v) => {
      if (!v.duration || !isFinite(v.duration)) return;
      if (v.ended || v.currentTime >= v.duration - 0.05) return;
      if (v.paused && playing) {
        v.play().catch(() => {});
      }
      if (Math.abs(v.currentTime - m) > 0.12 && m < v.duration - 0.05) {
        seekElement(v, m);
      }
    });

    if (allFinished()) {
      vs.forEach((v) => seekElement(v, 0));
      vs.forEach((v) => {
        v.play().catch(() => {});
      });
    }

    updateTransportUi();
    raf = window.requestAnimationFrame(tick);
  }

  function startTick() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(tick);
  }

  function stopTick() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
  }

  /**
   * Apply the latest scrub position once per animation frame.
   * Coalesces rapid input events so the decoder is not flooded, while still
   * updating frames continuously during the drag.
   */
  function flushScrubSeek() {
    scrubFlushRaf = 0;
    if (pendingScrubTime == null) {
      if (scrubbing) {
        // Keep polling while scrubbing in case a new value arrives
        scrubFlushRaf = window.requestAnimationFrame(flushScrubSeek);
      }
      return;
    }

    const t = pendingScrubTime;
    pendingScrubTime = null;
    scrubDisplayTime = t;

    const targets = activeVideos();
    let busy = false;
    targets.forEach((v) => {
      if (v.seeking) {
        busy = true;
        return;
      }
      seekElement(v, t);
      if (v.seeking) busy = true;
    });

    // If some decoders were busy, retry this time (or a newer pending) next frame
    if (busy && pendingScrubTime == null) {
      pendingScrubTime = t;
    }

    updateTransportUi();

    if (scrubbing || pendingScrubTime != null) {
      scrubFlushRaf = window.requestAnimationFrame(flushScrubSeek);
    }
  }

  function queueScrubSeek(t) {
    const T = maxDuration();
    t = Math.max(0, Math.min(t, T || t));
    pendingScrubTime = t;
    scrubDisplayTime = t;

    // Immediate seek on the currently visible A/B video for instant feedback
    const side = state.flickSide === 'B' ? 'B' : 'A';
    let primary = null;
    if (state.mode === 'flick') {
      primary = activeVideos().find((v) =>
        side === 'A' ? v.id === 'flick-vid-a' : v.id === 'flick-vid-b'
      );
    } else if (state.mode === 'refs') {
      primary = activeVideos().find((v) =>
        side === 'A' ? v.id === 'refs-vid-a' : v.id === 'refs-vid-b'
      );
    } else {
      primary = activeVideos()[0];
    }
    if (primary && !primary.seeking) {
      seekElement(primary, t);
    }

    if (!scrubFlushRaf) {
      scrubFlushRaf = window.requestAnimationFrame(flushScrubSeek);
    }
    updateTransportUi();
  }

  /** After scrub ends, snap every registered video to the same time. */
  function syncAllTo(t) {
    list().forEach((v) => seekElement(v, t));
  }

  return {
    setVideos(arr) {
      videos = (arr || []).filter(Boolean);
      videos.forEach((v) => {
        v.loop = false;
        v.playsInline = true;
        v.preload = 'auto';
        // Hint browsers we will scrub frequently
        try {
          v.disableRemotePlayback = true;
        } catch (_) {}
      });
      applyMutePolicy();
      updateTransportUi();
    },
    refreshDurations() {
      updateTransportUi();
    },
    play() {
      // Clear any stuck scrub so Play is never a no-op
      scrubbing = false;
      pendingScrubTime = null;
      if (scrubFlushRaf) {
        window.cancelAnimationFrame(scrubFlushRaf);
        scrubFlushRaf = 0;
      }

      playing = true;
      const vs = list();
      if (!vs.length) {
        console.warn('[Flick and Slide] No videos registered to play');
        updateTransportUi();
        return;
      }

      if (allFinished()) {
        vs.forEach((v) => seekElement(v, 0));
      }

      applyMutePolicy();
      vs.forEach((v) => {
        if (v.duration && isFinite(v.duration) && v.currentTime >= v.duration - 0.05) {
          seekElement(v, 0);
        }
        const p = v.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            console.warn('[Flick and Slide] video.play() failed:', v.id, err && err.message);
          });
        }
      });
      startTick();
      updateTransportUi();
    },
    pause() {
      playing = false;
      list().forEach((v) => v.pause());
      stopTick();
      updateTransportUi();
    },
    togglePlay() {
      if (playing && !scrubbing) this.pause();
      else this.play();
    },
    isPlaying() {
      return playing && !scrubbing;
    },
    seek(t) {
      const T = maxDuration();
      t = Math.max(0, Math.min(t, T || t));
      scrubDisplayTime = t;
      list().forEach((v) => {
        seekElement(v, t);
        if (playing && !scrubbing) {
          const d = v.duration && isFinite(v.duration) ? v.duration : t;
          if (t >= d - 0.05) v.pause();
          else v.play().catch(() => {});
        }
      });
      updateTransportUi();
    },
    /**
     * Continuous scrub from the range input (0..SCRUB_STEPS).
     * Updates frames while dragging, not only on release.
     */
    scrubToNormalized(n) {
      const T = maxDuration();
      const t = (n / SCRUB_STEPS) * (T || 0);
      queueScrubSeek(t);
    },
    seekNormalized(n) {
      const T = maxDuration();
      this.seek((n / SCRUB_STEPS) * (T || 0));
    },
    setScrubbing(on) {
      if (on && !scrubbing) {
        wasPlayingBeforeScrub = playing;
        scrubbing = true;
        // Pause for frame-accurate scrubbing (play fights seeks)
        list().forEach((v) => v.pause());
        playing = false;
        startTick(); // keep transport UI updating
      } else if (!on && scrubbing) {
        scrubbing = false;
        if (scrubFlushRaf) {
          window.cancelAnimationFrame(scrubFlushRaf);
          scrubFlushRaf = 0;
        }
        // Final position: apply to all videos so modes stay aligned
        const t =
          pendingScrubTime != null ? pendingScrubTime : scrubDisplayTime;
        pendingScrubTime = null;
        syncAllTo(t);
        scrubDisplayTime = t;
        if (wasPlayingBeforeScrub) {
          this.play();
        } else {
          updateTransportUi();
          stopTick();
        }
        wasPlayingBeforeScrub = false;
      }
    },
    applyMutePolicy,
    maxDuration,
    masterTime,
    updateTransportUi,
  };
}

window.__fasVideoSync = createVideoSyncController();

function setMediaVisibility(isVideo) {
  document.querySelectorAll('.fas-media-img').forEach((el) => {
    el.hidden = !!isVideo;
  });
  document.querySelectorAll('.fas-media-video').forEach((el) => {
    // individual visibility refined later for flick A/B
    el.hidden = !isVideo;
  });
  const app = $('app');
  if (app) app.classList.toggle('is-video-session', !!isVideo);
}

function updateVideoLayerVisibility() {
  if (state.mediaKind !== 'video') return;
  const side = state.flickSide;
  const vidA = $('flick-vid-a');
  const vidB = $('flick-vid-b');
  const flickImg = $('flick-img');
  if (flickImg) flickImg.hidden = true;
  if (vidA) vidA.hidden = side !== 'A';
  if (vidB) vidB.hidden = side !== 'B';

  // Source video visible when source pane shown
  const sourceVid = $('source-vid');
  const sourceImg = $('source-img');
  if (sourceImg) sourceImg.hidden = true;
  if (sourceVid) sourceVid.hidden = !state.imageSource;

  // Side + slider: both videos visible in their layers
  ['side-vid-a', 'side-vid-b', 'slider-vid-a', 'slider-vid-b'].forEach((id) => {
    const el = $(id);
    if (el) el.hidden = false;
  });
  ['side-img-a', 'side-img-b', 'slider-img-a', 'slider-img-b', 'source-img'].forEach(
    (id) => {
      const el = $(id);
      if (el) el.hidden = true;
    }
  );

  // Refs mode: one video visible on the right
  const rVA = $('refs-vid-a');
  const rVB = $('refs-vid-b');
  if (rVA) rVA.hidden = side !== 'A';
  if (rVB) rVB.hidden = side !== 'B';
}

function wireVideoSrc(videoEl, item, label) {
  if (!videoEl || !item || !item.src) return;
  videoEl.src = item.src;
  videoEl.setAttribute('aria-label', label || 'Video');
  videoEl.addEventListener(
    'error',
    () => {
      setStatus(
        (label || 'Video') +
          ' could not be loaded. The file may be protected or not transferable from this page.'
      );
    },
    { once: true }
  );
}

/**
 * Show/hide left source column in Flick mode and wire source image.
 */
function applySourceLayout() {
  const root = $('flick-root');
  const sourcePane = $('flick-source');
  const sourceImg = $('source-img');
  const sourceVid = $('source-vid');
  const btnSource = $('btn-source');
  const sourceLabel = $('source-label');
  const hasSource = !!(state.imageSource && state.imageSource.src);

  if (root) root.classList.toggle('has-source', hasSource);
  if (sourcePane) sourcePane.hidden = !hasSource;

  if (hasSource) {
    if (state.mediaKind === 'video') {
      if (sourceImg) sourceImg.hidden = true;
      if (sourceVid) {
        sourceVid.hidden = false;
        wireVideoSrc(sourceVid, state.imageSource, nounSource());
      }
    } else {
      if (sourceVid) sourceVid.hidden = true;
      if (sourceImg) {
        sourceImg.hidden = false;
        sourceImg.src = state.imageSource.src;
        sourceImg.alt = nounSource();
        attachImageFallback(sourceImg, nounSource());
      }
    }
  }

  if (sourceLabel) sourceLabel.textContent = nounSource();

  if (btnSource) {
    const noun = state.mediaKind === 'video' ? 'source video' : 'source image';
    btnSource.textContent = hasSource
      ? 'Change ' + noun
      : 'Add a ' + noun;
  }

  const sourceAr = $('source-ar');
  if (sourceAr) {
    if (hasSource) {
      const dims = dimsForImageData(
        state.imageSource,
        state.mediaKind === 'video' ? sourceVid : sourceImg
      );
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
  state.referenceImages = Array.isArray(comparison.referenceImages)
    ? comparison.referenceImages.slice()
    : [];
  state.refIndex = 0;
  state.mediaKind =
    comparison.mediaKind ||
    (comparison.imageA && comparison.imageA.kind) ||
    'image';
  const preferredMode = comparison.preferredMode || null;

  const isVideo = state.mediaKind === 'video';
  setMediaVisibility(isVideo);

  if (!isVideo) {
    const flickImg = $('flick-img');
    const imgA = $('slider-img-a');
    const imgB = $('slider-img-b');
    const sideA = $('side-img-a');
    const sideB = $('side-img-b');

    if (flickImg) {
      flickImg.hidden = false;
      flickImg.src = state.imageA.src;
      attachImageFallback(flickImg, nounA());
    }
    ['flick-vid-a', 'flick-vid-b', 'source-vid', 'side-vid-a', 'side-vid-b', 'slider-vid-a', 'slider-vid-b'].forEach(
      (id) => {
        const el = $(id);
        if (el) {
          el.hidden = true;
          el.removeAttribute('src');
        }
      }
    );

    if (imgA) {
      imgA.hidden = false;
      imgA.src = state.imageA.src;
      attachImageFallback(imgA, nounA());
    }
    if (imgB) {
      imgB.hidden = false;
      imgB.src = state.imageB.src;
      attachImageFallback(imgB, nounB());
    }
    if (sideA) {
      sideA.hidden = false;
      sideA.src = state.imageA.src;
      attachImageFallback(sideA, nounA());
    }
    if (sideB) {
      sideB.hidden = false;
      sideB.src = state.imageB.src;
      attachImageFallback(sideB, nounB());
    }
  } else {
    // Video session: load all players, register with sync controller
    const vA = $('flick-vid-a');
    const vB = $('flick-vid-b');
    const sideVA = $('side-vid-a');
    const sideVB = $('side-vid-b');
    const sVA = $('slider-vid-a');
    const sVB = $('slider-vid-b');
    const srcV = $('source-vid');
    const rVA = $('refs-vid-a');
    const rVB = $('refs-vid-b');

    wireVideoSrc(vA, state.imageA, nounA());
    wireVideoSrc(vB, state.imageB, nounB());
    wireVideoSrc(sideVA, state.imageA, nounA());
    wireVideoSrc(sideVB, state.imageB, nounB());
    wireVideoSrc(sVA, state.imageA, nounA());
    wireVideoSrc(sVB, state.imageB, nounB());
    wireVideoSrc(rVA, state.imageA, nounA());
    wireVideoSrc(rVB, state.imageB, nounB());
    if (state.imageSource) wireVideoSrc(srcV, state.imageSource, nounSource());

    // Register all video elements so mode switches stay in sync (A first = primary audio)
    const syncList = [vA, vB];
    if (state.imageSource && srcV) syncList.push(srcV);
    if (sideVA) syncList.push(sideVA);
    if (sideVB) syncList.push(sideVB);
    if (sVA) syncList.push(sVA);
    if (sVB) syncList.push(sVB);
    if (rVA) syncList.push(rVA);
    if (rVB) syncList.push(rVB);

    window.__fasVideoSync.setVideos(syncList);
    updateVideoLayerVisibility();

    // Wait for metadata then enable transport
    let pending = syncList.filter(Boolean).length;
    const onMeta = () => {
      pending -= 1;
      if (state.imageA && vA && vA.videoWidth) {
        state.imageA.naturalWidth = vA.videoWidth;
        state.imageA.naturalHeight = vA.videoHeight;
        state.imageA.duration = vA.duration;
      }
      if (state.imageB && vB && vB.videoWidth) {
        state.imageB.naturalWidth = vB.videoWidth;
        state.imageB.naturalHeight = vB.videoHeight;
        state.imageB.duration = vB.duration;
      }
      window.__fasVideoSync.refreshDurations();
      applyImageFit();
      updateAspectRatioUi();
      if (pending <= 0) setStatus(null);
    };
    syncList.filter(Boolean).forEach((v) => {
      if (v.readyState >= 1) onMeta();
      else {
        v.addEventListener('loadedmetadata', onMeta, { once: true });
        v.addEventListener('error', onMeta, { once: true });
      }
    });
  }

  applySourceLayout();

  state.flickSide = 'A';
  state.imageFit = 'fill';
  const flickLabel = $('flick-label');
  if (flickLabel) {
    flickLabel.textContent = nounA();
    flickLabel.setAttribute('data-side', 'A');
  }
  const swapBtn = $('btn-swap');
  if (swapBtn) swapBtn.textContent = 'Swap to ' + nounB();

  const sideLa = $('side-label-a');
  const sideLb = $('side-label-b');
  if (sideLa) sideLa.textContent = nounA();
  if (sideLb) sideLb.textContent = nounB();

  applySliderPct(50);
  resetAllZooms();
  updateZoomEnabled();
  let startMode = 'flick';
  if (
    preferredMode === 'refs' &&
    state.mediaKind === 'video' &&
    state.referenceImages.length > 0
  ) {
    startMode = 'refs';
  }
  setMode(startMode);

  if (!isVideo) {
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
      const imgA = $('side-img-a') || $('slider-img-a') || $('flick-img');
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
  } else {
    applyImageFit();
    updateAspectRatioUi();
    setStatus('Loading videos…');
  }
}

function wireUi() {
  const btnReset = $('btn-reset');
  if (btnReset) btnReset.addEventListener('click', () => closeWindow());
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

  const btnRefPrev = $('btn-ref-prev');
  const btnRefNext = $('btn-ref-next');
  if (btnRefPrev) btnRefPrev.addEventListener('click', () => stepReference(-1));
  if (btnRefNext) btnRefNext.addEventListener('click', () => stepReference(1));
  const btnRefSwap = $('btn-ref-swap-video');
  if (btnRefSwap) {
    btnRefSwap.addEventListener('click', () => showRefsVideoSide(null));
  }
  const btnRefsChange = $('btn-refs-change');
  if (btnRefsChange) {
    btnRefsChange.addEventListener('click', (e) => {
      e.preventDefault();
      requestRefPick();
    });
  }

  // Click media to toggle fill frame ↔ original size (Flick + Side by Side)
  document.querySelectorAll('.fas-fit-img').forEach((el) => {
    el.addEventListener('click', toggleImageFit);
  });

  const btnPlay = $('btn-play');
  if (btnPlay) {
    btnPlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (window.__fasVideoSync) window.__fasVideoSync.togglePlay();
    });
  }
  const btnMute = $('btn-mute');
  if (btnMute) {
    btnMute.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.videoMutedAll = !state.videoMutedAll;
      if (window.__fasVideoSync) window.__fasVideoSync.applyMutePolicy();
    });
  }
  const scrub = $('scrub');
  if (scrub) {
    const endScrub = () => {
      window.__fasVideoSync.setScrubbing(false);
    };
    scrub.addEventListener('pointerdown', (e) => {
      try {
        scrub.setPointerCapture(e.pointerId);
      } catch (_) {}
      window.__fasVideoSync.setScrubbing(true);
      window.__fasVideoSync.scrubToNormalized(Number(scrub.value) || 0);
    });
    scrub.addEventListener('pointerup', endScrub);
    scrub.addEventListener('pointercancel', endScrub);
    scrub.addEventListener('pointermove', (e) => {
      // Some browsers only fire input; keep move as backup while captured
      if (e.buttons === 1) {
        window.__fasVideoSync.scrubToNormalized(Number(scrub.value) || 0);
      }
    });
    // Primary continuous update path while dragging
    scrub.addEventListener('input', () => {
      window.__fasVideoSync.setScrubbing(true);
      window.__fasVideoSync.scrubToNormalized(Number(scrub.value) || 0);
    });
    scrub.addEventListener('change', endScrub);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mediaKind === 'video') {
      window.__fasVideoSync.pause();
    }
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
  initZoomControllers();

  // Space = pan modifier while zoomed on the comparison slider
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat) {
      const tag = e.target && e.target.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') {
        zoomSpaceHeld = true;
        document.body.classList.add('fas-zoom-space-held');
        // Don't scroll the page / toggle play when using Space to pan on image slider
        if (state.mediaKind !== 'video' && state.mode === 'slider') {
          e.preventDefault();
        }
      }
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      zoomSpaceHeld = false;
      document.body.classList.remove('fas-zoom-space-held');
    }
  });
  window.addEventListener('blur', () => {
    zoomSpaceHeld = false;
    document.body.classList.remove('fas-zoom-space-held');
  });

  document.addEventListener('keydown', (e) => {
    // F11 → full screen (same as the Full Screen button)
    if (e.key === 'F11') {
      e.preventDefault();
      setViewSize('fullscreen');
      return;
    }

    // Reference mode: ← steps reference images, → toggles videos A/B
    if (state.mode === 'refs') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepReference(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        showRefsVideoSide(null);
        return;
      }
    }

    // Flick mode: either arrow key toggles A ↔ B (no directionality)
    if (state.mode === 'flick' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      swapFlick();
      return;
    }

    if (state.mediaKind === 'video' && (e.key === ' ' || e.code === 'Space')) {
      e.preventDefault();
      window.__fasVideoSync.togglePlay();
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
  setStatus('Loading…');

  chrome.runtime.sendMessage({ type: FAS_GET_COMPARISON }, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('Could not load comparison data. Close this window and try again.');
      return;
    }
    if (!response || !response.ok || !response.comparison) {
      setStatus('Nothing to compare. Close this window and select two images or videos again.');
      return;
    }
    try {
      loadImages(response.comparison);
    } catch (err) {
      console.error(err);
      setStatus('Failed to display media.');
    }
  });
}

init();
