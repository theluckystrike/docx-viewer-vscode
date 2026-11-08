// Message protocol between the extension host and the webview.
// Loaded as a plain script in the webview (window.DocxProtocol) and with require() in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocxProtocol = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 1;
  // webview -> extension
  const COMMANDS = ['openAsText', 'copyMarkdown', 'openInDefaultApp', 'openAnyway', 'reload', 'openSettings', 'showPage', 'showReading', 'pageAnyway', 'revMarkup', 'revFinal', 'revOriginal'];
  const THEMES = ['auto', 'light', 'dark'];
  const VIEWS = ['reading', 'page'];
  const PAGE_FAILURES = ['error', 'timeout', 'empty'];
  // Zoom: 50% to 300% in 10% steps. Shared by both views.
  const ZOOM = { min: 0.5, max: 3, step: 0.1 };
  function clampZoom(z) {
    const n = Number(z);
    if (!Number.isFinite(n)) return 1;
    return Math.round(Math.min(ZOOM.max, Math.max(ZOOM.min, n)) * 100) / 100;
  }
  // dir: +1, -1 or 0 (0 resets to 100%).
  function nextZoom(z, dir) {
    if (!dir) return 1;
    return clampZoom(Math.round((clampZoom(z) + dir * ZOOM.step) * 10) / 10);
  }
  // The last three are drawn by media/pictures.js before they show (see src/pictures.js).
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'image/x-emf', 'image/x-wmf', 'image/tiff'];
  const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s<>"]{1,2040}$/i;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // Returns { ok: true, msg } with only known fields, or { ok: false, error }.
  function validateInbound(m) {
    if (!isObj(m) || typeof m.type !== 'string') return { ok: false, error: 'not a message' };
    switch (m.type) {
      case 'ready':
        return { ok: true, msg: { type: 'ready' } };
      case 'command':
        if (COMMANDS.indexOf(m.name) === -1) return { ok: false, error: 'unknown command' };
        return { ok: true, msg: { type: 'command', name: m.name } };
      case 'openLink':
        if (typeof m.href !== 'string' || !SAFE_LINK.test(m.href)) return { ok: false, error: 'link not allowed' };
        return { ok: true, msg: { type: 'openLink', href: m.href } };
      case 'setTheme':
        if (THEMES.indexOf(m.theme) === -1) return { ok: false, error: 'unknown theme' };
        return { ok: true, msg: { type: 'setTheme', theme: m.theme } };
      case 'setZoom':
        if (typeof m.zoom !== 'number' || !Number.isFinite(m.zoom)) return { ok: false, error: 'bad zoom' };
        return { ok: true, msg: { type: 'setZoom', zoom: clampZoom(m.zoom) } };
      case 'pageFailed':
        return { ok: true, msg: { type: 'pageFailed', reason: PAGE_FAILURES.indexOf(m.reason) === -1 ? 'error' : m.reason, ms: Number.isFinite(m.ms) ? Math.round(m.ms) : 0 } };
      case 'setToolbar':
        return { ok: true, msg: { type: 'setToolbar', hidden: m.hidden === true } };
      case 'pageRendered':
        return { ok: true, msg: { type: 'pageRendered', ms: Number.isFinite(m.ms) ? Math.round(m.ms) : 0, pages: Number.isInteger(m.pages) ? m.pages : 0 } };
      default:
        return { ok: false, error: 'unknown type' };
    }
  }

  // Splits a conversion result into the messages the extension posts, in order.
  function buildRenderMessages(result, meta) {
    const total = result.chunks.length;
    const banner = typeof result.banner === 'string' ? result.banner : '';
    const bannerActions = Array.isArray(result.bannerActions) ? result.bannerActions.filter((a) => COMMANDS.indexOf(a) !== -1) : [];
    const revisions = isObj(result.revisions) ? { label: String(result.revisions.label || ''), mode: result.revisions.mode, authors: (result.revisions.authors || []).map(String).slice(0, 20) } : null;
    const out = [{ type: 'begin', v: VERSION, meta: meta, total: total, banner: banner, bannerActions: bannerActions, revisions: revisions }];
    for (let i = 0; i < total; i++) out.push({ type: 'chunk', index: i, total: total, html: result.chunks[i] });
    if (Array.isArray(result.images) && result.images.length) out.splice(1, 0, { type: 'images', list: result.images });
    out.push({ type: 'end', outline: result.outline, warnings: result.warnings, stats: result.stats, changes: isObj(result.changeTable) ? result.changeTable : null });
    return out;
  }

  function buildNotice(notice, meta, actions) {
    return { type: 'notice', v: VERSION, meta: meta, kind: notice.kind, title: notice.title, detail: notice.detail, actions: (actions || []).filter((a) => COMMANDS.indexOf(a) !== -1) };
  }

  // Checks messages arriving in the webview. Returns true when the shape is right.
  function validateOutbound(m) {
    if (!isObj(m)) return false;
    switch (m.type) {
      case 'begin': return isObj(m.meta) && Number.isInteger(m.total) && m.total >= 1 && (m.banner === undefined || typeof m.banner === 'string') && (m.bannerActions === undefined || (Array.isArray(m.bannerActions) && m.bannerActions.every((a) => COMMANDS.indexOf(a) !== -1)));
      case 'pageData': return isObj(m.meta) && (m.bytes instanceof Uint8Array || m.bytes instanceof ArrayBuffer) && THEMES.indexOf(m.theme) !== -1;
      case 'zoom': return typeof m.zoom === 'number';
      case 'pageNote': return typeof m.text === 'string' && Array.isArray(m.actions) && m.actions.every((a) => COMMANDS.indexOf(a) !== -1);
      case 'chunk': return Number.isInteger(m.index) && m.index >= 0 && m.index < m.total && typeof m.html === 'string';
      case 'end': return Array.isArray(m.outline) && Array.isArray(m.warnings) && isObj(m.stats);
      case 'notice': return typeof m.title === 'string' && typeof m.detail === 'string' && Array.isArray(m.actions);
      case 'theme': return THEMES.indexOf(m.theme) !== -1;
      case 'images': return Array.isArray(m.list) && m.list.every((im) => isObj(im) && IMAGE_TYPES.indexOf(im.type) !== -1 && (im.data instanceof Uint8Array || im.data instanceof ArrayBuffer));
      case 'toolbar': return typeof m.hidden === 'boolean';
      case 'font': return typeof m.font === 'string';
      case 'find': case 'loading': return true;
      default: return false;
    }
  }

  // Toolbar hide/show buttons, shared by Reading view and Page view. Ctrl+Shift+H is a VS Code
  // keybinding (command docxViewer.toggleToolbar), so the workbench gets the key, not the webview.
  function setupToolbar(doc, vscode) {
    const body = doc.body;
    const set = (hidden, post) => {
      body.dataset.bar = hidden ? 'hidden' : 'shown';
      if (post) vscode.postMessage({ type: 'setToolbar', hidden: hidden });
    };
    const hide = doc.getElementById('dv-bar-hide');
    const show = doc.getElementById('dv-bar-show');
    if (hide) hide.addEventListener('click', function () { set(true, true); });
    if (show) show.addEventListener('click', function () { set(false, true); });
    return set;
  }

  // ---------- EMF, WMF and TIFF pictures ----------
  // media/pictures.js (src/pictures.js) draws them. It loads on the first such picture only, from the
  // URL in <body data-pictures>, with the nonce of the page's own scripts. Pictures are drawn one
  // at a time with a pause between them, so the view stays responsive.
  const PICTURE_NAMES = { 'image/x-emf': 'EMF', 'image/x-wmf': 'WMF', 'image/tiff': 'TIFF', emf: 'EMF', wmf: 'WMF', tif: 'TIFF', tiff: 'TIFF' };
  let picturesLib = null;
  let pictureQueue = Promise.resolve();
  function loadPictures(doc) {
    if (picturesLib) return picturesLib;
    picturesLib = new Promise(function (resolve, reject) {
      const win = doc.defaultView || self;
      if (win.DocxPictures) { resolve(win.DocxPictures); return; }
      const src = doc.body && doc.body.getAttribute('data-pictures');
      if (!src) { reject(new Error('the picture code is missing')); return; }
      const own = doc.querySelector('script[nonce]');
      const s = doc.createElement('script');
      if (own) s.nonce = own.nonce || own.getAttribute('nonce');
      s.src = src;
      s.onload = function () { if (win.DocxPictures) resolve(win.DocxPictures); else reject(new Error('the picture code did not start')); };
      s.onerror = function () { reject(new Error('the picture code did not load')); };
      doc.head.appendChild(s);
    });
    picturesLib.catch(function () { picturesLib = null; });
    return picturesLib;
  }
  // Resolves to a Blob (SVG or PNG); rejects with an Error whose message says why.
  function drawPicture(doc, bytes, kind, limits) {
    const job = pictureQueue.then(function () { return new Promise(function (r) { setTimeout(r, 0); }); })
      .then(function () { return loadPictures(doc); })
      .then(function (lib) { return lib.draw(bytes, lib.kindOfType(kind) || kind, limits); });
    pictureQueue = job.catch(function () {});
    return job;
  }
  function pictureName(kind) { return PICTURE_NAMES[String(kind || '').toLowerCase()] || 'picture'; }
  // "Picture could not be drawn (EMF): <reason>"
  function pictureMessage(kind, err) {
    return 'Picture could not be drawn (' + pictureName(kind) + ')' + (err && err.message ? ': ' + String(err.message).slice(0, 160) : '');
  }

  return { VERSION, COMMANDS, IMAGE_TYPES, PICTURE_NAMES, loadPictures, drawPicture, pictureName, pictureMessage, setupToolbar, THEMES, VIEWS, ZOOM, clampZoom, nextZoom, validateInbound, validateOutbound, buildRenderMessages, buildNotice };
});
