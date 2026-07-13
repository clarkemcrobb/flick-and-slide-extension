/**
 * Flick and Slide – Content script
 *
 * Selection mode only: banner, image highlights/badges, FAB.
 * Comparison UI opens in a dedicated Chrome window via the service worker
 * (so it can be maximised and moved to another monitor).
 */

(function () {
  'use strict';

  /**
   * After chrome://extensions Reload, old content scripts stay on the page but
   * chrome.runtime is dead ("Extension context invalidated"). Detect that and
   * tear down orphans so a fresh inject can take over cleanly.
   */
  function isExtensionContextValid() {
    try {
      return typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  // Existing instance from a previous inject
  if (window.__FLICK_AND_SLIDE__) {
    const prev = window.__FLICK_AND_SLIDE__;
    try {
      if (isExtensionContextValid() && typeof prev.isAlive === 'function' && prev.isAlive()) {
        prev.toggle();
        return;
      }
    } catch (_) {
      /* fall through to destroy */
    }
    // Dead / orphaned instance — remove its UI and listeners, then re-init.
    try {
      if (typeof prev.destroy === 'function') prev.destroy();
    } catch (_) {
      /* ignore */
    }
    try {
      delete window.__FLICK_AND_SLIDE__;
    } catch (_) {
      window.__FLICK_AND_SLIDE__ = null;
    }
  }

  const FAS_TOGGLE = 'FAS_TOGGLE';
  const FAS_OPEN_COMPARISON = 'FAS_OPEN_COMPARISON';
  const FAS_CLOSE_COMPARISON = 'FAS_CLOSE_COMPARISON';
  const FAS_COMPARISON_CLOSED = 'FAS_COMPARISON_CLOSED';
  const FAS_ENTER_SOURCE_PICK = 'FAS_ENTER_SOURCE_PICK';
  const FAS_ENTER_REF_PICK = 'FAS_ENTER_REF_PICK';
  const MAX_REFERENCE_IMAGES = 10;

  const state = {
    active: false,
    destroyed: false,
    imageA: null,
    imageB: null,
    imageSource: null,
    /** @type {Array} up to MAX_REFERENCE_IMAGES image snapshots for video ref mode */
    referenceImages: [],
    /** When true, next image click assigns the Source image (A/B stay selected). */
    selectingSource: false,
    /** When true, clicks add reference images (up to 10); videos A/B stay selected. */
    selectingRefs: false,
    comparing: false,
    banner: null,
    fab: null,
    /** @type {Map<HTMLImageElement, { ring: HTMLElement, badge: HTMLElement, side: string }>} */
    selectionChrome: new Map(),
    selectableImgs: new Set(),
    observers: [],
    repositionRaf: 0,
    /** Guard against double-firing click handlers on the same gesture */
    lastSelectTs: 0,
    lastSelectImg: null,
    onMessage: null,
  };

  const MIN_SELECT_AREA = 24 * 24;

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function $(tag, className, attrs) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') el.innerHTML = attrs[k];
        else el.setAttribute(k, attrs[k]);
      });
    }
    return el;
  }

  function resolveSrc(el) {
    if (!el) return '';
    if (el.nodeName === 'VIDEO') {
      return el.currentSrc || el.src || el.getAttribute('src') || '';
    }
    return el.currentSrc || el.src || el.getAttribute('src') || '';
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function isContextInvalidError(err) {
    const msg = err && (err.message || String(err));
    return typeof msg === 'string' && msg.includes('Extension context invalidated');
  }

  /**
   * Safe chrome.runtime.sendMessage — never throws after extension reload.
   * @param {object} message
   * @param {function=} callback
   */
  function safeSendMessage(message, callback) {
    if (state.destroyed || !isExtensionContextValid()) {
      handleContextInvalidated();
      if (callback) callback(null);
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr && isContextInvalidError(lastErr)) {
          handleContextInvalidated();
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response, lastErr);
      });
    } catch (err) {
      if (isContextInvalidError(err)) {
        handleContextInvalidated();
      } else {
        console.warn('[Flick and Slide] sendMessage failed:', err);
      }
      if (callback) callback(null);
    }
  }

  /**
   * Tear down this inject completely when the extension was reloaded/disabled.
   * Idempotent and must not call chrome.* APIs.
   */
  function handleContextInvalidated() {
    if (state.destroyed) return;
    destroy();
  }

  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;
    state.active = false;
    state.comparing = false;
    state.imageA = null;
    state.imageB = null;

    try {
      removeEl(state.banner);
    } catch (_) {}
    state.banner = null;
    try {
      removeEl(state.fab);
    } catch (_) {}
    state.fab = null;

    try {
      clearAllHighlights();
    } catch (_) {}
    try {
      stopMutationObserver();
    } catch (_) {}

    try {
      document.removeEventListener('click', onDocumentClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', scheduleRepositionChrome, true);
      window.removeEventListener('resize', scheduleRepositionChrome, true);
    } catch (_) {}

    if (state.onMessage && isExtensionContextValid()) {
      try {
        chrome.runtime.onMessage.removeListener(state.onMessage);
      } catch (_) {}
    }
    state.onMessage = null;

    if (window.__FLICK_AND_SLIDE__ && window.__FLICK_AND_SLIDE__.destroy === destroy) {
      try {
        delete window.__FLICK_AND_SLIDE__;
      } catch (_) {
        window.__FLICK_AND_SLIDE__ = null;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Selection mode
  // ---------------------------------------------------------------------------

  function activate() {
    if (state.destroyed || state.active) return;
    if (!isExtensionContextValid()) {
      handleContextInvalidated();
      return;
    }
    state.active = true;
    showBanner();
    scanAndMarkImages();
    startMutationObserver();
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    updateFab();
  }

  function deactivate() {
    if (state.destroyed) return;

    const wasComparing = state.comparing;
    state.active = false;
    state.imageA = null;
    state.imageB = null;
    state.imageSource = null;
    state.referenceImages = [];
    state.selectingSource = false;
    state.selectingRefs = false;
    state.comparing = false;

    removeEl(state.banner);
    state.banner = null;
    removeEl(state.fab);
    state.fab = null;

    clearAllHighlights();
    stopMutationObserver();

    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    // If the comparison window is still open, close it (OS/UI may already have).
    // comparing is already false so this will not re-enter deactivate.
    if (wasComparing && isExtensionContextValid()) {
      safeSendMessage({ type: FAS_CLOSE_COMPARISON }, () => {});
    }
  }

  function toggle() {
    if (state.destroyed) return;
    if (!isExtensionContextValid()) {
      handleContextInvalidated();
      return;
    }
    // If comparison window is open, close it — full tool exit follows via FAS_COMPARISON_CLOSED.
    if (state.comparing) {
      requestCloseComparison();
      return;
    }
    if (state.active) {
      deactivate();
    } else {
      activate();
    }
  }

  function showBanner() {
    removeEl(state.banner);
    const banner = $('div', 'fas-banner', {
      role: 'status',
      'aria-live': 'polite',
    });

    let labelText = 'Select the two images or videos to compare';
    if (state.selectingSource) {
      labelText = 'Select a source image or video (A and B stay selected)';
    } else if (state.selectingRefs) {
      const n = state.referenceImages.length;
      labelText =
        'Select up to ' +
        MAX_REFERENCE_IMAGES +
        ' reference images (' +
        n +
        '/' +
        MAX_REFERENCE_IMAGES +
        ' selected). Then click Done.';
    }

    const label = $('span', 'fas-banner__text', {
      text: labelText,
    });

    if (state.selectingSource) {
      const cancelBtn = $('button', 'fas-banner__close', {
        type: 'button',
        text: 'Cancel',
        title: 'Cancel source selection and reopen comparison',
        'aria-label': 'Cancel source selection',
      });
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelSourcePick();
      });
      banner.appendChild(label);
      banner.appendChild(cancelBtn);
    } else if (state.selectingRefs) {
      banner.appendChild(label);
      const doneBtn = $('button', 'fas-banner__close', {
        type: 'button',
        text: 'Done',
        title: 'Finish selecting reference images and open comparison',
        'aria-label': 'Done selecting reference images',
      });
      doneBtn.disabled = state.referenceImages.length < 1;
      if (state.referenceImages.length < 1) {
        doneBtn.style.opacity = '0.5';
        doneBtn.style.cursor = 'not-allowed';
      }
      doneBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        finishRefPick();
      });
      const cancelBtn = $('button', 'fas-banner__close', {
        type: 'button',
        text: 'Cancel',
        title: 'Cancel reference selection and reopen comparison',
        'aria-label': 'Cancel reference selection',
      });
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelRefPick();
      });
      banner.appendChild(doneBtn);
      banner.appendChild(cancelBtn);
    }

    const closeBtn = $('button', 'fas-banner__close', {
      type: 'button',
      text: 'Close tool',
      title: 'Close tool',
      'aria-label': 'Close tool',
    });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deactivate();
    });

    if (!state.selectingSource && !state.selectingRefs) {
      banner.appendChild(label);
    }
    banner.appendChild(closeBtn);
    document.documentElement.appendChild(banner);
    state.banner = banner;
  }

  function updateBanner() {
    if (!state.active) return;
    showBanner();
  }

  function enterSourcePickMode() {
    state.comparing = false;
    state.selectingSource = true;
    updateFab();
    updateBanner();
    // Ensure A/B (and existing source) chrome still visible
    enforceSelectionInvariants();
  }

  function cancelSourcePick() {
    state.selectingSource = false;
    updateBanner();
    if (state.imageA && state.imageB) {
      openComparison();
    }
  }

  function enterRefPickMode() {
    state.comparing = false;
    state.selectingSource = false;
    state.selectingRefs = true;
    // Keep any existing refs so user can add more (up to max)
    updateFab();
    updateBanner();
    enforceSelectionInvariants();
  }

  function cancelRefPick() {
    state.selectingRefs = false;
    updateBanner();
    if (state.imageA && state.imageB) {
      openComparison({ preferredMode: 'refs' });
    }
  }

  function finishRefPick() {
    if (state.referenceImages.length < 1) {
      showMediaError('Select at least one reference image, or click Cancel.');
      return;
    }
    state.selectingRefs = false;
    updateBanner();
    openComparison({ preferredMode: 'refs' });
  }

  function clearReferenceChrome() {
    state.referenceImages.forEach((ref) => {
      if (ref && ref.el) {
        try {
          ref.el.classList.remove('fas-selected-r');
        } catch (_) {}
        removeSelectionChrome(ref.el);
      }
    });
  }

  function assignReference(img) {
    // Toggle off if already a reference
    const existingIdx = state.referenceImages.findIndex(
      (r) => r.el === img || isSameSelection(r.el, img)
    );
    if (existingIdx >= 0) {
      const removed = state.referenceImages.splice(existingIdx, 1)[0];
      if (removed && removed.el) {
        try {
          removed.el.classList.remove('fas-selected-r');
        } catch (_) {}
        removeSelectionChrome(removed.el);
      }
      // re-number remaining badges
      state.referenceImages.forEach((r, i) => {
        if (r.el) placeSelectionChrome(r.el, 'R', String(i + 1));
      });
      updateBanner();
      return;
    }
    if (state.referenceImages.length >= MAX_REFERENCE_IMAGES) {
      showMediaError(
        'You can select up to ' + MAX_REFERENCE_IMAGES + ' reference images. Click Done when ready.'
      );
      return;
    }
    const snap = snapshotImage(img);
    if (snap.kind !== 'image') {
      showMediaError('Reference items must be images (not videos).');
      return;
    }
    if (!isTransferableSrc(snap.src)) {
      showMediaError(
        'This image cannot be opened in the comparison window (unsupported or protected source).'
      );
      return;
    }
    state.referenceImages.push(snap);
    img.classList.add('fas-selected-r');
    img.classList.remove('fas-selected-a', 'fas-selected-b', 'fas-selected-s');
    placeSelectionChrome(img, 'R', String(state.referenceImages.length));
    updateBanner();
    if (state.referenceImages.length >= MAX_REFERENCE_IMAGES) {
      showMediaError('Maximum of ' + MAX_REFERENCE_IMAGES + ' reference images selected. Click Done.');
    }
  }

  function assignSource(img) {
    // Clear previous source chrome
    if (state.imageSource && state.imageSource.el) {
      try {
        state.imageSource.el.classList.remove('fas-selected-s');
      } catch (_) {}
      removeSelectionChrome(state.imageSource.el);
    }
    state.imageSource = snapshotImage(img);
    img.classList.add('fas-selected-s');
    img.classList.remove('fas-selected-a', 'fas-selected-b');
    placeSelectionChrome(img, 'S');
  }

  function scanAndMarkImages() {
    document.querySelectorAll('img, video').forEach((el) => markSelectable(el));
  }

  function markSelectable(el) {
    if (!el || (el.nodeName !== 'IMG' && el.nodeName !== 'VIDEO')) return;
    if (el.closest && el.closest('.fas-banner, .fas-fab')) return;
    if (state.selectableImgs.has(el)) return;

    el.classList.add('fas-selectable');
    state.selectableImgs.add(el);
    const img = el; // keep local name for rebinding below

    // Re-bind chrome only for the slot that owns this exact element
    if (state.imageA && state.imageA.el === img) {
      img.classList.add('fas-selected-a');
      placeSelectionChrome(img, 'A');
    } else if (state.imageB && state.imageB.el === img) {
      img.classList.add('fas-selected-b');
      placeSelectionChrome(img, 'B');
    } else if (state.imageSource && state.imageSource.el === img) {
      img.classList.add('fas-selected-s');
      placeSelectionChrome(img, 'S');
    }
  }

  function clearAllHighlights() {
    state.selectableImgs.forEach((img) => {
      try {
        img.classList.remove('fas-selectable', 'fas-selected-a', 'fas-selected-b', 'fas-selected-s', 'fas-selected-r');
      } catch (_) {
        /* detached */
      }
    });
    state.selectableImgs.clear();
    clearAllSelectionChrome();
  }

  function startMutationObserver() {
    stopMutationObserver();
    const mo = new MutationObserver((mutations) => {
      if (state.destroyed || !state.active) return;
      if (!isExtensionContextValid()) {
        handleContextInvalidated();
        return;
      }
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.nodeName === 'IMG' || node.nodeName === 'VIDEO') markSelectable(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('img, video').forEach((m) => markSelectable(m));
          }
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    state.observers.push(mo);
  }

  function stopMutationObserver() {
    state.observers.forEach((o) => {
      try {
        o.disconnect();
      } catch (_) {}
    });
    state.observers = [];
  }

  // ---------------------------------------------------------------------------
  // Selection chrome (fixed border ring + A/B badge glued to the image)
  // Host pages often override img outline/border; overlays avoid that fight.
  // ---------------------------------------------------------------------------

  function placeSelectionChrome(img, side, badgeText) {
    // Enforce one ring/badge per exclusive side (A/B/S). Reference rings (R) allow many.
    const toRemove = [];
    state.selectionChrome.forEach((chrome, otherImg) => {
      if (otherImg === img) {
        toRemove.push(otherImg);
      } else if (side !== 'R' && chrome.side === side) {
        toRemove.push(otherImg);
      }
    });
    toRemove.forEach((otherImg) => removeSelectionChrome(otherImg));

    const ringClass =
      side === 'R' ? 'fas-ring fas-ring--r' : 'fas-ring fas-ring--' + side.toLowerCase();
    const badgeClass =
      side === 'R' ? 'fas-badge fas-badge--r' : 'fas-badge fas-badge--' + side.toLowerCase();
    const ring = $('div', ringClass, {
      'aria-hidden': 'true',
    });
    let label = badgeText;
    if (label == null) {
      if (side === 'S') label = 'S';
      else if (side === 'R') label = 'R';
      else label = side;
    }
    let title = 'Image ' + side;
    if (side === 'S') title = 'Source';
    if (side === 'R') title = 'Reference image ' + label;
    const badge = $('div', badgeClass, {
      text: String(label),
      title: title,
      'aria-hidden': 'true',
    });

    document.documentElement.appendChild(ring);
    document.documentElement.appendChild(badge);
    state.selectionChrome.set(img, { ring, badge, side });
    positionSelectionChrome(img);
  }

  function positionSelectionChrome(img) {
    const chrome = state.selectionChrome.get(img);
    if (!chrome || !img) return;

    if (!img.isConnected) {
      removeSelectionChrome(img);
      return;
    }

    const rect = img.getBoundingClientRect();
    const visible =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;

    const { ring, badge } = chrome;

    if (!visible) {
      ring.style.display = 'none';
      badge.style.display = 'none';
      return;
    }

    // Fixed to the viewport so scroll position cannot drift the highlight.
    ring.style.display = 'block';
    ring.style.position = 'fixed';
    ring.style.left = rect.left + 'px';
    ring.style.top = rect.top + 'px';
    ring.style.width = rect.width + 'px';
    ring.style.height = rect.height + 'px';

    badge.style.display = 'inline-flex';
    badge.style.position = 'fixed';
    badge.style.left = Math.max(0, rect.left + 6) + 'px';
    badge.style.top = Math.max(0, rect.top + 6) + 'px';
  }

  function repositionAllSelectionChrome() {
    state.selectionChrome.forEach((_chrome, img) => {
      positionSelectionChrome(img);
    });
  }

  function scheduleRepositionChrome() {
    if (state.destroyed || !state.active) return;
    if (state.repositionRaf) return;
    state.repositionRaf = window.requestAnimationFrame(() => {
      state.repositionRaf = 0;
      if (state.destroyed || !state.active) return;
      try {
        repositionAllSelectionChrome();
      } catch (err) {
        if (isContextInvalidError(err)) handleContextInvalidated();
      }
    });
  }

  function removeSelectionChrome(img) {
    const chrome = state.selectionChrome.get(img);
    if (!chrome) return;
    removeEl(chrome.ring);
    removeEl(chrome.badge);
    state.selectionChrome.delete(img);
  }

  function clearAllSelectionChrome() {
    state.selectionChrome.forEach((chrome) => {
      removeEl(chrome.ring);
      removeEl(chrome.badge);
    });
    state.selectionChrome.clear();
  }

  window.addEventListener('scroll', scheduleRepositionChrome, true);
  window.addEventListener('resize', scheduleRepositionChrome, true);

  // ---------------------------------------------------------------------------
  // Click selection (strict: max one A, one B, never the same visual twice)
  // ---------------------------------------------------------------------------

  function mediaKindOf(el) {
    if (!el) return null;
    if (el.nodeName === 'VIDEO') return 'video';
    if (el.nodeName === 'IMG') return 'image';
    return null;
  }

  function isTransferableSrc(src) {
    if (!src || typeof src !== 'string') return false;
    const s = src.trim();
    if (!s) return false;
    if (s.startsWith('blob:')) return false;
    if (s.startsWith('mediasource:')) return false;
    if (s.startsWith('mse:')) return false;
    return true;
  }

  function snapshotImage(el) {
    const kind = mediaKindOf(el) || 'image';
    const src = resolveSrc(el);
    let naturalWidth = 0;
    let naturalHeight = 0;
    let duration = 0;
    if (kind === 'video') {
      naturalWidth = el.videoWidth || el.clientWidth || 0;
      naturalHeight = el.videoHeight || el.clientHeight || 0;
      duration = el.duration && isFinite(el.duration) ? el.duration : 0;
    } else {
      naturalWidth = el.naturalWidth || el.width || 0;
      naturalHeight = el.naturalHeight || el.height || 0;
    }
    return {
      el: el,
      kind: kind,
      src: src,
      naturalWidth: naturalWidth,
      naturalHeight: naturalHeight,
      duration: duration,
    };
  }

  /** Serializable payload for the comparison window (no DOM refs). */
  function toPayloadImage(data) {
    return {
      kind: data.kind || 'image',
      src: data.src,
      naturalWidth: data.naturalWidth,
      naturalHeight: data.naturalHeight,
      duration: data.duration || 0,
    };
  }

  function showMediaError(message) {
    // Temporary status on the banner
    if (!state.banner) return;
    let err = state.banner.querySelector('.fas-banner__error');
    if (!err) {
      err = document.createElement('span');
      err.className = 'fas-banner__error';
      state.banner.insertBefore(err, state.banner.lastChild);
    }
    err.textContent = message;
    err.hidden = false;
    window.clearTimeout(showMediaError._t);
    showMediaError._t = window.setTimeout(() => {
      if (err) err.hidden = true;
    }, 4500);
  }

  function sessionKind() {
    if (state.imageA && state.imageA.kind) return state.imageA.kind;
    return null;
  }

  function assertSameKind(el, forSlot) {
    const kind = mediaKindOf(el);
    const sk = sessionKind();
    if (sk && kind && kind !== sk) {
      showMediaError(
        'Select two images or two videos — you cannot mix images and videos.'
      );
      return false;
    }
    return true;
  }

  function imageArea(img) {
    if (!img || !img.getBoundingClientRect) return 0;
    const r = img.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function isOurUi(el) {
    if (!el || !el.closest) return false;
    return !!(
      el.closest('.fas-banner') ||
      el.closest('.fas-fab') ||
      el.closest('.fas-ring') ||
      el.closest('.fas-badge')
    );
  }

  /**
   * Whether an img is large enough / visible enough to select.
   * Filters out icons, tracking pixels, and hidden nodes.
   */
  function isValidSelectable(el) {
    if (!el || (el.nodeName !== 'IMG' && el.nodeName !== 'VIDEO')) return false;
    if (!el.isConnected) return false;
    if (isOurUi(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) return false;
    if (r.width * r.height < MIN_SELECT_AREA) return false;
    // Fully off-screen
    if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) {
      return false;
    }
    try {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  function rectsIoU(a, b) {
    const x1 = Math.max(a.left, b.left);
    const y1 = Math.max(a.top, b.top);
    const x2 = Math.min(a.right, b.right);
    const y2 = Math.min(a.bottom, b.bottom);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (inter <= 0) return 0;
    const areaA = Math.max(0, a.width) * Math.max(0, a.height);
    const areaB = Math.max(0, b.width) * Math.max(0, b.height);
    const union = areaA + areaB - inter;
    return union > 0 ? inter / union : 0;
  }

  function normalizeSrc(src) {
    if (!src) return '';
    try {
      // Absolute URL without hash; keep query (CDNs often encode size there)
      const u = new URL(src, document.baseURI);
      u.hash = '';
      return u.href;
    } catch {
      return String(src).split('#')[0];
    }
  }

  /**
   * True if two DOM images represent the same selectable visual.
   * Handles stacked/nested imgs on shopping grids (Google, etc.).
   */
  function isSameSelection(img1, img2) {
    if (!img1 || !img2) return false;
    if (img1 === img2) return true;

    // One contains the other (nested / picture wrappers)
    try {
      if (img1.contains && img1.contains(img2)) return true;
      if (img2.contains && img2.contains(img1)) return true;
      if (img1.parentElement && img1.parentElement.contains(img2) && img2.parentElement && img2.parentElement.contains(img1)) {
        // Shared parent and overlapping boxes with same/similar src
        const r1 = img1.getBoundingClientRect();
        const r2 = img2.getBoundingClientRect();
        if (rectsIoU(r1, r2) > 0.35) {
          const s1 = normalizeSrc(resolveSrc(img1));
          const s2 = normalizeSrc(resolveSrc(img2));
          if (s1 && s2 && (s1 === s2 || s1.includes(s2) || s2.includes(s1))) return true;
          // Heavily overlapping in the same card even if src differs (overlay icons rare)
          if (rectsIoU(r1, r2) > 0.7) return true;
        }
      }
    } catch (_) {
      /* ignore */
    }

    const s1 = normalizeSrc(resolveSrc(img1));
    const s2 = normalizeSrc(resolveSrc(img2));
    if (s1 && s2 && s1 === s2) {
      const r1 = img1.getBoundingClientRect();
      const r2 = img2.getBoundingClientRect();
      // Same URL and substantially overlapping → same visual instance
      if (rectsIoU(r1, r2) > 0.25) return true;
      // Same URL, centres very close (stacked thumbnails)
      const c1x = r1.left + r1.width / 2;
      const c1y = r1.top + r1.height / 2;
      const c2x = r2.left + r2.width / 2;
      const c2y = r2.top + r2.height / 2;
      const dist = Math.hypot(c1x - c2x, c1y - c2y);
      if (dist < Math.max(20, Math.min(r1.width, r2.width) * 0.35)) return true;
    }

    return false;
  }

  function slotMatchesImg(slotData, img) {
    return !!(slotData && slotData.el && isSameSelection(slotData.el, img));
  }

  function clearSlot(side) {
    const key = side === 'A' ? 'imageA' : 'imageB';
    const data = state[key];
    if (data && data.el) {
      try {
        data.el.classList.remove(side === 'A' ? 'fas-selected-a' : 'fas-selected-b');
      } catch (_) {
        /* detached */
      }
      removeSelectionChrome(data.el);
    }
    // Also strip any chrome still tagged with this side (orphan cleanup)
    const orphans = [];
    state.selectionChrome.forEach((chrome, el) => {
      if (chrome.side === side) orphans.push(el);
    });
    orphans.forEach((el) => {
      try {
        el.classList.remove('fas-selected-a', 'fas-selected-b');
      } catch (_) {}
      removeSelectionChrome(el);
    });
    state[key] = null;
  }

  function assignSlot(side, img) {
    // Never allow the same visual in both slots
    if (side === 'A' && slotMatchesImg(state.imageB, img)) clearSlot('B');
    if (side === 'B' && slotMatchesImg(state.imageA, img)) clearSlot('A');

    clearSlot(side);

    const snap = snapshotImage(img);
    if (side === 'A') {
      state.imageA = snap;
      img.classList.add('fas-selected-a');
      img.classList.remove('fas-selected-b');
    } else {
      state.imageB = snap;
      img.classList.add('fas-selected-b');
      img.classList.remove('fas-selected-a');
    }
    placeSelectionChrome(img, side);
  }

  /**
   * Hard guarantee: at most one A, one B, distinct visuals, chrome matches slots.
   */
  function enforceSelectionInvariants() {
    // Drop B if it collides with A
    if (state.imageA && state.imageB && isSameSelection(state.imageA.el, state.imageB.el)) {
      clearSlot('B');
    }

    // Rebuild chrome from authoritative slots only
    const allowed = new Set();
    if (state.imageA && state.imageA.el && state.imageA.el.isConnected) {
      allowed.add(state.imageA.el);
      state.imageA.el.classList.add('fas-selected-a');
      state.imageA.el.classList.remove('fas-selected-b');
      placeSelectionChrome(state.imageA.el, 'A');
    } else if (state.imageA) {
      state.imageA = null;
    }

    if (state.imageB && state.imageB.el && state.imageB.el.isConnected) {
      // Re-check collision after A placement
      if (state.imageA && isSameSelection(state.imageA.el, state.imageB.el)) {
        clearSlot('B');
      } else {
        allowed.add(state.imageB.el);
        state.imageB.el.classList.add('fas-selected-b');
        state.imageB.el.classList.remove('fas-selected-a');
        placeSelectionChrome(state.imageB.el, 'B');
      }
    } else if (state.imageB) {
      state.imageB = null;
    }

    // Source chrome
    if (state.imageSource && state.imageSource.el && state.imageSource.el.isConnected) {
      allowed.add(state.imageSource.el);
      state.imageSource.el.classList.add('fas-selected-s');
      state.imageSource.el.classList.remove('fas-selected-a', 'fas-selected-b', 'fas-selected-r');
      placeSelectionChrome(state.imageSource.el, 'S');
    } else if (state.imageSource && (!state.imageSource.el || !state.imageSource.el.isConnected)) {
      state.imageSource = null;
    }

    // Reference image chrome (numbered)
    state.referenceImages = (state.referenceImages || []).filter(
      (r) => r && r.el && r.el.isConnected
    );
    state.referenceImages.forEach((r, i) => {
      allowed.add(r.el);
      r.el.classList.add('fas-selected-r');
      r.el.classList.remove('fas-selected-a', 'fas-selected-b', 'fas-selected-s');
      placeSelectionChrome(r.el, 'R', String(i + 1));
    });

    // Remove any leftover chrome not belonging to current slots
    const extras = [];
    state.selectionChrome.forEach((_c, el) => {
      if (!allowed.has(el)) extras.push(el);
    });
    extras.forEach((el) => {
      try {
        el.classList.remove(
          'fas-selected-a',
          'fas-selected-b',
          'fas-selected-s',
          'fas-selected-r'
        );
      } catch (_) {}
      removeSelectionChrome(el);
    });
  }

  function selectImage(img) {
    if (!img || !isValidSelectable(img)) return;

    // Debounce identical rapid events (capture + bubble leftovers, synthetic doubles)
    const now = Date.now();
    if (state.lastSelectImg === img && now - state.lastSelectTs < 80) {
      return;
    }
    state.lastSelectTs = now;
    state.lastSelectImg = img;

    // Reference-pick mode: add/remove images (up to 10); videos A/B stay selected
    if (state.selectingRefs) {
      if (slotMatchesImg(state.imageA, img) || slotMatchesImg(state.imageB, img)) {
        showMediaError('Choose still images for references — not the selected videos.');
        return;
      }
      assignReference(img);
      return;
    }

    // Source-pick mode: A and B stay selected; assign Source and reopen comparison
    if (state.selectingSource) {
      if (slotMatchesImg(state.imageA, img) || slotMatchesImg(state.imageB, img)) {
        return;
      }
      if (!assertSameKind(img, 'S')) return;
      const srcSnap = snapshotImage(img);
      if (!isTransferableSrc(srcSnap.src)) {
        showMediaError(
          'This media cannot be opened in the comparison window (unsupported or protected source).'
        );
        return;
      }
      assignSource(img);
      state.selectingSource = false;
      updateBanner();
      enforceSelectionInvariants();
      openComparison();
      return;
    }

    // Clicking an already-selected visual deselects that slot
    if (slotMatchesImg(state.imageA, img)) {
      clearSlot('A');
      enforceSelectionInvariants();
      afterSelectionChange();
      return;
    }
    if (slotMatchesImg(state.imageB, img)) {
      clearSlot('B');
      enforceSelectionInvariants();
      afterSelectionChange();
      return;
    }

    // Both slots filled — require deselect first (unless picking source)
    if (state.imageA && state.imageB) {
      return;
    }

    if (!state.imageA) {
      const snap = snapshotImage(img);
      if (!isTransferableSrc(snap.src)) {
        showMediaError(
          'This media cannot be opened in the comparison window (unsupported or protected source).'
        );
        return;
      }
      assignSlot('A', img);
    } else if (!state.imageB) {
      if (slotMatchesImg(state.imageA, img)) {
        return;
      }
      if (!assertSameKind(img, 'B')) return;
      const snap = snapshotImage(img);
      if (!isTransferableSrc(snap.src)) {
        showMediaError(
          'This media cannot be opened in the comparison window (unsupported or protected source).'
        );
        return;
      }
      assignSlot('B', img);
    }

    enforceSelectionInvariants();
    afterSelectionChange();
  }

  function afterSelectionChange() {
    updateFab();
    if (!state.imageA && !state.imageB) {
      requestCloseComparison();
      deactivate();
    }
  }

  function onDocumentClick(e) {
    if (state.destroyed) return;
    if (!isExtensionContextValid()) {
      handleContextInvalidated();
      return;
    }
    if (!state.active) return;
    if (isOurUi(e.target)) return;

    const img = findImageTarget(e);
    if (!img) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    try {
      selectImage(img);
    } catch (err) {
      if (isContextInvalidError(err)) handleContextInvalidated();
      else console.warn('[Flick and Slide] selectImage failed:', err);
    }
  }

  /**
   * Resolve the intended image under the pointer.
   * Prefer the largest selectable img at the click point (product photo, not icon).
   */
  function findImageTarget(e) {
    const x = e.clientX;
    const y = e.clientY;
    const candidates = [];

    try {
      const stack = document.elementsFromPoint(x, y);
      for (let i = 0; i < stack.length; i++) {
        const el = stack[i];
        if (isOurUi(el)) continue;
        if (
          (el.nodeName === 'IMG' || el.nodeName === 'VIDEO') &&
          state.selectableImgs.has(el) &&
          isValidSelectable(el)
        ) {
          candidates.push(el);
        }
        // Also consider media inside a clicked container near the top of the stack
        if (candidates.length === 0 && el.querySelectorAll && i < 3) {
          el.querySelectorAll('img, video').forEach((media) => {
            if (state.selectableImgs.has(media) && isValidSelectable(media)) {
              const r = media.getBoundingClientRect();
              if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
                candidates.push(media);
              }
            }
          });
        }
      }
    } catch (_) {
      /* elementsFromPoint may throw in rare cases */
    }

    if (candidates.length === 0) {
      // Fallback: walk up from event target
      let el = e.target;
      for (let i = 0; i < 6 && el; i++) {
        if (
          (el.nodeName === 'IMG' || el.nodeName === 'VIDEO') &&
          state.selectableImgs.has(el) &&
          isValidSelectable(el)
        ) {
          candidates.push(el);
          break;
        }
        el = el.parentElement;
      }
    }

    if (candidates.length === 0) return null;

    // Deduplicate by same-selection identity, keep largest
    const unique = [];
    candidates.forEach((img) => {
      const existing = unique.find((u) => isSameSelection(u, img));
      if (!existing) unique.push(img);
      else if (imageArea(img) > imageArea(existing)) {
        unique[unique.indexOf(existing)] = img;
      }
    });

    unique.sort((a, b) => imageArea(b) - imageArea(a));
    return unique[0] || null;
  }

  // ---------------------------------------------------------------------------
  // FAB
  // ---------------------------------------------------------------------------

  function updateFab() {
    const both = !!(state.imageA && state.imageB);
    // Hide FAB while comparison window is open; show again when it closes.
    if (both && state.active && !state.comparing && !state.selectingSource && !state.selectingRefs) {
      if (!state.fab) {
        const fab = $('button', 'fas-fab', {
          type: 'button',
          text: 'Compare',
        });
        fab.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openComparison();
        });
        document.documentElement.appendChild(fab);
        state.fab = fab;
      }
    } else {
      removeEl(state.fab);
      state.fab = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Comparison window (separate Chrome window via background)
  // ---------------------------------------------------------------------------

  function openComparison(options) {
    options = options || {};
    if (!state.imageA || !state.imageB) return;

    if (state.imageA.el) {
      state.imageA.src = resolveSrc(state.imageA.el) || state.imageA.src;
    }
    if (state.imageB.el) {
      state.imageB.src = resolveSrc(state.imageB.el) || state.imageB.src;
    }
    if (state.imageSource && state.imageSource.el) {
      state.imageSource.src =
        resolveSrc(state.imageSource.el) || state.imageSource.src;
    }

    if (!state.imageA.src || !state.imageB.src) {
      console.warn('[Flick and Slide] Missing image src; cannot open comparison.');
      return;
    }

    safeSendMessage(
      {
        type: FAS_OPEN_COMPARISON,
        payload: {
          mediaKind: state.imageA.kind || 'image',
          imageA: toPayloadImage(state.imageA),
          imageB: toPayloadImage(state.imageB),
          imageSource: state.imageSource
            ? toPayloadImage(state.imageSource)
            : null,
          referenceImages: (state.referenceImages || []).map((r) => toPayloadImage(r)),
          preferredMode: options.preferredMode || null,
        },
      },
      (response, lastErr) => {
        if (state.destroyed) return;
        if (lastErr) {
          console.error(
            '[Flick and Slide] Open comparison failed:',
            lastErr.message || lastErr
          );
          return;
        }
        if (response && response.ok) {
          state.comparing = true;
          updateFab();
        } else if (response) {
          console.error(
            '[Flick and Slide] Open comparison rejected:',
            response.error
          );
        }
      }
    );
  }

  function requestCloseComparison() {
    if (!state.comparing) return;
    if (!isExtensionContextValid()) {
      // Cannot reach background — still fully exit locally
      deactivate();
      return;
    }
    // Keep comparing=true until FAS_COMPARISON_CLOSED (from any close path).
    safeSendMessage({ type: FAS_CLOSE_COMPARISON }, (_response, lastErr) => {
      // If background failed to respond, force full local exit
      if (lastErr && state.active) {
        deactivate();
      }
    });
  }

  /**
   * Comparison window closed by any means:
   * - In-window × / Close tool / Esc
   * - OS or Chrome window close (any size: Small, Medium, Maximised, Full Screen)
   * Fully exit the tool — do not leave selection mode / A·B highlights active.
   */
  function onComparisonClosed() {
    state.comparing = false;
    state.selectingSource = false;
    state.selectingRefs = false;
    if (state.active) {
      deactivate();
    } else {
      updateFab();
    }
  }

  function onEnterSourcePick() {
    // Comparison closed temporarily so the user can pick a source image
    state.comparing = false;
    state.selectingRefs = false;
    enterSourcePickMode();
  }

  function onEnterRefPick() {
    state.comparing = false;
    state.selectingSource = false;
    enterRefPickMode();
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  function onKeyDown(e) {
    if (state.destroyed) return;
    if (!isExtensionContextValid()) {
      handleContextInvalidated();
      return;
    }
    if (isTypingTarget(e.target)) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (state.comparing) {
        requestCloseComparison();
      } else if (state.selectingSource) {
        cancelSourcePick();
      } else if (state.selectingRefs) {
        cancelRefPick();
      } else if (state.active) {
        deactivate();
      }
      return;
    }

    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (
        state.active &&
        !state.comparing &&
        !state.selectingSource &&
        !state.selectingRefs &&
        state.imageA &&
        state.imageB
      ) {
        e.preventDefault();
        openComparison();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  function onRuntimeMessage(msg, _sender, sendResponse) {
    if (state.destroyed) return false;
    if (!isExtensionContextValid()) {
      handleContextInvalidated();
      return false;
    }
    if (!msg || !msg.type) return false;

    try {
      if (msg.type === FAS_TOGGLE) {
        toggle();
        sendResponse({ ok: true, active: state.active, comparing: state.comparing });
        return true;
      }

      if (msg.type === FAS_COMPARISON_CLOSED) {
        onComparisonClosed();
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === FAS_ENTER_SOURCE_PICK) {
        onEnterSourcePick();
        sendResponse({ ok: true });
        return true;
      }

      if (msg.type === FAS_ENTER_REF_PICK) {
        onEnterRefPick();
        sendResponse({ ok: true });
        return true;
      }
    } catch (err) {
      if (isContextInvalidError(err)) handleContextInvalidated();
      else console.warn('[Flick and Slide] onMessage failed:', err);
    }

    return false;
  }

  state.onMessage = onRuntimeMessage;
  try {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  } catch (err) {
    if (isContextInvalidError(err)) {
      handleContextInvalidated();
      return;
    }
    throw err;
  }

  window.__FLICK_AND_SLIDE__ = {
    toggle,
    activate,
    deactivate,
    destroy,
    isAlive: () => !state.destroyed && isExtensionContextValid(),
    getState: () => ({
      active: state.active,
      comparing: state.comparing,
      hasA: !!state.imageA,
      hasB: !!state.imageB,
      hasSource: !!state.imageSource,
      selectingSource: state.selectingSource,
      destroyed: state.destroyed,
    }),
  };

  activate();
})();
