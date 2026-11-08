// Webview script. Receives sanitized HTML chunks, builds the outline, runs search.
(function () {
  'use strict';
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: function () {}, getState: function () { return null; }, setState: function () {} };
  const P = window.DocxProtocol;
  const S = window.DocxSearch;
  const $ = (id) => document.getElementById(id);
  const doc = $('dv-doc');
  const scroller = $('dv-scroll');
  const statusEl = $('dv-status');
  const outlineNav = $('dv-outline');
  const outlineList = $('dv-outline-list');
  const q = $('dv-q');
  const countEl = $('dv-count');
  const themeBtn = $('dv-theme');
  const saved = vscode.getState() || {};
  const state = { theme: saved.theme || document.body.dataset.theme || 'auto', outlineOpen: saved.outlineOpen !== false, scrollTop: saved.scrollTop || 0, query: saved.query || '' };
  let loaded = false;
  let marks = [];
  let current = -1;
  let capped = false;
  const MAX_MARKS = 5000;

  function save() { vscode.setState(state); }
  const setToolbar = P.setupToolbar(document, vscode);

  // docxViewer.fontFamily: '' keeps the Word-like default, 'editor' uses the editor font.
  function applyFont(f) {
    doc.style.fontFamily = f === 'editor' ? 'var(--vscode-editor-font-family, monospace)' : (f || '');
  }
  applyFont(document.body.dataset.font || '');

  // Pictures arrive as bytes next to the HTML; each becomes a blob: URL. EMF, WMF and TIFF are
  // drawn first (media/pictures.js, one at a time); until then their <img> waits without a src,
  // and a picture that cannot be drawn becomes a short note in the text.
  let imageUrls = [];
  let imageFails = [];
  let imageGen = 0;
  const drawnUrls = new Set();
  function failImage(img, text) {
    const span = document.createElement('span');
    span.className = 'dv-img-skipped';
    span.textContent = '[' + text + ']';
    img.replaceWith(span);
  }
  function setImages(list) {
    imageUrls.forEach(function (u) { if (u) URL.revokeObjectURL(u); });
    const gen = ++imageGen;
    imageFails = [];
    imageUrls = list.map(function (im, i) {
      if (!P.PICTURE_NAMES[im.type]) return URL.createObjectURL(new Blob([im.data], { type: im.type }));
      // The converter already applied docxViewer.maxImageSizeMB to these bytes.
      P.drawPicture(document, im.data, im.type, { maxBytes: Infinity }).then(function (blob) {
        if (gen !== imageGen) return;
        const u = URL.createObjectURL(blob);
        imageUrls[i] = u;
        drawnUrls.add(u);
        doc.querySelectorAll('img[data-dv-img="' + i + '"]').forEach(function (img) { img.src = u; img.classList.remove('dv-img-drawing'); img.classList.add('dv-drawn'); });
      }, function (err) {
        if (gen !== imageGen) return;
        imageFails[i] = P.pictureMessage(im.type, err);
        doc.querySelectorAll('img[data-dv-img="' + i + '"]').forEach(function (img) { failImage(img, imageFails[i]); });
      });
      return null;
    });
  }
  function bindImages(root) {
    root.querySelectorAll('img[data-dv-img]').forEach(function (img) {
      const i = Number(img.getAttribute('data-dv-img'));
      if (imageFails[i]) { failImage(img, imageFails[i]); return; }
      const u = imageUrls[i];
      if (u === null) img.classList.add('dv-img-drawing');
      else if (u) { img.src = u; if (drawnUrls.has(u)) img.classList.add('dv-drawn'); }
    });
  }

  function applyTheme() {
    document.body.dataset.theme = state.theme;
    themeBtn.textContent = 'Theme: ' + state.theme.charAt(0).toUpperCase() + state.theme.slice(1);
  }
  function applyOutline() {
    outlineNav.hidden = !state.outlineOpen;
    $('dv-outline-toggle').setAttribute('aria-pressed', String(state.outlineOpen));
  }
  applyTheme();
  applyOutline();
  q.value = state.query;

  themeBtn.addEventListener('click', function () {
    const i = P.THEMES.indexOf(state.theme);
    state.theme = P.THEMES[(i + 1) % P.THEMES.length];
    applyTheme();
    save();
    vscode.postMessage({ type: 'setTheme', theme: state.theme });
  });
  $('dv-outline-toggle').addEventListener('click', function () {
    state.outlineOpen = !state.outlineOpen;
    applyOutline();
    save();
  });
  document.querySelectorAll('[data-cmd]').forEach(function (b) {
    b.addEventListener('click', function () { vscode.postMessage({ type: 'command', name: b.dataset.cmd }); });
  });

  // ---------- rendering ----------
  function resetView(meta) {
    clearMarks();
    doc.textContent = '';
    outlineList.textContent = '';
    $('dv-warnings').hidden = true;
    $('dv-banner').hidden = true;
    $('dv-rev').hidden = true;
    statusEl.hidden = false;
    statusEl.className = 'dv-status';
    statusEl.textContent = 'Opening document...';
    if (meta && meta.fileName) $('dv-name').textContent = meta.fileName;
    loaded = false;
    document.body.classList.remove('dv-noticing');
  }

  function appendChunk(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html; // sanitized by src/html.js in the extension host; CSP blocks scripts anyway
    bindImages(tpl.content);
    doc.appendChild(tpl.content);
    if (doc.hidden) { doc.hidden = false; statusEl.hidden = true; }
  }

  function renderOutline(items) {
    outlineList.textContent = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'dv-outline-empty';
      li.textContent = 'No headings';
      outlineList.appendChild(li);
      return;
    }
    const min = Math.min.apply(null, items.map(function (i) { return i.level; }));
    items.forEach(function (it) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = '#' + it.id;
      a.textContent = it.text;
      a.title = it.text;
      a.style.paddingLeft = (8 + (it.level - min) * 12) + 'px';
      a.addEventListener('click', function (e) {
        e.preventDefault();
        const el = document.getElementById(it.id);
        if (el) el.scrollIntoView({ block: 'start' });
      });
      li.appendChild(a);
      outlineList.appendChild(li);
    });
  }

  function renderWarnings(list, stats) {
    const box = $('dv-warnings');
    const notes = list.slice();
    if (stats && stats.skippedImages) notes.unshift(stats.skippedImages + ' image(s) not shown. See the placeholder text in the document.');
    if (!notes.length) { box.hidden = true; return; }
    box.querySelector('summary').textContent = notes.length + ' conversion note' + (notes.length === 1 ? '' : 's');
    const ul = box.querySelector('ul');
    ul.textContent = '';
    notes.forEach(function (w) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
    box.hidden = false;
  }

  function renderNotice(m) {
    resetView(m.meta);
    document.body.classList.add('dv-noticing');
    statusEl.className = 'dv-status dv-notice';
    statusEl.textContent = '';
    const h = document.createElement('h2');
    h.textContent = m.title;
    const p = document.createElement('p');
    p.textContent = m.detail;
    statusEl.appendChild(h);
    statusEl.appendChild(p);
    const labels = LABELS;
    const row = document.createElement('div');
    row.className = 'dv-actions';
    m.actions.forEach(function (name) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dv-btn dv-primary';
      b.textContent = labels[name] || name;
      b.addEventListener('click', function () { vscode.postMessage({ type: 'command', name: name }); });
      row.appendChild(b);
    });
    statusEl.appendChild(row);
    outlineList.textContent = '';
  }

  // Grey note above the document (old .doc files, Page view fallbacks) with its buttons.
  const LABELS = { openInDefaultApp: 'Open in default app', openAnyway: 'Open anyway', reload: 'Try again', openSettings: 'Change the limit', pageAnyway: 'Open in Page view anyway', showPage: 'Page view' };
  function actionButton(name) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dv-btn';
    b.textContent = LABELS[name] || name;
    b.addEventListener('click', function () { vscode.postMessage({ type: 'command', name: name }); });
    return b;
  }
  function renderBanner(text, actions) {
    $('dv-banner-text').textContent = text;
    const box = $('dv-banner-actions');
    box.textContent = '';
    actions.forEach(function (a) { box.appendChild(actionButton(a)); });
    $('dv-banner').hidden = false;
  }

  // ---------- tracked changes and comments ----------
  const KIND = { ins: 'Inserted', moveTo: 'Moved here', del: 'Deleted', moveFrom: 'Moved away' };
  document.querySelectorAll('[data-rev]').forEach(function (b) {
    b.addEventListener('click', function () { vscode.postMessage({ type: 'command', name: b.dataset.rev }); });
  });
  function renderRevisions(rev) {
    $('dv-rev-text').textContent = rev.label;
    const box = $('dv-rev-authors');
    box.textContent = '';
    if (rev.mode === 'markup') {
      rev.authors.slice(0, 8).forEach(function (name, i) {
        const s = document.createElement('span');
        s.className = 'dv-rev-author dv-a' + (i + 1);
        s.textContent = name;
        box.appendChild(s);
      });
    }
    const name = { markup: 'revMarkup', final: 'revFinal', original: 'revOriginal' }[rev.mode];
    document.querySelectorAll('[data-rev]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.rev === name)); });
    $('dv-rev').hidden = false;
  }
  // Hover text on each change: who and when.
  function labelChanges(table) {
    doc.querySelectorAll('ins.dv-ins, del.dv-del').forEach(function (el) {
      const id = Array.prototype.find.call(el.classList, function (c) { return /^dv-c\d+$/.test(c); });
      const c = id && table[id.slice(3)];
      if (c) el.title = (KIND[c.kind] || 'Changed') + ' by ' + c.author + (c.date ? ' on ' + c.date : '');
    });
  }

  // ---------- zoom (CSS zoom keeps text selectable) ----------
  state.zoom = P.clampZoom(document.body.dataset.zoom || 1);
  function applyZoom(post) {
    doc.style.zoom = String(state.zoom);
    $('dv-zoom-label').textContent = Math.round(state.zoom * 100) + '%';
    if (post) vscode.postMessage({ type: 'setZoom', zoom: state.zoom });
  }
  function zoomBy(dir) { state.zoom = P.nextZoom(state.zoom, dir); applyZoom(true); }
  $('dv-zoom-in').addEventListener('click', function () { zoomBy(1); });
  $('dv-zoom-out').addEventListener('click', function () { zoomBy(-1); });
  $('dv-zoom-label').addEventListener('click', function () { zoomBy(0); });
  applyZoom(false);

  // ---------- links ----------
  doc.addEventListener('click', function (e) {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.charAt(0) === '#') {
      const el = document.getElementById(href.slice(1));
      if (el) el.scrollIntoView({ block: 'center' });
    } else {
      vscode.postMessage({ type: 'openLink', href: href });
    }
  });

  // ---------- search ----------
  function clearMarks() {
    marks.forEach(function (m) {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    marks = [];
    current = -1;
    capped = false;
  }

  function runSearch() {
    clearMarks();
    const query = q.value;
    state.query = query;
    save();
    if (!query) { countEl.textContent = ''; return; }
    // Text inside SVG charts and MathML equations is left alone: a <mark> there would not draw.
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT, { acceptNode: function (n) { return n.parentNode && n.parentNode.closest && n.parentNode.closest('svg, math') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let i = 0; i < nodes.length && marks.length < MAX_MARKS; i++) {
      const node = nodes[i];
      const found = S.findMatches(node.nodeValue, query, { max: MAX_MARKS - marks.length });
      if (!found.length) continue;
      const frag = document.createDocumentFragment();
      let pos = 0;
      const text = node.nodeValue;
      found.forEach(function (r) {
        if (r[0] > pos) frag.appendChild(document.createTextNode(text.slice(pos, r[0])));
        const mark = document.createElement('mark');
        mark.className = 'dv-hit';
        mark.textContent = text.slice(r[0], r[1]);
        frag.appendChild(mark);
        marks.push(mark);
        pos = r[1];
      });
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    }
    capped = marks.length >= MAX_MARKS;
    if (marks.length) go(0); else countEl.textContent = S.countLabel(0, 0, false);
  }

  function go(i) {
    if (!marks.length) return;
    if (current >= 0 && marks[current]) marks[current].classList.remove('dv-current');
    current = (i + marks.length) % marks.length;
    marks[current].classList.add('dv-current');
    marks[current].scrollIntoView({ block: 'center' });
    countEl.textContent = S.countLabel(current, marks.length, capped);
  }

  let timer = null;
  q.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (loaded) runSearch(); }, 180);
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (!marks.length) runSearch(); else go(current + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { q.value = ''; runSearch(); scroller.focus(); }
  });
  $('dv-next').addEventListener('click', function () { go(current + 1); });
  $('dv-prev').addEventListener('click', function () { go(current - 1); });
  function focusSearch() { q.focus(); q.select(); }
  window.addEventListener('keydown', function (e) {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); focusSearch(); }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1); }
    if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(-1); }
    if (mod && e.key === '0') { e.preventDefault(); zoomBy(0); }
    if (e.key === 'F3') { e.preventDefault(); go(current + (e.shiftKey ? -1 : 1)); }
  });

  // Shift + mouse wheel scrolls sideways: wide tables and pictures (Page view has the same).
  // The scroller itself first, then the nearest wider block under the pointer (a wide table or
  // <pre> scrolls inside its own box).
  scroller.addEventListener('wheel', function (e) {
    if (!e.shiftKey || e.deltaX || !e.deltaY) return;
    let el = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
    while (el && el !== scroller && !(el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX))) el = el.parentElement;
    const box = el && el !== scroller ? el : scroller;
    if (box.scrollWidth <= box.clientWidth + 1) return;
    box.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  let scrollSave = null;
  scroller.addEventListener('scroll', function () {
    clearTimeout(scrollSave);
    scrollSave = setTimeout(function () { state.scrollTop = scroller.scrollTop; save(); }, 200);
  });

  // ---------- messages ----------
  window.addEventListener('message', function (event) {
    const m = event.data;
    if (!P.validateOutbound(m)) return;
    switch (m.type) {
      case 'loading': resetView(m.meta); break;
      case 'begin':
        resetView(m.meta);
        if (m.banner) renderBanner(m.banner, m.bannerActions || []);
        if (m.revisions) renderRevisions(m.revisions);
        break;
      case 'images': setImages(m.list); break;
      case 'chunk': appendChunk(m.html); break;
      case 'end':
        loaded = true;
        if (!doc.childNodes.length) { doc.hidden = false; statusEl.hidden = true; doc.innerHTML = '<p class="dv-empty">This document has no text.</p>'; }
        renderOutline(m.outline);
        renderWarnings(m.warnings, m.stats);
        if (m.changes) labelChanges(m.changes);
        if (state.scrollTop) scroller.scrollTop = state.scrollTop;
        if (q.value) runSearch();
        break;
      case 'notice': renderNotice(m); break;
      case 'theme': state.theme = m.theme; applyTheme(); save(); break;
      case 'zoom': state.zoom = P.clampZoom(m.zoom); applyZoom(false); break;
      case 'find': focusSearch(); break;
      case 'toolbar': setToolbar(m.hidden, false); break;
      case 'font': applyFont(m.font); break;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
