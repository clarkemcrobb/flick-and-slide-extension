/**
 * Flick and Slide – Update check result page
 * Opened by the service worker after comparing local vs GitHub manifest versions.
 */

'use strict';

const REPO_URL = 'https://github.com/clarkemcrobb/flick-and-slide-extension';
const ZIP_URL =
  'https://github.com/clarkemcrobb/flick-and-slide-extension/archive/refs/heads/main.zip';

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, kind) {
  const el = $('status');
  el.textContent = text;
  el.className = 'status ' + (kind || '');
}

function params() {
  const q = new URLSearchParams(window.location.search);
  return {
    local: q.get('local') || '',
    remote: q.get('remote') || '',
    state: q.get('state') || 'error',
    error: q.get('error') || '',
  };
}

function render() {
  const p = params();
  const meta = $('meta');
  const steps = $('steps');
  const actions = $('actions');

  actions.innerHTML = '';
  steps.hidden = true;
  steps.innerHTML = '';

  if (p.state === 'checking') {
    setStatus('Checking GitHub…', 'checking');
    meta.innerHTML = 'Please wait.';
    return;
  }

  if (p.state === 'error') {
    setStatus('Could not check for updates', 'error');
    meta.innerHTML =
      '<strong>Installed version:</strong> ' +
      (p.local || 'unknown') +
      '<br/>' +
      (p.error
        ? '<strong>Error:</strong> ' + escapeHtml(p.error)
        : 'Unable to reach GitHub. Check your network connection and try again.');
    actions.appendChild(
      linkBtn('Open repository', REPO_URL, false)
    );
    actions.appendChild(button('Check again', () => {
      chrome.runtime.sendMessage({ type: 'FAS_CHECK_UPDATES' });
      window.close();
    }));
    return;
  }

  meta.innerHTML =
    '<strong>Installed version:</strong> ' +
    escapeHtml(p.local) +
    '<br/><strong>GitHub version:</strong> ' +
    escapeHtml(p.remote || 'unknown');

  if (p.state === 'current') {
    setStatus('You are up to date', 'ok');
    meta.innerHTML +=
      '<br/><br/>No newer version was found on the main branch of the GitHub repository.';
    actions.appendChild(linkBtn('View on GitHub', REPO_URL, false));
    return;
  }

  if (p.state === 'update') {
    setStatus('Update available', 'update');
    meta.innerHTML +=
      '<br/><br/>A newer version is on GitHub. Unpacked extensions cannot auto-update — follow the steps below.';
    steps.hidden = false;
    steps.innerHTML =
      '<ol>' +
      '<li>Download the latest ZIP from GitHub (button below), or pull the latest files if you cloned the repo.</li>' +
      '<li>Unzip the download. You should see a folder containing <code>manifest.json</code>.</li>' +
      '<li>Replace the contents of your current extension folder with the new files (or point Chrome at the new folder).</li>' +
      '<li>Open <code>chrome://extensions</code>, find <strong>Flick and Slide</strong>, and click <strong>Reload</strong>.</li>' +
      '<li>Refresh any tabs where you use the extension.</li>' +
      '</ol>';
    actions.appendChild(linkBtn('Download latest ZIP', ZIP_URL, true));
    actions.appendChild(linkBtn('Open repository', REPO_URL, false));
    return;
  }

  if (p.state === 'ahead') {
    setStatus('Local version is newer', 'ok');
    meta.innerHTML +=
      '<br/><br/>Your installed version is ahead of the GitHub main branch (common while developing locally).';
    actions.appendChild(linkBtn('View on GitHub', REPO_URL, false));
    return;
  }

  setStatus('Update check finished', 'checking');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function linkBtn(label, href, primary) {
  const a = document.createElement('a');
  a.className = 'btn' + (primary ? ' primary' : '');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = label;
  return a;
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

render();
