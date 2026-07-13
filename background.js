/**
 * Flick and Slide – Background service worker (Manifest V3)
 *
 * - Toolbar click: inject/toggle selection mode on the active tab.
 * - Opens the comparison UI in a real OS window (chrome.windows) so it can
 *   be maximised and dragged to another monitor.
 * - Context menu on the toolbar icon: Check for updates (GitHub version compare).
 *
 * Note: Unpacked extensions cannot auto-install updates. Check for updates only
 * reports whether GitHub has a newer version and how to update manually.
 */

'use strict';

const FAS_TOGGLE = 'FAS_TOGGLE';
const FAS_OPEN_COMPARISON = 'FAS_OPEN_COMPARISON';
const FAS_GET_COMPARISON = 'FAS_GET_COMPARISON';
const FAS_CLOSE_COMPARISON = 'FAS_CLOSE_COMPARISON';
const FAS_RESIZE_COMPARISON = 'FAS_RESIZE_COMPARISON';
const FAS_COMPARISON_CLOSED = 'FAS_COMPARISON_CLOSED';
const FAS_CHECK_UPDATES = 'FAS_CHECK_UPDATES';
const FAS_REQUEST_SOURCE_PICK = 'FAS_REQUEST_SOURCE_PICK';
const FAS_ENTER_SOURCE_PICK = 'FAS_ENTER_SOURCE_PICK';
const FAS_REQUEST_REF_PICK = 'FAS_REQUEST_REF_PICK';
const FAS_ENTER_REF_PICK = 'FAS_ENTER_REF_PICK';

const MENU_CHECK_UPDATES = 'fas-check-updates';

/** GitHub main-branch manifest (source of truth for published version). */
const REMOTE_MANIFEST_URL =
  'https://raw.githubusercontent.com/clarkemcrobb/flick-and-slide-extension/main/manifest.json';

const VIEW_SIZES = {
  small: { width: 720, height: 520 },
  normal: { width: 1040, height: 760 },
  maximised: null, // OS maximised (window still has chrome)
  fullscreen: null, // True full screen (F11 equivalent)
};

/** @type {number|null} */
let comparisonWindowId = null;
/** @type {number|null} */
let sourceTabId = null;
/** Prevent double notify when both windows.remove and onRemoved fire */
let comparisonCloseNotified = false;
/** 'exit' | 'source-pick' | 'ref-pick' */
let pendingCloseReason = 'exit';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Coalesce rapid view clicks: always end on the latest requested size. */
let resizeRunning = false;
/** @type {{ size: string, windowId: number|null|undefined }|null} */
let resizePending = null;
/** @type {Promise<unknown>} */
let resizeWaiters = Promise.resolve();

async function persistComparisonSession(windowId, tabId) {
  if (windowId != null) comparisonWindowId = windowId;
  if (tabId !== undefined) sourceTabId = tabId;

  try {
    const payload = {};
    if (comparisonWindowId != null) payload.comparisonWindowId = comparisonWindowId;
    if (sourceTabId != null) payload.sourceTabId = sourceTabId;
    if (Object.keys(payload).length) {
      await chrome.storage.session.set(payload);
    }
  } catch {
    /* ignore */
  }
}

async function clearComparisonSession() {
  comparisonWindowId = null;
  sourceTabId = null;
  try {
    await chrome.storage.session.remove(['comparisonWindowId', 'sourceTabId']);
  } catch {
    /* ignore */
  }
}

async function persistComparisonWindowId(id) {
  comparisonWindowId = id != null ? id : null;
  try {
    if (id != null) {
      await chrome.storage.session.set({ comparisonWindowId: id });
    } else {
      await chrome.storage.session.remove('comparisonWindowId');
    }
  } catch {
    /* ignore */
  }
}

async function resolveComparisonWindowId(preferredId) {
  if (preferredId != null) {
    try {
      await chrome.windows.get(preferredId);
      comparisonWindowId = preferredId;
      return preferredId;
    } catch {
      /* fall through */
    }
  }
  if (comparisonWindowId != null) {
    try {
      await chrome.windows.get(comparisonWindowId);
      return comparisonWindowId;
    } catch {
      comparisonWindowId = null;
    }
  }
  try {
    const data = await chrome.storage.session.get('comparisonWindowId');
    const stored = data && data.comparisonWindowId;
    if (stored != null) {
      await chrome.windows.get(stored);
      comparisonWindowId = stored;
      return stored;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const restricted = [
    'chrome://',
    'chrome-extension://',
    'chrome.google.com/webstore',
    'chromewebstore.google.com',
    'edge://',
    'about:',
    'devtools://',
    'view-source:',
  ];
  const lower = url.toLowerCase();
  return restricted.some((prefix) => lower.startsWith(prefix));
}

async function injectContent(tabId) {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content.css'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function tryToggle(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: FAS_TOGGLE });
    return true;
  } catch {
    return false;
  }
}

/**
 * Notify the source tab that the comparison window closed (any path:
 * our × button, footer Close tool, Esc, or OS/Chrome window close in any size).
 * Idempotent — safe if both windows.remove and onRemoved fire.
 */
/**
 * Notify the source tab that the comparison window closed.
 * @param {'exit'|'source-pick'} [reason]
 */
async function notifyComparisonClosed(reason) {
  if (comparisonCloseNotified) return;
  comparisonCloseNotified = true;

  const resolvedReason = reason || pendingCloseReason || 'exit';
  pendingCloseReason = 'exit';

  // Resolve source tab from memory or session (survives SW sleep)
  let tabId = sourceTabId;
  if (tabId == null) {
    try {
      const data = await chrome.storage.session.get('sourceTabId');
      if (data && data.sourceTabId != null) tabId = data.sourceTabId;
    } catch {
      /* ignore */
    }
  }

  await clearComparisonSession();

  if (tabId == null) return;

  let messageType = FAS_COMPARISON_CLOSED;
  if (resolvedReason === 'source-pick') messageType = FAS_ENTER_SOURCE_PICK;
  else if (resolvedReason === 'ref-pick') messageType = FAS_ENTER_REF_PICK;

  try {
    await chrome.tabs.sendMessage(tabId, { type: messageType });
  } catch {
    // Tab may be gone or content script not injected.
  }
}

/**
 * @param {number|null|undefined} preferredId
 * @param {'exit'|'source-pick'} [reason]
 */
async function closeComparisonWindow(preferredId, reason) {
  if (reason === 'source-pick' || reason === 'ref-pick') {
    pendingCloseReason = reason;
  } else {
    pendingCloseReason = 'exit';
  }
  const id = await resolveComparisonWindowId(preferredId);
  if (id == null) {
    await notifyComparisonClosed(pendingCloseReason);
    return;
  }
  // Keep comparisonWindowId until the window is gone so onRemoved can match;
  // notifyComparisonClosed is idempotent if both paths run.
  try {
    await chrome.windows.remove(id);
  } catch {
    // Already closed by the user/OS — onRemoved will (or already did) notify.
  }
  await notifyComparisonClosed(pendingCloseReason);
}

async function openComparisonWindow(payload, tabId) {
  if (!payload || !payload.imageA || !payload.imageB) {
    throw new Error('Missing image payload');
  }

  comparisonCloseNotified = false;
  sourceTabId = tabId != null ? tabId : null;

  comparisonCloseNotified = false;
  pendingCloseReason = 'exit';

  await chrome.storage.session.set({
    comparison: {
      mediaKind: payload.mediaKind || 'image',
      imageA: payload.imageA,
      imageB: payload.imageB,
      imageSource: payload.imageSource || null,
      referenceImages: payload.referenceImages || [],
      createdAt: Date.now(),
    },
    sourceTabId: sourceTabId,
  });

  // If a comparison window is already open, focus and reload it with new data.
  const existingId = await resolveComparisonWindowId(comparisonWindowId);
  if (existingId != null) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      const tabs = await chrome.tabs.query({ windowId: existingId });
      if (tabs[0] && tabs[0].id != null) {
        await chrome.tabs.reload(tabs[0].id);
      }
      await persistComparisonSession(existingId, sourceTabId);
      return { windowId: existingId };
    } catch {
      await clearComparisonSession();
      comparisonCloseNotified = false;
      sourceTabId = tabId != null ? tabId : null;
    }
  }

  const size = VIEW_SIZES.normal;
  const url = chrome.runtime.getURL('comparison.html');

  // type: 'normal' gives a full OS window (title bar, maximise, multi-monitor).
  // type: 'popup' is chromeless; maximise works less reliably on some OSes.
  const win = await chrome.windows.create({
    url,
    type: 'normal',
    focused: true,
    width: size.width,
    height: size.height,
  });

  const newId = win && win.id != null ? win.id : null;
  await persistComparisonSession(newId, sourceTabId);
  return { windowId: newId };
}

/**
 * Leave fullscreen/maximized so width/height updates are accepted by Chrome.
 * Direct fullscreen → maximized (and similar) often fails or snaps to "normal".
 * @param {number} windowId
 * @param {chrome.windows.Window} win
 */
async function ensureWindowNormal(windowId, win) {
  if (!win || (win.state !== 'fullscreen' && win.state !== 'maximized')) {
    return;
  }
  await chrome.windows.update(windowId, { state: 'normal', focused: true });
  // Give the OS a beat to leave the previous state before the next update.
  await delay(60);
}

/**
 * Apply a view size to the comparison window. Always targets the requested size.
 * @param {'small'|'normal'|'maximised'|'fullscreen'} sizeKey
 * @param {number|null|undefined} preferredWindowId
 */
async function resizeComparisonWindow(sizeKey, preferredWindowId) {
  const windowId = await resolveComparisonWindowId(preferredWindowId);
  if (windowId == null) {
    console.warn('[Flick and Slide] Resize failed: no comparison window id.');
    throw new Error('No comparison window');
  }

  const key = sizeKey === 'medium' ? 'normal' : sizeKey;
  let win = await chrome.windows.get(windowId);

  if (key === 'fullscreen') {
    // From maximized, go normal first on some platforms for reliable fullscreen.
    if (win.state === 'maximized') {
      await ensureWindowNormal(windowId, win);
    }
    await chrome.windows.update(windowId, {
      state: 'fullscreen',
      focused: true,
    });
    return { windowId, size: key };
  }

  if (key === 'maximised') {
    // Fullscreen → maximized is unreliable; exit fullscreen first, then maximize.
    if (win.state === 'fullscreen') {
      await ensureWindowNormal(windowId, win);
    }
    await chrome.windows.update(windowId, {
      state: 'maximized',
      focused: true,
    });
    // Verify; retry once if Chrome ignored the request.
    win = await chrome.windows.get(windowId);
    if (win.state !== 'maximized') {
      await delay(40);
      await chrome.windows.update(windowId, {
        state: 'maximized',
        focused: true,
      });
    }
    return { windowId, size: key };
  }

  // small / normal — must be in "normal" state before dimensions apply.
  const dims = VIEW_SIZES[key] || VIEW_SIZES.normal;
  if (win.state === 'fullscreen' || win.state === 'maximized') {
    await ensureWindowNormal(windowId, win);
  }

  await chrome.windows.update(windowId, {
    state: 'normal',
    width: dims.width,
    height: dims.height,
    focused: true,
  });

  // Verify dimensions; retry once (OS may still be settling after fullscreen exit).
  win = await chrome.windows.get(windowId);
  const wOk = Math.abs((win.width || 0) - dims.width) <= 40;
  const hOk = Math.abs((win.height || 0) - dims.height) <= 40;
  if (win.state !== 'normal' || !wOk || !hOk) {
    await delay(40);
    await chrome.windows.update(windowId, {
      state: 'normal',
      width: dims.width,
      height: dims.height,
      focused: true,
    });
  }

  return { windowId, size: key };
}

/**
 * Run resizes one at a time. If more clicks arrive during a transition,
 * only the latest size is applied afterward (no stale intermediate sizes).
 * @param {'small'|'normal'|'maximised'|'fullscreen'} sizeKey
 * @param {number|null|undefined} preferredWindowId
 */
function enqueueResize(sizeKey, preferredWindowId) {
  resizePending = { size: sizeKey, windowId: preferredWindowId };

  if (resizeRunning) {
    // Latest intent stored in resizePending; in-flight work will pick it up.
    return resizeWaiters;
  }

  resizeRunning = true;
  resizeWaiters = (async () => {
    try {
      while (resizePending) {
        const job = resizePending;
        resizePending = null;
        await resizeComparisonWindow(job.size, job.windowId);
      }
    } finally {
      resizeRunning = false;
      // Click arrived after the loop drained but before we cleared the lock.
      if (resizePending) {
        enqueueResize(resizePending.size, resizePending.windowId);
      }
    }
  })();

  return resizeWaiters;
}

// ---------------------------------------------------------------------------
// Update check (unpacked-safe: report only, no auto-install)
// ---------------------------------------------------------------------------

/**
 * Compare dotted version strings (e.g. 1.2.0). Returns 1 if a>b, -1 if a<b, 0 if equal.
 * @param {string} a
 * @param {string} b
 */
function compareVersions(a, b) {
  const pa = String(a || '0')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0')
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Fetch GitHub main manifest, compare to local version, open result window.
 */
async function checkForUpdates() {
  const localVersion = chrome.runtime.getManifest().version;

  // Brief “checking” window (replaced when result is ready)
  let winId = null;
  try {
    const checkingUrl =
      chrome.runtime.getURL('update-check.html') +
      '?state=checking&local=' +
      encodeURIComponent(localVersion);
    const win = await chrome.windows.create({
      url: checkingUrl,
      type: 'popup',
      width: 520,
      height: 480,
      focused: true,
    });
    winId = win && win.id != null ? win.id : null;
  } catch (err) {
    console.warn('[Flick and Slide] Could not open update window:', err);
  }

  let state = 'error';
  let remoteVersion = '';
  let error = '';

  try {
    const res = await fetch(REMOTE_MANIFEST_URL + '?t=' + Date.now(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error('GitHub returned HTTP ' + res.status);
    }
    const remote = await res.json();
    remoteVersion = remote && remote.version ? String(remote.version) : '';
    if (!remoteVersion) {
      throw new Error('Remote manifest has no version field');
    }
    const cmp = compareVersions(remoteVersion, localVersion);
    if (cmp > 0) state = 'update';
    else if (cmp < 0) state = 'ahead';
    else state = 'current';
  } catch (err) {
    state = 'error';
    error = err && err.message ? err.message : String(err);
    console.warn('[Flick and Slide] Update check failed:', err);
  }

  const resultUrl =
    chrome.runtime.getURL('update-check.html') +
    '?state=' +
    encodeURIComponent(state) +
    '&local=' +
    encodeURIComponent(localVersion) +
    '&remote=' +
    encodeURIComponent(remoteVersion) +
    (error ? '&error=' + encodeURIComponent(error) : '');

  try {
    if (winId != null) {
      const tabs = await chrome.tabs.query({ windowId: winId });
      if (tabs[0] && tabs[0].id != null) {
        await chrome.tabs.update(tabs[0].id, { url: resultUrl });
        return;
      }
    }
    await chrome.windows.create({
      url: resultUrl,
      type: 'popup',
      width: 520,
      height: 520,
      focused: true,
    });
  } catch (err) {
    console.error('[Flick and Slide] Could not show update result:', err);
  }
}

function ensureContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      // Ignore removeAll errors (e.g. first run)
      void chrome.runtime.lastError;
      chrome.contextMenus.create(
        {
          id: MENU_CHECK_UPDATES,
          title: 'Check for updates…',
          contexts: ['action'],
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    });
  } catch (err) {
    console.warn('[Flick and Slide] contextMenus setup failed:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenus();
});

// Service worker cold start
ensureContextMenus();

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_CHECK_UPDATES) {
    checkForUpdates();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) {
    console.warn('[Flick and Slide] No active tab id.');
    return;
  }

  if (isRestrictedUrl(tab.url)) {
    console.warn(
      '[Flick and Slide] Cannot run on this page. Open a normal website and try again.'
    );
    return;
  }

  try {
    const toggled = await tryToggle(tab.id);
    if (!toggled) {
      await injectContent(tab.id);
    }
  } catch (err) {
    console.error('[Flick and Slide] Injection failed:', err);
    try {
      await injectContent(tab.id);
    } catch (err2) {
      console.error('[Flick and Slide] Retry injection failed:', err2);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === FAS_CHECK_UPDATES) {
    checkForUpdates()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === FAS_OPEN_COMPARISON) {
    const tabId = sender.tab && sender.tab.id != null ? sender.tab.id : null;
    openComparisonWindow(msg.payload, tabId)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => {
        console.error('[Flick and Slide] Open comparison failed:', err);
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      });
    return true;
  }

  if (msg.type === FAS_GET_COMPARISON) {
    chrome.storage.session
      .get('comparison')
      .then((data) => sendResponse({ ok: true, comparison: data.comparison || null }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === FAS_CLOSE_COMPARISON) {
    const preferredId =
      sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null;
    closeComparisonWindow(preferredId, 'exit')
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === FAS_REQUEST_SOURCE_PICK) {
    const preferredId =
      sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null;
    closeComparisonWindow(preferredId, 'source-pick')
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === FAS_REQUEST_REF_PICK) {
    const preferredId =
      sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null;
    closeComparisonWindow(preferredId, 'ref-pick')
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === FAS_RESIZE_COMPARISON) {
    // Prefer the window that sent the message (survives service-worker restarts).
    const preferredId =
      sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null;
    enqueueResize(msg.size || 'normal', preferredId)
      .then((result) => sendResponse({ ok: true, ...(result || {}) }))
      .catch((err) => {
        console.error('[Flick and Slide] Resize failed:', err);
        sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
      });
    return true;
  }

  return false;
});

/**
 * Fires for every window close path: our UI close, Esc, and native OS/Chrome
 * close controls (any size: Small / Medium / Maximised / Full Screen).
 */
chrome.windows.onRemoved.addListener((windowId) => {
  // Fast path: in-memory id (normal case)
  if (comparisonWindowId != null && windowId === comparisonWindowId) {
    // Use pendingCloseReason so "Add a source image" is not treated as full exit
    notifyComparisonClosed(pendingCloseReason);
    return;
  }

  // Slow path: session storage (service worker may have restarted)
  chrome.storage.session.get('comparisonWindowId').then((data) => {
    if (data && data.comparisonWindowId === windowId) {
      notifyComparisonClosed(pendingCloseReason);
    }
  });
});
