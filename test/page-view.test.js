'use strict';
// Page view: docx-preview layout in jsdom, the webview script (outline, links, search, zoom,
// fallback), dark mode CSS and the Page view CSP. Host-side switching is in extension.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { makeDocx, p, sectPr } = require('./helpers/make-docx');
const W = require('../src/webview-html');
const P = require('../media/protocol');
const S = require('../media/search');
const Page = require('../media/page');
const { convertDocx } = require('../src/convert');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const CSS = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.css'), 'utf8');
let renderAsync;

// docx-preview uses the global document, DOMParser and URL.createObjectURL.
function useWindow(win) {
  for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'NodeFilter', 'HTMLElement', 'Element', 'getComputedStyle']) global[k] = win[k];
  global.URL.createObjectURL = () => 'blob:vscode-webview://test/1';
  global.URL.revokeObjectURL = () => {};
  win.URL.createObjectURL = global.URL.createObjectURL;
}

test.before(async () => {
  ({ renderAsync } = await import('docx-preview'));
});

const HEADER_FOOTER = '<w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/>';
function contractDocx() {
  return makeDocx({
    header: p('ACME Confidential'),
    footer: '<w:p><w:r><w:t xml:space="preserve">Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>',
    body: p('Supply contract', 'Title') + p('Background', 'Heading1') +
      '<w:p><w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>Red bold clause</w:t></w:r></w:p>' +
      p('Terms', 'Heading1') + p('Background', 'Heading2') +
      '<w:p><w:hyperlink r:id="rIdL1"><w:r><w:t>example link</w:t></w:r></w:hyperlink></w:p>' +
      sectPr(true, HEADER_FOOTER),
    rels: [{ id: 'rIdL1', type: 'hyperlink', target: 'https://example.com/terms', external: true }]
  });
}

async function renderFresh(buf) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="s"></div><div id="c"></div></body></html>', { pretendToBeVisual: true });
  useWindow(dom.window);
  const c = dom.window.document.getElementById('c');
  const pages = await Page.renderPages(renderAsync, buf, c, dom.window.document.getElementById('s'), 20000);
  return { dom, c, pages };
}

const ptToMm = (pt) => (parseFloat(pt) * 25.4) / 72;

test('header, landscape A4 page and a red bold run come out of the layout', async () => {
  const { c, pages } = await renderFresh(await contractDocx());
  assert.strictEqual(pages, 1);
  const section = c.querySelector('section.docx');
  assert.match(section.querySelector('header').textContent, /ACME Confidential/);
  assert.match(section.querySelector('footer').textContent, /Page/);
  assert.ok(Math.abs(ptToMm(section.style.width) - 297) < 0.5, section.style.width);
  assert.ok(Math.abs(ptToMm(section.style.minHeight) - 210) < 0.5, section.style.minHeight);
  const red = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === 'Red bold clause');
  assert.ok(/rgb\(255, 0, 0\)|#ff0000/i.test(red.style.color), red.style.color);
  assert.strictEqual(red.style.fontWeight, 'bold');
});

test('a portrait section then a landscape one gives two pages of different widths', async () => {
  const buf = await makeDocx({ body: p('Portrait text') + `<w:p><w:pPr>${sectPr(false)}</w:pPr></w:p>` + p('Landscape text') + sectPr(true) });
  const { c } = await renderFresh(buf);
  const widths = Array.from(c.querySelectorAll('section.docx')).map((s) => s.style.width);
  assert.ok(widths.length >= 2);
  assert.notStrictEqual(widths[0], widths[widths.length - 1]);
});

test('Page view CSP: unsafe-inline only for styles, no network, no http sources; Reading view CSP unchanged', () => {
  const html = W.buildPageHtml({ cspSource: 'https://file+.vscode-resource.vscode-cdn.net', uris: { css: 'a', protocol: 'b', search: 'c', pageView: 'd', page: 'e' }, nonce: 'N' });
  const csp = html.match(/content="([^"]+)"/)[1].replace(/&#39;|&apos;/g, "'");
  const parts = Object.fromEntries(csp.split(/;\s*/).map((d) => { const [k, ...v] = d.split(' '); return [k, v.join(' ')]; }));
  assert.match(parts['style-src'], /'unsafe-inline'/);
  for (const [k, v] of Object.entries(parts)) if (k !== 'style-src') assert.ok(!/unsafe-inline/.test(v), k);
  assert.strictEqual(parts['connect-src'], "'none'");
  assert.strictEqual(parts['default-src'], "'none'");
  assert.strictEqual(parts['script-src'], "'nonce-N'");
  const own = W.pageCsp('vscode-resource:', 'N');
  assert.ok(!/https?:/.test(own), own);
  assert.ok(!/<style nonce/.test(html), 'a style nonce would switch unsafe-inline off');
  // Reading view: the 0.2.x CSP plus blob: images (pictures arrive as bytes since 0.3.0).
  const reading = W.buildWebviewHtml({ cspSource: 'vscode-resource:', uris: { css: 'a', protocol: 'b', search: 'c', viewer: 'd' }, nonce: 'N', pageAvailable: true });
  assert.ok(reading.includes(`content="default-src 'none'; img-src blob: data: vscode-resource:; style-src vscode-resource: 'nonce-N'; font-src vscode-resource:; script-src 'nonce-N'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"`.replace(/'/g, '&#39;')) ||
    reading.includes(`content="default-src 'none'; img-src blob: data: vscode-resource:; style-src vscode-resource: 'nonce-N'; font-src vscode-resource:; script-src 'nonce-N'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"`));
  assert.match(reading, /data-cmd="showPage"/);
  assert.ok(!/data-cmd="showPage"/.test(W.buildWebviewHtml({ cspSource: 'x', uris: { css: 'a', protocol: 'b', search: 'c', viewer: 'd' } })), 'no Page view button for .odt and .doc');
});

test('altChunk HTML parts never render: no script and no remote source in the DOM', async () => {
  const buf = await makeDocx({
    body: p('Before') + '<w:altChunk r:id="rIdAlt"/>' + p('After') + sectPr(false),
    rels: [{ id: 'rIdAlt', type: 'aFChunk', target: 'afchunk.html' }],
    extraParts: { 'word/afchunk.html': '<html><body><script>alert(1)</script><img src="https://example.com/x.png"><p>chunk</p></body></html>' }
  });
  const { c } = await renderFresh(buf);
  assert.match(c.textContent, /Before/);
  assert.strictEqual(c.querySelectorAll('script').length, 0);
  assert.strictEqual(c.querySelectorAll('[src^="http"], [src^="//"]').length, 0);
  assert.ok(!/chunk/.test(c.textContent));
});

test('an external image relationship gives no img with an http src', async () => {
  const drawing = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Pic"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="a.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rIdImg"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const buf = await makeDocx({ body: p('Logo below') + drawing + sectPr(false), rels: [{ id: 'rIdImg', type: 'image', target: 'https://example.com/a.png', external: true }] });
  const { c } = await renderFresh(buf);
  assert.match(c.textContent, /Logo below/);
  assert.strictEqual(Array.from(c.querySelectorAll('img')).filter((i) => /^(https?:)?\/\//.test(i.getAttribute('src') || '')).length, 0);
});

test('scrub removes scripts, handlers and remote sources', () => {
  const dom = new JSDOM('<div id="r"><script>x</script><img src="https://e.com/a.png" onerror="x()"><a href="https://e.com" onclick="y()">l</a><span style="color:red">s</span></div>');
  const r = dom.window.document.getElementById('r');
  Page.scrub(r);
  assert.strictEqual(r.innerHTML, '<img><a href="https://e.com">l</a><span style="color:red">s</span>');
});

test('link rule: only http, https and mailto leave; # links scroll', () => {
  assert.deepStrictEqual(Page.linkAction('https://example.com'), { kind: 'external', href: 'https://example.com' });
  assert.deepStrictEqual(Page.linkAction('mailto:a@b.c'), { kind: 'external', href: 'mailto:a@b.c' });
  assert.deepStrictEqual(Page.linkAction('#_Toc1'), { kind: 'anchor', id: '_Toc1' });
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'command:workbench.action.quit', 'vscode://x', '']) assert.strictEqual(Page.linkAction(bad), null, bad);
});

test('fitZoom fits the widest page and stays within 50% to 300%', () => {
  assert.strictEqual(Page.fitZoom([800, 1100], 1148), 1);
  assert.strictEqual(Page.fitZoom([1100], 598), 0.5);
  assert.strictEqual(Page.fitZoom([200], 4000), 3);
  assert.strictEqual(Page.fitZoom([], 800), 1);
});

// Full webview: the Page view HTML in jsdom with page.js booted against a fake VS Code API.
async function bootWebview(buf, opts) {
  const html = W.buildPageHtml({ cspSource: 'x', uris: { css: 'a', protocol: 'b', search: 'c', pageView: 'd', page: 'e' }, theme: (opts && opts.theme) || 'auto', zoom: (opts && opts.zoom) || 1 }).replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const win = dom.window;
  useWindow(win);
  const scrolled = [];
  win.Element.prototype.scrollIntoView = function () { scrolled.push(this.id || this.textContent); };
  win.DocxProtocol = P;
  win.DocxSearch = S;
  win.DocxPreview = { renderAsync: (opts && opts.renderAsync) || renderAsync };
  const posted = [];
  let stateBox = null;
  const api = { postMessage: (m) => posted.push(m), getState: () => stateBox, setState: (s) => { stateBox = s; } };
  Page.boot(win, api);
  const done = new Promise((resolve) => {
    const iv = setInterval(() => { if (posted.some((m) => m.type === 'pageRendered' || m.type === 'pageFailed')) { clearInterval(iv); resolve(); } }, 10);
  });
  win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'pageData', v: 1, meta: { fileName: 'c.docx', size: buf.length }, theme: 'auto', zoom: 1, bytes: new Uint8Array(buf) } }));
  await done;
  return { win, doc: win.document, posted, scrolled };
}

test('webview: link clicks post only safe links; outline entries with the same name jump to their own heading', async () => {
  const { win, doc, posted, scrolled } = await bootWebview(await contractDocx());
  assert.deepStrictEqual(posted[0], { type: 'ready' });
  assert.ok(posted.some((m) => m.type === 'pageRendered' && m.pages === 1));
  const root = doc.getElementById('dv-page-root');
  const mk = (href) => { const a = doc.createElement('a'); a.setAttribute('href', href); a.textContent = href; root.querySelector('article').appendChild(a); return a; };
  for (const href of ['https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'command:workbench.action.quit']) {
    mk(href).dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  const links = posted.filter((m) => m.type === 'openLink');
  assert.deepStrictEqual(links, [{ type: 'openLink', href: 'https://example.com' }]);
  const docLink = Array.from(root.querySelectorAll('a')).find((a) => a.textContent === 'example link');
  assert.strictEqual(docLink.getAttribute('href'), 'https://example.com/terms');
  // Outline: Title, Background (H1), Terms (H1), Background (H2)
  const entries = Array.from(doc.querySelectorAll('#dv-outline-list a'));
  assert.deepStrictEqual(entries.map((a) => a.textContent), ['Supply contract', 'Background', 'Terms', 'Background']);
  const bg = entries.filter((a) => a.textContent === 'Background');
  bg[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  bg[1].dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(scrolled.length, 2);
  assert.notStrictEqual(scrolled[0], scrolled[1]);
  assert.match(entries[3].style.paddingLeft, /20px/, 'H2 is indented under H1');
});

test('webview: search for "revenue" finds at least as many matches as Reading view in sample.docx', async () => {
  const buf = fx('sample.docx');
  const reading = await convertDocx(buf, { ext: '.docx' });
  const readingCount = S.findMatches(reading.chunks.join('').replace(/<[^>]+>/g, ' '), 'revenue').length;
  const { win, doc } = await bootWebview(buf);
  const q = doc.getElementById('dv-q');
  q.value = 'revenue';
  q.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const marks = doc.querySelectorAll('#dv-page-root mark.dv-hit');
  assert.ok(readingCount >= 1);
  assert.ok(marks.length >= readingCount, marks.length + ' vs ' + readingCount);
  assert.match(doc.getElementById('dv-count').textContent, new RegExp('^1 of ' + marks.length));
});

test('webview: Ctrl+= three times gives 130%, Ctrl+0 gives 100%, and each step is saved', async () => {
  const { win, doc, posted } = await bootWebview(await contractDocx());
  const key = (k) => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true }));
  key('='); key('='); key('=');
  assert.strictEqual(doc.getElementById('dv-zoom-label').textContent, '130%');
  assert.deepStrictEqual(posted.filter((m) => m.type === 'setZoom').map((m) => m.zoom), [1.1, 1.2, 1.3]);
  key('0');
  assert.strictEqual(doc.getElementById('dv-zoom-label').textContent, '100%');
  key('-'); key('-'); key('-'); key('-'); key('-'); key('-');
  assert.strictEqual(doc.getElementById('dv-zoom-label').textContent, '50%');
  const { doc: doc2 } = await bootWebview(await contractDocx(), { zoom: 1.3 });
  assert.strictEqual(doc2.getElementById('dv-zoom-label').textContent, '130%', 'the saved zoom comes back after a reload');
});

test('webview: a renderer that throws posts pageFailed and leaves no half page', async () => {
  const { doc, posted } = await bootWebview(await contractDocx(), { renderAsync: async () => { throw new Error('bad part'); } });
  assert.deepStrictEqual(posted.filter((m) => m.type === 'pageFailed').map((m) => m.reason), ['error']);
  assert.strictEqual(doc.getElementById('dv-page-root').childNodes.length, 0);
  const empty = await bootWebview(await contractDocx(), { renderAsync: async () => {} });
  assert.deepStrictEqual(empty.posted.filter((m) => m.type === 'pageFailed').map((m) => m.reason), ['empty']);
});

test('renderPages gives up after the time limit', async () => {
  const dom = new JSDOM('<div id="c"></div>');
  const never = () => new Promise(() => {});
  await assert.rejects(Page.renderPages(never, new Uint8Array(1), dom.window.document.getElementById('c'), null, 50), /timeout/);
});

test('dark mode inverts the page and inverts pictures back; light mode has no filter', () => {
  const page = (theme, bodyClass) => {
    const dom = new JSDOM(`<!DOCTYPE html><html><head><style>${CSS}</style></head><body class="dv-pageview ${bodyClass || ''}" data-theme="${theme}"><main class="dv-pages"><div class="docx-wrapper"><section class="docx"><article><p><img id="i" src="blob:x"></p></article></section></div></main></body></html>`);
    const w = dom.window;
    return { section: w.getComputedStyle(w.document.querySelector('section.docx')).filter, img: w.getComputedStyle(w.document.getElementById('i')).filter };
  };
  const inv = 'invert(1) hue-rotate(180deg)';
  assert.deepStrictEqual(page('dark'), { section: inv, img: inv });
  assert.deepStrictEqual(page('auto', 'vscode-dark'), { section: inv, img: inv });
  const light = page('light', 'vscode-dark');
  assert.ok(!light.section || light.section === 'none', light.section);
  assert.ok(!light.img || light.img === 'none', light.img);
  const autoLight = page('auto', 'vscode-light');
  assert.ok(!autoLight.section || autoLight.section === 'none');
});

test('protocol: pageData, zoom and page failure messages are checked', () => {
  assert.ok(P.validateOutbound({ type: 'pageData', meta: {}, theme: 'dark', bytes: new Uint8Array(2) }));
  assert.ok(!P.validateOutbound({ type: 'pageData', meta: {}, theme: 'dark', bytes: 'AAAA' }));
  assert.deepStrictEqual(P.validateInbound({ type: 'setZoom', zoom: 9 }).msg, { type: 'setZoom', zoom: 3 });
  assert.strictEqual(P.validateInbound({ type: 'setZoom', zoom: 'big' }).ok, false);
  assert.deepStrictEqual(P.validateInbound({ type: 'pageFailed', reason: '<x>' }).msg, { type: 'pageFailed', reason: 'error', ms: 0 });
  assert.ok(P.validateInbound({ type: 'command', name: 'showPage' }).ok);
  assert.ok(!P.validateOutbound({ type: 'begin', meta: {}, total: 1, bannerActions: ['format c:'] }));
});

test('webview: the tracked-changes note shows with a Reading view button', async () => {
  const { win, doc, posted } = await bootWebview(await contractDocx());
  assert.ok(doc.getElementById('dv-page-note').hidden);
  win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'pageNote', text: 'This document has 2 tracked changes and 1 comment. Reading view shows them.', actions: ['showReading'] } }));
  assert.ok(!doc.getElementById('dv-page-note').hidden);
  const btn = doc.querySelector('#dv-page-note-actions button');
  assert.strictEqual(btn.textContent, 'Reading view');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.deepStrictEqual(posted[posted.length - 1], { type: 'command', name: 'showReading' });
  win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'pageNote', text: 'x', actions: ['format c:'] } }));
  assert.strictEqual(doc.getElementById('dv-page-note-text').textContent, 'This document has 2 tracked changes and 1 comment. Reading view shows them.', 'unknown actions are refused');
});
