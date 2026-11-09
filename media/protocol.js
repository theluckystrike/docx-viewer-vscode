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
  const COMMANDS = ['openAsText', 'copyMarkdown', 'openInDefaultApp', 'openAnyway', 'reload', 'openSettings', 'showPage', 'showReading', 'pageAnyway', 'revMarkup', 'revFinal', 'revOriginal', 'compare'];
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
  // EXEC9: what the custom format line is about. A kind of element, never document text.
  const CUSTOM_WHAT = /^[A-Za-z0-9.+-]{1,16}( [A-Za-z0-9.+-]{1,16})? (images|pictures|formatting)$/;

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
      case 'customClaim':
        if (typeof m.what !== 'string' || !CUSTOM_WHAT.test(m.what)) return { ok: false, error: 'bad kind' };
        return { ok: true, msg: { type: 'customClaim', what: m.what } };
      case 'customOpen':
        if (m.which !== 'request' && m.which !== 'tier') return { ok: false, error: 'unknown link' };
        return { ok: true, msg: { type: 'customOpen', which: m.which } };
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
      case 'customGrant': return Number.isInteger(m.usd) && m.usd > 0;
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
    const job = pictureQueue.then(yieldTask)
      .then(function () { return loadPictures(doc); })
      .then(function (lib) { return lib.draw(bytes, lib.kindOfType(kind) || kind, limits); });
    pictureQueue = job.catch(function () {});
    return job;
  }
  // A pause that lets the page paint and handle input between pictures. MessageChannel, not
  // setTimeout: timers in a webview that is still loading can be held back for a second each.
  function yieldTask() {
    return new Promise(function (resolve) {
      if (typeof MessageChannel !== 'function') { setTimeout(resolve, 0); return; }
      const ch = new MessageChannel();
      ch.port1.onmessage = function () { ch.port1.close(); resolve(); };
      ch.port2.postMessage(0);
    });
  }
    function pictureName(kind) { return PICTURE_NAMES[String(kind || '').toLowerCase()] || 'picture'; }
  // "Picture could not be drawn (EMF): <reason>"
  function pictureMessage(kind, err) {
    return 'Picture could not be drawn (' + pictureName(kind) + ')' + (err && err.message ? ': ' + String(err.message).slice(0, 160) : '');
  }

  // ---------- EXEC9: the USD 299 custom format line next to a part the viewer does not show ----------
  // Targets carry data-dv-unsup="<kind>" (a placeholder) or are the "Text only" banner. Nothing happens on open:
  // after the user's first click, key, wheel or touch in the view, the first target that is on screen asks the host
  // (customClaim). The host says yes once per session (customGrant); then one line goes right after that target.
  // The two links only post customOpen; the host opens the page. No network from here.
  const TEXT_ONLY = /Text only: formatting, images and layout are not shown\./;
  function customKind(el) {
    const k = el.getAttribute && el.getAttribute('data-dv-unsup');
    if (k) return k;
    const t = el.textContent || '';
    return TEXT_ONLY.test(t) ? (/RTF/.test(t) ? 'RTF formatting' : 'Word 97-2003 formatting') : '';
  }
  function setupCustomOffer(doc, vscode, scroller, findTargets) {
    const st = { acted: false, asked: false, target: null, line: null };
    const win = doc.defaultView;
    function onScreen(el) {
      const r = el.getBoundingClientRect();
      const v = scroller.getBoundingClientRect();
      return r.bottom > v.top && r.top < v.bottom && (r.width > 0 || r.height > 0);
    }
    function check() {
      if (st.asked || !st.acted) return;
      const list = findTargets();
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const what = customKind(el);
        if (!what || !CUSTOM_WHAT.test(what) || !onScreen(el)) continue;
        st.asked = true;
        st.target = el;
        vscode.postMessage({ type: 'customClaim', what: what });
        return;
      }
    }
    // A VS Code shortcut (Ctrl, Cmd or Alt + key) or a lone modifier is not reading the document: it does not count.
    function act(e) {
      if (e && e.type === 'keydown' && (e.ctrlKey || e.metaKey || e.altKey || /^(Shift|Control|Meta|Alt|CapsLock|Fn)$/.test(e.key || ''))) return;
      st.acted = true; check();
    }
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { win.addEventListener(t, act, { capture: true, passive: true }); });
    let timer = null;
    scroller.addEventListener('scroll', function () { if (!st.acted || st.asked) return; clearTimeout(timer); timer = setTimeout(check, 150); }, { passive: true });
    function link(which, text) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'dv-linkbtn';
      b.textContent = text;
      b.title = which === 'tier' ? 'Opens the GitHub Sponsors tier in the browser' : 'Opens the format request form on GitHub in the browser';
      b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ type: 'customOpen', which: which }); });
      return b;
    }
    return {
      // A new document or view: forget the target and wait for a new user action.
      reset: function () { st.acted = false; st.asked = false; st.target = null; if (st.line && st.line.parentNode) st.line.parentNode.removeChild(st.line); st.line = null; },
      check: check,
      grant: function (m) {
        const el = st.target;
        if (!el || !el.isConnected || st.line) return;
        const span = doc.createElement('span');
        span.className = 'dv-customfmt';
        span.appendChild(doc.createTextNode(' '));
        span.appendChild(link('request', 'Request support for this (free)'));
        span.appendChild(doc.createTextNode(', or '));
        span.appendChild(link('tier', 'we build it for USD ' + m.usd + ' once'));
        span.appendChild(doc.createTextNode('.'));
        if (el.id === 'dv-banner') { const t = doc.getElementById('dv-banner-text'); (t || el).appendChild(span); } else el.insertAdjacentElement('afterend', span);
        st.line = span;
      },
      state: st
    };
  }

  return { VERSION, COMMANDS, CUSTOM_WHAT, customKind, setupCustomOffer, IMAGE_TYPES, PICTURE_NAMES, loadPictures, drawPicture, pictureName, pictureMessage, setupToolbar, THEMES, VIEWS, ZOOM, clampZoom, nextZoom, validateInbound, validateOutbound, buildRenderMessages, buildNotice };
});
