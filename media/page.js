// Page view webview script. Lays out the .docx with docx-preview (window.DocxPreview, bundled
// from src/page-entry.js into media/page-view.js) and adds outline, search, zoom, links and the
// fallback to Reading view. Helpers are exported for the unit tests (require in Node with jsdom).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.DocxPage = api;
    if (typeof acquireVsCodeApi === 'function') api.boot(root, acquireVsCodeApi());
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // docx-preview options. altChunks are raw HTML parts, so they never render. Changes and
  // comments stay off. Blob URLs keep memory lower than base64 for images.
  const RENDER_OPTIONS = {
    className: 'docx',
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderAltChunks: false,
    renderChanges: false,
    renderComments: false,
    useBase64URL: false,
    experimental: false,
    trimXmlDeclaration: true,
    debug: false
  };
  const TIMEOUT_MS = 20000;
  const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s<>"]{1,2040}$/i;
  const HEADING = /(?:^|\s)docx_(title|heading([1-9]))(?:\s|$)/;
  const REMOTE = /^\s*(https?:|\/\/|ftp:|file:)/i;

  // EMF, WMF and TIFF pictures: docx-preview hands each picture to the hook; these three are drawn
  // by media/pictures.js (through DocxProtocol.drawPicture) and the rest pass through unchanged.
  // A picture that cannot be drawn becomes a small box that says so. urls collects the blob: URLs.
  const DRAWN = /\.(emf|wmf|tiff?)$/i;
  function pictureHook(doc, P, limits, urls) {
    return function (blob, path, original) {
      const m = DRAWN.exec(path || '');
      if (!m || !blob) return original(blob, path);
      const kind = m[1].toLowerCase();
      const keep = function (b) { const u = URL.createObjectURL(b); urls.push(u); return u; };
      return Promise.resolve().then(function () {
        if (limits && blob.size > limits.maxBytes) throw new Error('it is over the ' + Math.round(limits.maxBytes / 1048576) + ' MB picture limit');
        return blob.arrayBuffer();
      }).then(function (ab) { return P.drawPicture(doc, new Uint8Array(ab), kind, limits); }).then(keep, function (err) {
        return keep(new Blob([placeholderSvg(P.pictureMessage(kind, err))], { type: 'image/svg+xml' }));
      });
    };
  }
  function placeholderSvg(text) {
    const t = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const short = t.split(':')[0];
    return '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="60" viewBox="0 0 320 60"><title>' + t + '</title>' +
      '<rect x="1" y="1" width="318" height="58" fill="#f3f3f3" stroke="#999" stroke-dasharray="4 3"/>' +
      '<text x="160" y="34" font-family="sans-serif" font-size="13" fill="#555" text-anchor="middle">' + short + '</text></svg>';
  }

  // Lays the document out into body. Rejects with Error('timeout' | 'empty' | <docx-preview error>).
  function renderPages(renderAsync, data, body, styleEl, timeoutMs, imageHook) {
    let timer = null;
    const timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error('timeout')); }, timeoutMs || TIMEOUT_MS);
    });
    const work = Promise.resolve().then(function () { return renderAsync(data, body, styleEl, RENDER_OPTIONS, imageHook); }).then(function () {
      scrub(body);
      const pages = body.querySelectorAll('section.docx').length;
      if (!pages) throw new Error('empty');
      return pages;
    });
    return Promise.race([work, timeout]).finally(function () { clearTimeout(timer); });
  }

  // Belt and braces next to the CSP: no script elements, no remote sources, no inline handlers.
  function scrub(rootEl) {
    rootEl.querySelectorAll('script, iframe, object, embed, link, meta, base, form').forEach(function (el) { el.remove(); });
    rootEl.querySelectorAll('*').forEach(function (el) {
      for (const attr of Array.from(el.attributes)) {
        const n = attr.name.toLowerCase();
        if (n.indexOf('on') === 0) el.removeAttribute(attr.name);
        else if ((n === 'src' || n === 'srcset' || n === 'poster' || n === 'xlink:href' || (n === 'href' && el.tagName.toLowerCase() !== 'a')) && REMOTE.test(attr.value)) el.removeAttribute(attr.name);
      }
    });
  }

  // Headings from the rendered pages: Title and Heading 1-9 paragraphs. Each gets its own id,
  // so two headings with the same text jump to their own place.
  function buildOutline(rootEl) {
    const items = [];
    rootEl.querySelectorAll('section.docx p').forEach(function (p) {
      const m = HEADING.exec(p.getAttribute('class') || '');
      if (!m) return;
      const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const id = 'dv-h-' + items.length;
      p.id = id;
      items.push({ level: m[1] === 'title' ? 1 : Number(m[2]), text: text.slice(0, 200), id: id });
    });
    return items;
  }

  // What a click on a link in the pages does. Only http, https and mailto leave the webview.
  function linkAction(href) {
    if (typeof href !== 'string' || !href) return null;
    if (href.charAt(0) === '#') return { kind: 'anchor', id: href.slice(1) };
    if (SAFE_LINK.test(href)) return { kind: 'external', href: href };
    return null;
  }

  // Zoom factor that makes the widest page fit the visible width (with a small margin).
  function fitZoom(pageWidths, viewWidth) {
    const widest = Math.max.apply(null, pageWidths.concat([1]));
    if (!viewWidth || widest <= 1) return 1;
    return Math.max(0.5, Math.min(3, Math.floor(((viewWidth - 48) / widest) * 100) / 100));
  }

  // ---------- webview ----------
  function boot(win, vscode) {
    const doc = win.document;
    const P = win.DocxProtocol;
    const S = win.DocxSearch;
    const $ = function (id) { return doc.getElementById(id); };
    const pagesRoot = $('dv-page-root');
    const scroller = $('dv-pages');
    const statusEl = $('dv-status');
    const q = $('dv-q');
    const countEl = $('dv-count');
    const themeBtn = $('dv-theme');
    const saved = vscode.getState() || {};
    const state = { theme: saved.theme || doc.body.dataset.theme || 'auto', outlineOpen: saved.outlineOpen !== false, query: saved.query || '', zoom: P.clampZoom(doc.body.dataset.zoom || 1) };
    let marks = [];
    let current = -1;
    let loaded = false;
    let pictureUrls = [];

    const setToolbar = P.setupToolbar(doc, vscode);
    function save() { vscode.setState({ theme: state.theme, outlineOpen: state.outlineOpen, query: state.query }); }
    function applyTheme() {
      doc.body.dataset.theme = state.theme;
      themeBtn.textContent = 'Theme: ' + state.theme.charAt(0).toUpperCase() + state.theme.slice(1);
    }
    function applyOutline() {
      $('dv-outline').hidden = !state.outlineOpen;
      $('dv-outline-toggle').setAttribute('aria-pressed', String(state.outlineOpen));
    }
    function applyZoom(post) {
      const wrapper = pagesRoot.querySelector('.docx-wrapper');
      if (wrapper) wrapper.style.zoom = String(state.zoom);
      $('dv-zoom-label').textContent = Math.round(state.zoom * 100) + '%';
      if (post) vscode.postMessage({ type: 'setZoom', zoom: state.zoom });
    }
    function zoomBy(dir) { state.zoom = P.nextZoom(state.zoom, dir); applyZoom(true); }
    function zoomFit() {
      // Measure at 100% so the result does not depend on the zoom in use now.
      const wrapper = pagesRoot.querySelector('.docx-wrapper');
      if (wrapper) wrapper.style.zoom = '1';
      const widths = Array.from(pagesRoot.querySelectorAll('section.docx')).map(function (s) { return s.getBoundingClientRect().width; });
      state.zoom = fitZoom(widths, scroller.clientWidth);
      applyZoom(true);
    }
    applyTheme();
    applyOutline();
    applyZoom(false);
    q.value = state.query;

    themeBtn.addEventListener('click', function () {
      const i = P.THEMES.indexOf(state.theme);
      state.theme = P.THEMES[(i + 1) % P.THEMES.length];
      applyTheme();
      save();
      vscode.postMessage({ type: 'setTheme', theme: state.theme });
    });
    $('dv-outline-toggle').addEventListener('click', function () { state.outlineOpen = !state.outlineOpen; applyOutline(); save(); });
    $('dv-zoom-in').addEventListener('click', function () { zoomBy(1); });
    $('dv-zoom-out').addEventListener('click', function () { zoomBy(-1); });
    $('dv-zoom-label').addEventListener('click', function () { zoomBy(0); });
    $('dv-zoom-fit').addEventListener('click', zoomFit);
    doc.querySelectorAll('[data-cmd]').forEach(function (b) {
      b.addEventListener('click', function () { vscode.postMessage({ type: 'command', name: b.dataset.cmd }); });
    });

    function renderOutline(items) {
      const list = $('dv-outline-list');
      list.textContent = '';
      if (!items.length) {
        const li = doc.createElement('li');
        li.className = 'dv-outline-empty';
        li.textContent = 'No headings';
        list.appendChild(li);
        return;
      }
      const min = Math.min.apply(null, items.map(function (i) { return i.level; }));
      items.forEach(function (it) {
        const li = doc.createElement('li');
        const a = doc.createElement('a');
        a.href = '#' + it.id;
        a.textContent = it.text;
        a.title = it.text;
        a.style.paddingLeft = (8 + (it.level - min) * 12) + 'px';
        a.addEventListener('click', function (e) {
          e.preventDefault();
          const el = doc.getElementById(it.id);
          if (el) el.scrollIntoView({ block: 'start' });
        });
        li.appendChild(a);
        list.appendChild(li);
      });
    }

    // One capturing listener: no click in the pages navigates the webview.
    pagesRoot.addEventListener('click', function (e) {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const act = linkAction(a.getAttribute('href'));
      if (!act) return;
      if (act.kind === 'anchor') {
        const el = doc.getElementById(act.id) || doc.querySelector('[name="' + act.id.replace(/["\\]/g, '') + '"]');
        if (el) el.scrollIntoView({ block: 'center' });
      } else {
        vscode.postMessage({ type: 'openLink', href: act.href });
      }
    }, true);

    // Search
    function runSearch() {
      S.unhighlight(marks);
      marks = [];
      current = -1;
      state.query = q.value;
      save();
      if (!q.value) { countEl.textContent = ''; return; }
      marks = S.highlight(pagesRoot, q.value, 5000);
      if (marks.length) go(0); else countEl.textContent = S.countLabel(0, 0, false);
    }
    function go(i) {
      if (!marks.length) return;
      if (current >= 0 && marks[current]) marks[current].classList.remove('dv-current');
      current = (i + marks.length) % marks.length;
      marks[current].classList.add('dv-current');
      marks[current].scrollIntoView({ block: 'center' });
      countEl.textContent = S.countLabel(current, marks.length, marks.length >= 5000);
    }
    let timer = null;
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { if (loaded) runSearch(); }, 180); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (!marks.length) runSearch(); else go(current + (e.shiftKey ? -1 : 1)); }
      if (e.key === 'Escape') { q.value = ''; runSearch(); scroller.focus(); }
    });
    $('dv-next').addEventListener('click', function () { go(current + 1); });
    $('dv-prev').addEventListener('click', function () { go(current - 1); });

    win.addEventListener('keydown', function (e) {
      const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
      if (mod && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); q.focus(); q.select(); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1); }
      else if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomBy(-1); }
      else if (mod && e.key === '0') { e.preventDefault(); zoomBy(0); }
      else if (e.key === 'F3') { e.preventDefault(); go(current + (e.shiftKey ? -1 : 1)); }
    });
    // Shift + mouse wheel scrolls sideways, for wide landscape pages at high zoom.
    scroller.addEventListener('wheel', function (e) {
      if (e.shiftKey && !e.deltaX && e.deltaY) { scroller.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false });

    win.addEventListener('message', function (event) {
      const m = event.data;
      if (!P.validateOutbound(m)) return;
      if (m.type === 'theme') { state.theme = m.theme; applyTheme(); save(); return; }
      if (m.type === 'find') { q.focus(); q.select(); return; }
      if (m.type === 'toolbar') { setToolbar(m.hidden, false); return; }
      if (m.type === 'font') return;
      if (m.type === 'zoom') { state.zoom = P.clampZoom(m.zoom); applyZoom(false); return; }
      if (m.type === 'pageNote') {
        $('dv-page-note-text').textContent = m.text;
        const box = $('dv-page-note-actions');
        box.textContent = '';
        m.actions.forEach(function (name) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.className = 'dv-btn';
          b.textContent = name === 'showReading' ? 'Reading view' : name;
          b.addEventListener('click', function () { vscode.postMessage({ type: 'command', name: name }); });
          box.appendChild(b);
        });
        $('dv-page-note').hidden = false;
        return;
      }
      if (m.type !== 'pageData') return;
      $('dv-name').textContent = m.meta.fileName || '';
      if (m.theme && !saved.theme) { state.theme = m.theme; applyTheme(); }
      loaded = false;
      pictureUrls.forEach(function (u) { URL.revokeObjectURL(u); });
      pictureUrls = [];
      pagesRoot.textContent = '';
      statusEl.hidden = false;
      statusEl.textContent = 'Laying out pages...';
      const t0 = Date.now();
      const render = win.DocxPreview && win.DocxPreview.renderAsync;
      if (typeof render !== 'function') { vscode.postMessage({ type: 'pageFailed', reason: 'error', ms: 0 }); return; }
      const limits = { maxBytes: typeof m.pictureMaxBytes === 'number' && m.pictureMaxBytes > 0 ? m.pictureMaxBytes : 20 * 1048576 };
      renderPages(render, m.bytes, pagesRoot, $('dv-page-styles'), TIMEOUT_MS, pictureHook(doc, P, limits, pictureUrls)).then(function (pages) {
        statusEl.hidden = true;
        loaded = true;
        applyZoom(false);
        renderOutline(buildOutline(pagesRoot));
        if (q.value) runSearch();
        vscode.postMessage({ type: 'pageRendered', ms: Date.now() - t0, pages: pages });
      }, function (err) {
        pagesRoot.textContent = '';
        const reason = err && (err.message === 'timeout' || err.message === 'empty') ? err.message : 'error';
        vscode.postMessage({ type: 'pageFailed', reason: reason, ms: Date.now() - t0 });
      });
    });
    vscode.postMessage({ type: 'ready' });
  }

  return { RENDER_OPTIONS, TIMEOUT_MS, renderPages, pictureHook, placeholderSvg, scrub, buildOutline, linkAction, fitZoom, boot };
});
