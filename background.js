/**
 * Flick and Slide – Background service worker (Manifest V3)
 *
 * Listens for toolbar icon clicks and dynamically injects the content
 * script + stylesheet into the active tab. Re-clicks toggle selection mode
 * via a message when the content script is already present.
 */

'use strict';

const FAS_MESSAGE = 'FAS_TOGGLE';

/** URLs where chrome.scripting cannot inject content scripts. */
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

/**
 * Inject CSS + JS into the given tab, then the content script auto-activates.
 * @param {number} tabId
 */
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

/**
 * Try messaging an already-injected content script. Returns true if delivered.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function tryToggle(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: FAS_MESSAGE });
    return true;
  } catch {
    // No receiver (content script not injected yet, or page navigated).
    return false;
  }
}

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
    // Retry once with a fresh inject in case messaging failed for other reasons.
    try {
      await injectContent(tab.id);
    } catch (err2) {
      console.error('[Flick and Slide] Retry injection failed:', err2);
    }
  }
});
