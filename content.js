/**
 * Flick and Slide – Content script
 *
 * Handles selection mode, image highlights, floating comparison window
 * (Flick + Comparison Slider), keyboard shortcuts, and clean teardown.
 * Injected dynamically by background.js (Manifest V3).
 */

(function () {
  'use strict';

  // Guard against double injection; re-injection should only toggle.
  if (window.__FLICK_AND_SLIDE__) {
    try {
      window.__FLICK_AND_SLIDE__.toggle();
    } catch (e) {
      console.error('[Flick and Slide] Toggle failed:', e);
    }
    return;
  }

  const FAS_MESSAGE = 'FAS_TOGGLE';
  const NS = 'fas';

  /** @type {import('./types').FasState} */
  const state = {
    active: false,
    imageA: null,
    imageB: null,
    comparing: false,
    mode: 'flick',
    flickSide: 'A',
    viewSize: 'normal',
    sliderPct: 50,
    banner: null,
    fab: null,
    panel: null,
    badges: new Map(),
    selectableImgs: new Set(),
    observers: [],
    drag: null,
    sliderDragging: false,
  };

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

  function resolveSrc(img) {
    if (!img) return '';
    return img.currentSrc || img.src || img.getAttribute('src') || '';
  }

  function attachImageFallback(img, label) {
    if (!img) return;
    img.addEventListener('error', function onErr() {
      img.removeEventListener('error', onErr);
      img.alt = (label || 'Image') + ' could not be loaded';
      img.style.opacity = '0.4';
    });
  }


  function isTypingTarget(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function centerPanel(panel) {
    if (!panel) return;
    // Use left/top so drag works; center initially.
    const rect = panel.getBoundingClientRect();
    const w = rect.width || panel.offsetWidth;
    const h = rect.height || panel.offsetHeight;
    const left = Math.max(8, (window.innerWidth - w) / 2);
    const top = Math.max(8, (window.innerHeight - h) / 2);
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ---------------------------------------------------------------------------
  // Selection mode
  // ---------------------------------------------------------------------------

  function activate() {
    if (state.active) return;
    state.active = true;
    showBanner();
    scanAndMarkImages();
    startMutationObserver();
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    updateFab();
  }

  function deactivate() {
    closeComparison(false);
    state.active = false;
    state.imageA = null;
    state.imageB = null;
    state.mode = 'flick';
    state.flickSide = 'A';
    state.viewSize = 'normal';
    state.sliderPct = 50;

    removeEl(state.banner);
    state.banner = null;
    removeEl(state.fab);
    state.fab = null;
    removeEl(state.panel);
    state.panel = null;

    clearAllHighlights();
    stopMutationObserver();

    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function toggle() {
    if (state.comparing) {
      closeComparison(true);
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
      text: 'Select the two images to compare',
      role: 'status',
      'aria-live': 'polite',
    });
    document.documentElement.appendChild(banner);
    state.banner = banner;
  }

  function scanAndMarkImages() {
    const imgs = document.querySelectorAll('img');
    imgs.forEach((img) => markSelectable(img));
  }

  function markSelectable(img) {
    if (!img || img.nodeName !== 'IMG') return;
    // Skip our own UI images
    if (img.closest && img.closest('.fas-panel, .fas-banner, .fas-fab')) return;
    if (state.selectableImgs.has(img)) return;

    img.classList.add('fas-selectable');
    state.selectableImgs.add(img);

    // Re-apply selection classes if this element is still selected
    if (state.imageA && state.imageA.el === img) {
      img.classList.add('fas-selected-a');
      placeBadge(img, 'A');
    }
    if (state.imageB && state.imageB.el === img) {
      img.classList.add('fas-selected-b');
      placeBadge(img, 'B');
    }
  }

  function unmarkSelectable(img) {
    if (!img) return;
    img.classList.remove('fas-selectable', 'fas-selected-a', 'fas-selected-b');
    removeBadgeFor(img);
    state.selectableImgs.delete(img);
  }

  function clearAllHighlights() {
    state.selectableImgs.forEach((img) => {
      try {
        img.classList.remove('fas-selectable', 'fas-selected-a', 'fas-selected-b');
      } catch (_) {
        /* node may be detached */
      }
    });
    state.selectableImgs.clear();
    state.badges.forEach((badge) => removeEl(badge));
    state.badges.clear();
  }

  function startMutationObserver() {
    stopMutationObserver();
    const mo = new MutationObserver((mutations) => {
      if (!state.active) return;
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.nodeName === 'IMG') markSelectable(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('img').forEach((img) => markSelectable(img));
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
  // Badges
  // ---------------------------------------------------------------------------

  function placeBadge(img, side) {
    removeBadgeFor(img);
    const badge = $('div', 'fas-badge fas-badge--' + side.toLowerCase(), {
      text: side,
    });
    document.documentElement.appendChild(badge);
    state.badges.set(img, badge);
    positionBadge(img, badge);
  }

  function positionBadge(img, badge) {
    if (!img || !badge) return;
    const rect = img.getBoundingClientRect();
    // Fixed positioning relative to viewport
    badge.style.position = 'fixed';
    badge.style.left = Math.max(0, rect.left + 6) + 'px';
    badge.style.top = Math.max(0, rect.top + 6) + 'px';
  }

  function repositionAllBadges() {
    state.badges.forEach((badge, img) => {
      if (!img.isConnected) {
        removeEl(badge);
        state.badges.delete(img);
        return;
      }
      positionBadge(img, badge);
    });
  }

  function removeBadgeFor(img) {
    const badge = state.badges.get(img);
    if (badge) {
      removeEl(badge);
      state.badges.delete(img);
    }
  }

  function onScrollOrResize() {
    repositionAllBadges();
  }

  // Keep badges glued to images while scrolling/resizing during selection.
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize, true);

  // ---------------------------------------------------------------------------
  // Click selection
  // ---------------------------------------------------------------------------

  function snapshotImage(img) {
    return {
      el: img,
      src: resolveSrc(img),
      naturalWidth: img.naturalWidth || img.width || 0,
      naturalHeight: img.naturalHeight || img.height || 0,
    };
  }

  function selectImage(img) {
    // Deselect if already selected
    if (state.imageA && state.imageA.el === img) {
      clearSlot('A');
      afterSelectionChange();
      return;
    }
    if (state.imageB && state.imageB.el === img) {
      clearSlot('B');
      afterSelectionChange();
      return;
    }

    // Both already filled – ignore third image
    if (state.imageA && state.imageB) return;

    if (!state.imageA) {
      state.imageA = snapshotImage(img);
      img.classList.add('fas-selected-a');
      placeBadge(img, 'A');
    } else if (!state.imageB) {
      state.imageB = snapshotImage(img);
      img.classList.add('fas-selected-b');
      placeBadge(img, 'B');
    }

    afterSelectionChange();
  }

  function clearSlot(side) {
    const key = side === 'A' ? 'imageA' : 'imageB';
    const data = state[key];
    if (data && data.el) {
      data.el.classList.remove(side === 'A' ? 'fas-selected-a' : 'fas-selected-b');
      removeBadgeFor(data.el);
    }
    state[key] = null;
  }

  function afterSelectionChange() {
    updateFab();
    // If both deselected while active, fully deactivate
    if (!state.imageA && !state.imageB) {
      if (state.comparing) closeComparison(false);
      deactivate();
    }
  }

  function onDocumentClick(e) {
    if (!state.active) return;
    // Ignore clicks inside our UI
    if (e.target.closest && e.target.closest('.fas-panel, .fas-fab, .fas-banner')) {
      return;
    }

    const img = findImageTarget(e.target);
    if (!img) return;

    e.preventDefault();
    e.stopPropagation();
    selectImage(img);
  }

  function findImageTarget(target) {
    if (!target) return null;
    if (target.nodeName === 'IMG' && state.selectableImgs.has(target)) return target;
    // Walk up a few levels for wrapped images
    let el = target;
    for (let i = 0; i < 4 && el; i++) {
      if (el.nodeName === 'IMG' && state.selectableImgs.has(el)) return el;
      el = el.parentElement;
    }
    // Picture/source parent containing img
    if (target.closest) {
      const pic = target.closest('picture');
      if (pic) {
        const img = pic.querySelector('img');
        if (img && state.selectableImgs.has(img)) return img;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // FAB
  // ---------------------------------------------------------------------------

  function updateFab() {
    const both = !!(state.imageA && state.imageB);
    if (both && state.active && !state.comparing) {
      if (!state.fab) {
        const fab = $('button', 'fas-fab', {
          type: 'button',
          text: 'Compare Images',
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
  // Comparison window
  // ---------------------------------------------------------------------------

  function openComparison() {
    if (!state.imageA || !state.imageB) return;
    // Refresh src in case of lazy-load completion
    if (state.imageA.el) {
      state.imageA.src = resolveSrc(state.imageA.el) || state.imageA.src;
    }
    if (state.imageB.el) {
      state.imageB.src = resolveSrc(state.imageB.el) || state.imageB.src;
    }

    state.comparing = true;
    state.mode = 'flick';
    state.flickSide = 'A';
    state.sliderPct = 50;
    updateFab();
    buildPanel();
  }

  /**
   * @param {boolean} keepSelectionMode
   */
  function closeComparison(keepSelectionMode) {
    state.comparing = false;
    teardownPanelDrag();
    removeEl(state.panel);
    state.panel = null;
    if (keepSelectionMode && state.active) {
      updateFab();
    }
  }

  function buildPanel() {
    removeEl(state.panel);

    const panel = $('div', 'fas-panel fas-panel--' + state.viewSize, {
      role: 'dialog',
      'aria-label': 'Image Comparison – A vs B',
    });

    // Header
    const header = $('div', 'fas-panel__header');

    const left = $('div', 'fas-panel__header-left');
    const closeBtn = $('button', 'fas-btn fas-btn--close', {
      type: 'button',
      title: 'Close comparison tool',
      'aria-label': 'Close comparison tool',
      text: '×',
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeComparison(true);
    });
    left.appendChild(closeBtn);

    const title = $('div', 'fas-panel__title', {
      text: 'Image Comparison – A vs B',
    });

    const right = $('div', 'fas-panel__header-right');

    // View toggles
    const viewGroup = $('div', 'fas-view-toggles', { role: 'group', 'aria-label': 'View size' });
    ['small', 'normal', 'maximised'].forEach((size) => {
      const label =
        size === 'small' ? 'Small' : size === 'normal' ? 'Normal' : 'Maximised';
      const btn = $('button', 'fas-btn' + (state.viewSize === size ? ' is-active' : ''), {
        type: 'button',
        text: label,
        'data-size': size,
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        setViewSize(size);
      });
      viewGroup.appendChild(btn);
    });

    // Mode tabs
    const modeGroup = $('div', 'fas-mode-tabs', { role: 'tablist', 'aria-label': 'Comparison mode' });
    const flickTab = $('button', 'fas-btn is-active', {
      type: 'button',
      text: 'Flick Between Images',
      role: 'tab',
      'aria-selected': 'true',
      'data-mode': 'flick',
    });
    const sliderTab = $('button', 'fas-btn', {
      type: 'button',
      text: 'Comparison Slider',
      role: 'tab',
      'aria-selected': 'false',
      'data-mode': 'slider',
    });
    flickTab.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('flick');
    });
    sliderTab.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode('slider');
    });
    modeGroup.appendChild(flickTab);
    modeGroup.appendChild(sliderTab);

    right.appendChild(viewGroup);
    right.appendChild(modeGroup);

    header.appendChild(left);
    header.appendChild(title);
    header.appendChild(right);

    // Body
    const body = $('div', 'fas-panel__body');

    // Flick pane
    const flickPane = $('div', 'fas-mode-pane is-visible', { 'data-pane': 'flick' });
    const flick = $('div', 'fas-flick');
    const stage = $('div', 'fas-flick__stage');
    const flickImg = $('img', 'fas-flick__img', {
      alt: 'Image A',
      draggable: 'false',
    });
    flickImg.src = state.imageA.src;
    attachImageFallback(flickImg, 'Image A');
    stage.appendChild(flickImg);

    const controls = $('div', 'fas-flick__controls');
    const label = $('div', 'fas-flick__label', { text: 'Image A' });
    label.setAttribute('data-side', 'A');
    const swapBtn = $('button', 'fas-btn fas-btn--primary', {
      type: 'button',
      text: 'Swap to Image B',
    });
    swapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      swapFlick();
    });
    controls.appendChild(label);
    controls.appendChild(swapBtn);
    flick.appendChild(stage);
    flick.appendChild(controls);
    flickPane.appendChild(flick);

    // Slider pane
    const sliderPane = $('div', 'fas-mode-pane', { 'data-pane': 'slider' });
    const slider = buildSlider();
    sliderPane.appendChild(slider);

    body.appendChild(flickPane);
    body.appendChild(sliderPane);

    // Footer
    const footer = $('div', 'fas-panel__footer');
    const labels = $('div', 'fas-panel__footer-labels');
    labels.appendChild($('span', null, { text: 'Image A' }));
    labels.appendChild($('span', null, { text: 'Image B' }));
    const resetBtn = $('button', 'fas-btn fas-btn--ghost', {
      type: 'button',
      text: 'Reset & Return to Selection',
    });
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeComparison(true);
    });
    footer.appendChild(labels);
    footer.appendChild(resetBtn);

    panel.appendChild(header);
    panel.appendChild(body);
    panel.appendChild(footer);
    document.documentElement.appendChild(panel);
    state.panel = panel;

    // Store refs for updates
    panel._fas = {
      flickImg,
      flickLabel: label,
      swapBtn,
      flickPane,
      sliderPane,
      flickTab,
      sliderTab,
      viewGroup,
      slider,
    };

    centerPanel(panel);
    enablePanelDrag(header, panel);
    applySliderPct(state.sliderPct);
  }

  function setViewSize(size) {
    state.viewSize = size;
    if (!state.panel) return;
    state.panel.classList.remove('fas-panel--small', 'fas-panel--normal', 'fas-panel--maximised');
    state.panel.classList.add('fas-panel--' + size);
    const group = state.panel._fas && state.panel._fas.viewGroup;
    if (group) {
      group.querySelectorAll('.fas-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute('data-size') === size);
      });
    }
    // Re-center on size change for predictability
    requestAnimationFrame(() => centerPanel(state.panel));
  }

  function setMode(mode) {
    state.mode = mode;
    if (!state.panel || !state.panel._fas) return;
    const { flickPane, sliderPane, flickTab, sliderTab } = state.panel._fas;
    const isFlick = mode === 'flick';
    flickPane.classList.toggle('is-visible', isFlick);
    sliderPane.classList.toggle('is-visible', !isFlick);
    flickTab.classList.toggle('is-active', isFlick);
    sliderTab.classList.toggle('is-active', !isFlick);
    flickTab.setAttribute('aria-selected', isFlick ? 'true' : 'false');
    sliderTab.setAttribute('aria-selected', isFlick ? 'false' : 'true');
  }

  function swapFlick() {
    if (!state.panel || !state.panel._fas) return;
    const { flickImg, flickLabel, swapBtn } = state.panel._fas;
    const next = state.flickSide === 'A' ? 'B' : 'A';
    const data = next === 'A' ? state.imageA : state.imageB;

    // Brief crossfade polish
    flickImg.classList.add('is-fading');
    window.setTimeout(() => {
      flickImg.src = data.src;
      flickImg.alt = 'Image ' + next;
      flickImg.classList.remove('is-fading');
    }, 50);

    state.flickSide = next;
    flickLabel.textContent = 'Image ' + next;
    flickLabel.setAttribute('data-side', next);
    swapBtn.textContent = 'Swap to Image ' + (next === 'A' ? 'B' : 'A');
  }

  // ---------------------------------------------------------------------------
  // Slider (adapted from sneas/img-comparison-slider technique)
  // ---------------------------------------------------------------------------

  function buildSlider() {
    const root = $('div', 'fas-slider', {
      role: 'slider',
      'aria-label': 'Image comparison slider',
      'aria-valuemin': '0',
      'aria-valuemax': '100',
      'aria-valuenow': String(state.sliderPct),
      tabindex: '0',
    });
    root.style.setProperty('--fas-exposure', state.sliderPct + '%');

    const layerB = $('div', 'fas-slider__layer fas-slider__layer--b');
    const imgB = $('img', null, { alt: 'Image B', draggable: 'false' });
    imgB.src = state.imageB.src;
    attachImageFallback(imgB, 'Image B');
    layerB.appendChild(imgB);

    const layerA = $('div', 'fas-slider__layer fas-slider__layer--a');
    const imgA = $('img', null, { alt: 'Image A', draggable: 'false' });
    imgA.src = state.imageA.src;
    attachImageFallback(imgA, 'Image A');
    layerA.appendChild(imgA);

    const handle = $('div', 'fas-slider__handle');
    const line = $('div', 'fas-slider__line');
    const grip = $('div', 'fas-slider__grip', { html: '‹›', title: 'Drag to compare' });
    const gripLabel = $('div', 'fas-slider__grip-label', { text: 'Drag to compare' });
    handle.appendChild(line);
    handle.appendChild(grip);
    handle.appendChild(gripLabel);

    root.appendChild(layerB);
    root.appendChild(layerA);
    root.appendChild(handle);

    const onPointerDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
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

    // Keyboard: arrows nudge the handle
    root.addEventListener('keydown', (e) => {
      let delta = 0;
      if (e.key === 'ArrowLeft') delta = -2;
      if (e.key === 'ArrowRight') delta = 2;
      if (!delta) return;
      e.preventDefault();
      applySliderPct(state.sliderPct + delta);
    });

    root._fasCleanup = () => {
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      root.removeEventListener('pointercancel', onPointerUp);
    };

    return root;
  }

  function updateSliderFromEvent(e, root) {
    const rect = root.getBoundingClientRect();
    if (!rect.width) return;
    const x = e.clientX - rect.left;
    const pct = clamp((x / rect.width) * 100, 0, 100);
    applySliderPct(pct);
  }

  function applySliderPct(pct) {
    state.sliderPct = clamp(pct, 0, 100);
    if (!state.panel || !state.panel._fas || !state.panel._fas.slider) return;
    const slider = state.panel._fas.slider;
    slider.style.setProperty('--fas-exposure', state.sliderPct + '%');
    slider.setAttribute('aria-valuenow', String(Math.round(state.sliderPct)));
  }

  // ---------------------------------------------------------------------------
  // Panel drag
  // ---------------------------------------------------------------------------

  function enablePanelDrag(header, panel) {
    const onPointerDown = (e) => {
      // Don't drag when interacting with controls
      if (e.target.closest('button, a, input, select, textarea, .fas-view-toggles, .fas-mode-tabs')) {
        return;
      }
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      state.drag = {
        panel,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        pointerId: e.pointerId,
      };
      try {
        header.setPointerCapture(e.pointerId);
      } catch (_) {}
      document.body.style.userSelect = 'none';
    };

    const onPointerMove = (e) => {
      if (!state.drag || state.drag.panel !== panel) return;
      const w = panel.offsetWidth;
      const h = panel.offsetHeight;
      let left = e.clientX - state.drag.offsetX;
      let top = e.clientY - state.drag.offsetY;
      left = clamp(left, 0, Math.max(0, window.innerWidth - w));
      top = clamp(top, 0, Math.max(0, window.innerHeight - h));
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    };

    const onPointerUp = (e) => {
      if (!state.drag) return;
      state.drag = null;
      try {
        header.releasePointerCapture(e.pointerId);
      } catch (_) {}
      document.body.style.userSelect = '';
    };

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);

    panel._fasDragCleanup = () => {
      header.removeEventListener('pointerdown', onPointerDown);
      header.removeEventListener('pointermove', onPointerMove);
      header.removeEventListener('pointerup', onPointerUp);
      header.removeEventListener('pointercancel', onPointerUp);
    };
  }

  function teardownPanelDrag() {
    if (state.panel && state.panel._fasDragCleanup) {
      try {
        state.panel._fasDragCleanup();
      } catch (_) {}
    }
    if (state.panel && state.panel._fas && state.panel._fas.slider && state.panel._fas.slider._fasCleanup) {
      try {
        state.panel._fas.slider._fasCleanup();
      } catch (_) {}
    }
    state.drag = null;
    state.sliderDragging = false;
    document.body.style.userSelect = '';
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  function onKeyDown(e) {
    if (isTypingTarget(e.target)) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (state.comparing) {
        closeComparison(true);
      } else if (state.active) {
        deactivate();
      }
      return;
    }

    // "C" opens compare when both images selected
    if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (state.active && !state.comparing && state.imageA && state.imageB) {
        e.preventDefault();
        openComparison();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging from background service worker
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === FAS_MESSAGE) {
      toggle();
      sendResponse({ ok: true, active: state.active, comparing: state.comparing });
      return true;
    }
    return false;
  });

  // Public API for re-injection path
  window.__FLICK_AND_SLIDE__ = {
    toggle,
    activate,
    deactivate,
    getState: () => ({
      active: state.active,
      comparing: state.comparing,
      hasA: !!state.imageA,
      hasB: !!state.imageB,
      mode: state.mode,
    }),
  };

  // First injection: start selection mode immediately
  activate();
})();
