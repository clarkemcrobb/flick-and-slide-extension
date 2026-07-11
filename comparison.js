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

function getModeTitles() {
  if (state.mediaKind === 'video') {
    return {
      flick: 'Flick Between Videos – A vs B',
      slider: 'Comparison Slider – A vs B',
      side: 'Side by Side – A vs B',
    };
  }
  return {
    flick: 'Flick Between Images – A vs B',
    slider: 'Comparison Slider – A vs B',
    side: 'Side by Side – A vs B',
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

  $('pane-flick').classList.toggle('is-visible', mode === 'flick');
  $('pane-slider').classList.toggle('is-visible', mode === 'slider');
  const paneSide = $('pane-side');
  if (paneSide) paneSide.classList.toggle('is-visible', mode === 'side');

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

  const fitHint = $('fit-hint');
  if (fitHint) {
    fitHint.hidden = mode === 'slider';
  }

  const transport = $('transport');
  if (transport) {
    transport.hidden = state.mediaKind !== 'video';
  }

  document.querySelectorAll('#mode-tabs .fas-btn').forEach((btn) => {
    const active = btn.getAttribute('data-mode') === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  // When switching modes, keep video timeline but ensure visibility layers correct
  if (state.mediaKind === 'video') {
    updateVideoLayerVisibility();
    if (window.__fasVideoSync) window.__fasVideoSync.refreshDurations();
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
  document.querySelectorAll('.fas-flick__stage, .fas-side__stage').forEach((stage) => {
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

  function list() {
    return videos.filter((v) => v && v.isConnected);
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
    const t = masterTime();
    if (scrub && T > 0 && !scrubbing) {
      scrub.max = String(SCRUB_STEPS);
      scrub.value = String(Math.round((t / T) * SCRUB_STEPS));
    }
    if (timeEl) {
      timeEl.textContent = formatTime(t) + ' / ' + formatTime(T);
    }
    if (playBtn) {
      playBtn.textContent = playing ? 'Pause' : 'Play';
    }
  }

  function applyMutePolicy() {
    const vs = list();
    vs.forEach((v, i) => {
      // Primary audio = first registered (video A). Mute others unless mute-all.
      if (state.videoMutedAll) {
        v.muted = true;
      } else {
        v.muted = i !== 0;
      }
    });
    const muteBtn = $('btn-mute');
    if (muteBtn) muteBtn.textContent = state.videoMutedAll ? 'Unmute' : 'Mute';
  }

  function tick() {
    if (!playing || scrubbing) {
      updateTransportUi();
      return;
    }
    const vs = list();
    const T = maxDuration();

    // Hold short clips at end
    vs.forEach((v) => {
      if (!v.duration || !isFinite(v.duration)) return;
      if (v.currentTime >= v.duration - 0.04 && !v.paused) {
        v.pause();
        try {
          v.currentTime = Math.max(0, v.duration - 0.01);
        } catch (_) {}
      }
    });

    // Light drift correction toward master among still-playing
    const m = masterTime();
    vs.forEach((v) => {
      if (!v.duration || !isFinite(v.duration)) return;
      if (v.ended || v.currentTime >= v.duration - 0.05) return;
      if (v.paused && playing) {
        // should still be playing if not finished
        v.play().catch(() => {});
      }
      if (Math.abs(v.currentTime - m) > 0.12 && m < v.duration - 0.05) {
        try {
          v.currentTime = Math.min(m, v.duration - 0.01);
        } catch (_) {}
      }
    });

    if (allFinished()) {
      // Restart all from 0 together
      vs.forEach((v) => {
        try {
          v.currentTime = 0;
        } catch (_) {}
      });
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

  return {
    setVideos(arr) {
      videos = (arr || []).filter(Boolean);
      videos.forEach((v) => {
        v.loop = false;
        v.playsInline = true;
        v.preload = 'auto';
      });
      applyMutePolicy();
      updateTransportUi();
    },
    refreshDurations() {
      updateTransportUi();
    },
    play() {
      playing = true;
      const vs = list();
      // If all at end, restart from 0
      if (allFinished()) {
        vs.forEach((v) => {
          try {
            v.currentTime = 0;
          } catch (_) {}
        });
      }
      applyMutePolicy();
      vs.forEach((v) => {
        if (v.duration && isFinite(v.duration) && v.currentTime >= v.duration - 0.05) {
          return; // hold until loop
        }
        v.play().catch(() => {});
      });
      startTick();
      updateTransportUi();
    },
    pause() {
      playing = false;
      list().forEach((v) => v.pause());
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      updateTransportUi();
    },
    togglePlay() {
      if (playing) this.pause();
      else this.play();
    },
    isPlaying() {
      return playing;
    },
    seek(t) {
      const T = maxDuration();
      t = Math.max(0, Math.min(t, T || t));
      list().forEach((v) => {
        const d = v.duration && isFinite(v.duration) ? v.duration : t;
        const target = Math.min(t, Math.max(0, d - 0.01));
        try {
          v.currentTime = target;
        } catch (_) {}
        if (playing) {
          if (t >= d - 0.05) v.pause();
          else v.play().catch(() => {});
        }
      });
      updateTransportUi();
    },
    seekNormalized(n) {
      // n 0..SCRUB_STEPS
      const T = maxDuration();
      this.seek((n / SCRUB_STEPS) * (T || 0));
    },
    setScrubbing(on) {
      scrubbing = !!on;
      if (!on && playing) startTick();
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
  state.mediaKind =
    comparison.mediaKind ||
    (comparison.imageA && comparison.imageA.kind) ||
    'image';

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

    wireVideoSrc(vA, state.imageA, nounA());
    wireVideoSrc(vB, state.imageB, nounB());
    wireVideoSrc(sideVA, state.imageA, nounA());
    wireVideoSrc(sideVB, state.imageB, nounB());
    wireVideoSrc(sVA, state.imageA, nounA());
    wireVideoSrc(sVB, state.imageB, nounB());
    if (state.imageSource) wireVideoSrc(srcV, state.imageSource, nounSource());

    // Sync controller drives the "primary" set: prefer visible-mode elements.
    // Register A first (audio primary), then B, then source.
    // Use side videos as canonical (always both present); flick/slider share same src.
    // Actually each element is independent decoder — register one set to save resources.
    // Use flick-vid-a/b + source as master; on mode change we need all playing...
    // Register ALL non-null videos that are part of comparison so every mode stays in sync.
    const syncList = [vA, vB];
    if (state.imageSource && srcV) syncList.push(srcV);
    // Also side + slider so switching modes doesn't desync
    if (sideVA) syncList.push(sideVA);
    if (sideVB) syncList.push(sideVB);
    if (sVA) syncList.push(sVA);
    if (sVB) syncList.push(sVB);

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
  setMode('flick');

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

  // Click media to toggle fill frame ↔ original size (Flick + Side by Side)
  document.querySelectorAll('.fas-fit-img').forEach((el) => {
    el.addEventListener('click', toggleImageFit);
  });

  const btnPlay = $('btn-play');
  if (btnPlay) {
    btnPlay.addEventListener('click', (e) => {
      e.preventDefault();
      window.__fasVideoSync.togglePlay();
    });
  }
  const btnMute = $('btn-mute');
  if (btnMute) {
    btnMute.addEventListener('click', (e) => {
      e.preventDefault();
      state.videoMutedAll = !state.videoMutedAll;
      window.__fasVideoSync.applyMutePolicy();
    });
  }
  const scrub = $('scrub');
  if (scrub) {
    scrub.addEventListener('pointerdown', () => window.__fasVideoSync.setScrubbing(true));
    scrub.addEventListener('pointerup', () => window.__fasVideoSync.setScrubbing(false));
    scrub.addEventListener('input', () => {
      window.__fasVideoSync.seekNormalized(Number(scrub.value) || 0);
    });
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
