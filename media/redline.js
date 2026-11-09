// Redline webview. Receives rows of escaped HTML built by src/redline/render.js and shows them inline or side by
// side, with a change list, next/previous (F7 / Shift+F7) and type filters. No network, no eval.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const doc = $('rl-doc');
  const scroller = $('rl-scroll');
  const items = $('rl-items');
  const saved = vscode.getState() || {};
  const st = {
    rows: [],
    changes: [],
    total: 0,
    listed: 0,
    mode: saved.mode === 'sbs' ? 'sbs' : 'inline',
    list: saved.list !== false,
    theme: saved.theme || null,
    filters: { ins: true, del: true, move: true, cell: true, fmt: document.getElementById('rl-fmt').checked },
    cur: -1,
    nav: null,
    names: null,
    pending: [],
    painting: false
  };
  const THEMES = ['auto', 'light', 'dark'];
  const TY = { ins: '+', del: '−', move: '⇅', cell: '▦', fmt: 'F' };

  function save() { vscode.setState({ mode: st.mode, list: st.list, theme: st.theme }); }

  function setTheme(t) {
    document.body.dataset.theme = t;
    $('rl-theme').textContent = 'Theme: ' + t[0].toUpperCase() + t.slice(1);
  }

  function setMode(m) {
    st.mode = m;
    document.body.classList.toggle('sbs', m === 'sbs');
    $('rl-inline').setAttribute('aria-pressed', String(m === 'inline'));
    $('rl-side').setAttribute('aria-pressed', String(m === 'sbs'));
    save();
    repaint();
  }

  function rowHtml(r) {
    if (st.mode === 'inline') return r.i;
    const l = r.same ? r.i : r.l;
    const rr = r.same ? r.i : r.r;
    return '<div class="rl-sbs"><div>' + (l || '') + '</div><div>' + (rr || '') + '</div></div>';
  }

  function header() {
    if (st.mode !== 'sbs' || !st.names) return '';
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<div class="rl-cols"><div>Older: ' + esc(st.names.a) + '</div><div>Newer: ' + esc(st.names.b) + '</div></div>';
  }

  // Paints rows in slices so a 500-page redline never freezes the view.
  function paint(rows) {
    st.pending.push(...rows);
    if (st.painting) return;
    st.painting = true;
    const step = () => {
      const t0 = performance.now();
      let html = '';
      while (st.pending.length && performance.now() - t0 < 12) {
        const batch = st.pending.splice(0, 150);
        html += batch.map(rowHtml).join('');
      }
      if (html) doc.insertAdjacentHTML('beforeend', html);
      if (st.pending.length) requestAnimationFrame(step);
      else { st.painting = false; st.nav = null; }
    };
    requestAnimationFrame(step);
  }

  function repaint() {
    const top = scroller.scrollTop;
    st.pending = [];
    doc.innerHTML = header();
    st.nav = null;
    paint(st.rows);
    requestAnimationFrame(() => { scroller.scrollTop = top; });
  }

  function typeOf(el) {
    const c = el.classList;
    if (c.contains('rl-mt')) return 'move';
    if (c.contains('rl-cell')) return 'cell';
    if (c.contains('rl-fmt') || c.contains('rl-pfmt')) return 'fmt';
    if (c.contains('rl-del') || c.contains('rl-tr-del')) return 'del';
    if (c.contains('rl-ins') || c.contains('rl-tr-ins')) return 'ins';
    return null;
  }

  // Change elements in reading order, honoring the filters. In side-by-side, one element per change id.
  function navList() {
    if (st.nav) return st.nav;
    const seen = new Set();
    const out = [];
    for (const el of doc.querySelectorAll('[data-c]')) {
      const id = el.getAttribute('data-c');
      if (seen.has(id) || /^m\d+f$/.test(id)) continue;
      const t = typeOf(el);
      if (!t || !st.filters[t]) continue;
      seen.add(id);
      out.push(el);
    }
    st.nav = out;
    return out;
  }

  function showPos() {
    const n = navList().length;
    $('rl-pos').textContent = (st.cur >= 0 && st.cur < n ? st.cur + 1 : 0) + ' of ' + n;
  }

  function go(i) {
    const list = navList();
    if (!list.length) { st.cur = -1; showPos(); return; }
    st.cur = (i + list.length) % list.length;
    const el = list[st.cur];
    for (const old of doc.querySelectorAll('.rl-current')) old.classList.remove('rl-current');
    el.classList.add('rl-current');
    el.scrollIntoView({ block: 'center' });
    const id = el.getAttribute('data-c');
    for (const li of items.querySelectorAll('li.cur')) li.classList.remove('cur');
    const li = items.querySelector('li[data-id="' + id + '"]');
    if (li) { li.classList.add('cur'); li.scrollIntoView({ block: 'nearest' }); }
    showPos();
  }

  function jumpTo(id) {
    const list = navList();
    const i = list.findIndex((el) => el.getAttribute('data-c') === id);
    if (i !== -1) return go(i);
    const el = doc.querySelector('[data-c="' + id + '"]');
    if (el) el.scrollIntoView({ block: 'center' });
  }

  function renderList() {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let html = '';
    for (const c of st.changes) {
      if (!st.filters[c.type]) continue;
      const tip = c.desc ? c.desc + ': ' + c.text : c.text;
      html += '<li data-id="' + esc(c.id) + '" title="' + esc(tip) + '"><span class="ty ty-' + c.type + '">' + TY[c.type] + '</span>' + esc(c.desc ? c.desc + ' · ' + c.text : c.text) + '</li>';
    }
    if (st.total > st.listed) html += '<li class="more">' + (st.total - st.listed).toLocaleString('en-US') + ' more changes are marked in the text. Use F7 to step through all of them.</li>';
    if (!html) html = '<li class="more">No changes of the selected types.</li>';
    items.innerHTML = html;
  }

  function setCount(id, n, one, many) { $(id).textContent = n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many); }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    switch (m.type) {
      case 'progress':
        $('rl-progress').textContent = m.text;
        break;
      case 'reset':
        st.rows = []; st.changes = []; st.cur = -1; st.nav = null; st.pending = [];
        doc.innerHTML = '';
        items.innerHTML = '';
        $('rl-progress').classList.remove('rl-hide');
        $('rl-progress').textContent = 'Comparing the documents...';
        $('rl-total').textContent = 'Comparing...';
        break;
      case 'start': {
        st.names = m.names;
        st.total = m.total;
        st.listed = m.listed;
        $('rl-names').textContent = m.names.a + '  →  ' + m.names.b;
        $('rl-names').title = 'Older: ' + m.names.a + '\nNewer: ' + m.names.b;
        $('rl-total').textContent = m.total ? m.total.toLocaleString('en-US') + (m.total === 1 ? ' change' : ' changes') : 'No differences in the text';
        setCount('n-ins', m.counts.insertions, 'insertion', 'insertions');
        setCount('n-del', m.counts.deletions, 'deletion', 'deletions');
        setCount('n-move', m.counts.moves, 'move', 'moves');
        setCount('n-cell', m.counts.cells, 'table cell', 'table cells');
        setCount('n-fmt', m.counts.formatting, 'formatting change', 'formatting changes');
        $('rl-export-docx').disabled = !m.exportDocx;
        if (!m.exportDocx) $('rl-export-docx').title = 'Export as DOCX needs a Word file as the newer document. Use Swap if the Word file is the newer one.';
        const banners = (m.banners || []).map((b) => { const d = document.createElement('div'); d.className = 'rl-banner'; d.textContent = b; return d; });
        $('rl-banners').replaceChildren(...banners);
        if (!st.theme) setTheme(m.theme || 'auto');
        $('rl-progress').classList.add('rl-hide');
        doc.innerHTML = header();
        break;
      }
      case 'pro':
        $('rl-pro-docx').textContent = m.docx ? '(' + m.docx + ')' : '';
        $('rl-pro-html').textContent = m.html ? '(' + m.html + ')' : '';
        break;
      case 'rows':
        st.rows.push(...m.rows);
        paint(m.rows);
        break;
      case 'done':
        st.changes = m.changes || [];
        renderList();
        st.nav = null;
        setTimeout(showPos, 50);
        break;
      case 'error': {
        $('rl-progress').classList.add('rl-hide');
        const box = document.createElement('div');
        box.className = 'rl-msg';
        const h = document.createElement('h2');
        h.textContent = m.title;
        const p = document.createElement('p');
        p.textContent = m.detail || '';
        box.append(h, p);
        doc.replaceChildren(box);
        $('rl-total').textContent = m.title;
        break;
      }
    }
  });

  $('rl-inline').addEventListener('click', () => setMode('inline'));
  $('rl-side').addEventListener('click', () => setMode('sbs'));
  $('rl-next').addEventListener('click', () => go(st.cur + 1));
  $('rl-prev').addEventListener('click', () => go(st.cur - 1));
  $('rl-swap').addEventListener('click', () => vscode.postMessage({ type: 'swap' }));
  $('rl-export-docx').addEventListener('click', () => vscode.postMessage({ type: 'export', format: 'docx' }));
  $('rl-export-html').addEventListener('click', () => vscode.postMessage({ type: 'export', format: 'html' }));
  $('rl-theme').addEventListener('click', () => {
    const t = THEMES[(THEMES.indexOf(document.body.dataset.theme) + 1) % THEMES.length];
    st.theme = t;
    setTheme(t);
    save();
  });
  $('rl-list-toggle').addEventListener('click', () => {
    st.list = !st.list;
    document.body.classList.toggle('nolist', !st.list);
    $('rl-list-toggle').setAttribute('aria-pressed', String(st.list));
    save();
  });
  for (const box of document.querySelectorAll('#rl-sum input[data-f]')) {
    box.addEventListener('change', () => {
      st.filters[box.dataset.f] = box.checked;
      if (box.id === 'rl-fmt') {
        document.body.classList.toggle('rl-nofmt', !box.checked);
        vscode.postMessage({ type: 'formatting', on: box.checked });
      }
      st.nav = null;
      st.cur = -1;
      renderList();
      showPos();
    });
  }
  items.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) jumpTo(li.dataset.id);
  });
  doc.addEventListener('click', (e) => {
    const el = e.target.closest('[data-c]');
    if (!el) return;
    const id = el.getAttribute('data-c');
    const mv = /^m(\d+)f$/.exec(id);
    if (mv) { const to = doc.querySelector('.rl-mt[data-mv="' + mv[1] + '"]'); if (to) to.scrollIntoView({ block: 'center' }); return; }
    const i = navList().indexOf(el);
    if (i !== -1) { st.cur = i; go(i); }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F7') { e.preventDefault(); go(e.shiftKey ? st.cur - 1 : st.cur + 1); }
  });

  if (st.theme) setTheme(st.theme);
  document.body.classList.toggle('nolist', !st.list);
  $('rl-list-toggle').setAttribute('aria-pressed', String(st.list));
  document.body.classList.toggle('sbs', st.mode === 'sbs');
  $('rl-inline').setAttribute('aria-pressed', String(st.mode === 'inline'));
  $('rl-side').setAttribute('aria-pressed', String(st.mode === 'sbs'));
})();
