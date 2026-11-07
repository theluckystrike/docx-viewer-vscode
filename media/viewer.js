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
    const labels = { openInDefaultApp: 'Open in default app', openAnyway: 'Open anyway', reload: 'Try again', openSettings: 'Change the limit' };
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
    const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
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
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); focusSearch(); }
    if (e.key === 'F3') { e.preventDefault(); go(current + (e.shiftKey ? -1 : 1)); }
  });

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
        if (m.banner) { $('dv-banner-text').textContent = m.banner; $('dv-banner').hidden = false; }
        break;
      case 'chunk': appendChunk(m.html); break;
      case 'end':
        loaded = true;
        if (!doc.childNodes.length) { doc.hidden = false; statusEl.hidden = true; doc.innerHTML = '<p class="dv-empty">This document has no text.</p>'; }
        renderOutline(m.outline);
        renderWarnings(m.warnings, m.stats);
        if (state.scrollTop) scroller.scrollTop = state.scrollTop;
        if (q.value) runSearch();
        break;
      case 'notice': renderNotice(m); break;
      case 'theme': state.theme = m.theme; applyTheme(); save(); break;
      case 'find': focusSearch(); break;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
