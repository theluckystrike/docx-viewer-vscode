'use strict';
// EXEC9: the USD 299 custom format line next to a part DOCX Viewer does not show. Only next to an unsupported
// placeholder (or the Text only banner), only after a user action, once per session, hidden while a funding value is empty.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { JSDOM } = require('jsdom');
const CO = require('../src/custom-offer');
const H = require('../src/html');
const P = require('../media/protocol');
const S = require('../media/search');
const W = require('../src/webview-html');

const TIER = 'https://github.com/sponsors/theluckystrike/sponsorships?tier_id=679995';

test('custom offer: funding.json values, hidden when one is empty, once per session, no file name in the form', () => {
  const shared = path.join(os.homedir(), 'plugin-market-intel-work', 'factory', 'sprint', 'funding.json');
  if (fs.existsSync(shared)) {
    const f = JSON.parse(fs.readFileSync(shared, 'utf8'));
    for (const k of ['custom_format_tier', 'custom_format_usd', 'custom_format_issues']) assert.strictEqual(CO.FUNDING_CUSTOM[k], f[k], k);
  }
  for (const k of ['custom_format_tier', 'custom_format_usd', 'custom_format_issues']) {
    const s = CO.createCustomOffer({ vscode: null, product: 'DOCX Viewer', funding: { ...CO.FUNDING_CUSTOM, [k]: k === 'custom_format_usd' ? 0 : '' } });
    assert.strictEqual(s.claim(), null, k);
  }
  const s = CO.createCustomOffer({ vscode: { version: '1.142.0', env: { appName: 'Visual Studio Code' } }, product: 'DOCX Viewer', version: '0.4.3' });
  assert.deepStrictEqual(s.claim(), { usd: 299 });
  assert.strictEqual(s.claim(), null);
  assert.strictEqual(s.url('tier'), TIER);
  assert.strictEqual(s.url('request', 'EMF pictures'), 'https://github.com/theluckystrike/zovo-plugin-factory/issues/new?template=format-request.yml&title=Format%20request%3A%20EMF%20pictures%20in%20DOCX%20Viewer&viewer=DOCX%20Viewer&format=EMF%20pictures&editor=Visual%20Studio%20Code%201.142.0%2C%20DOCX%20Viewer%200.4.3');
  // the same file as Hex Viewer's
  const hex = path.join(os.homedir(), 'plugin-market-intel-work', 'exec9-work', 'hex', 'src', 'custom-offer.js');
  if (fs.existsSync(hex)) assert.strictEqual(fs.readFileSync(path.join(__dirname, '..', 'src', 'custom-offer.js'), 'utf8'), fs.readFileSync(hex, 'utf8'));
});

test('Reading view HTML: only a format the viewer cannot draw is marked, not limits, missing or linked images', () => {
  const r = (html) => H.renderNode(H.sanitize(H.parse(html)).tree);
  assert.match(r('<p><img src="" data-dv-skipped="PICT images are not supported" alt="x"></p>'), /class="dv-img-skipped" data-dv-unsup="PICT images">\[Image "x" not shown: PICT images are not supported\]/);
  assert.match(r('<p><img src="data:image/svg+xml;base64,AAAA"></p>'), /data-dv-unsup="unknown images"/);
  for (const why of ['9.0 MB is over the 5.0 MB image limit', 'the document is over the 40 MB total image limit', 'linked images are not shown', 'the image is missing from the file']) {
    const out = r('<p><img src="" data-dv-skipped="' + why + '"></p>');
    assert.match(out, /dv-img-skipped/, why);
    assert.doesNotMatch(out, /data-dv-unsup/, why);
  }
  assert.strictEqual(H.unsupportedKind('<b> images are not supported'), '');
});

test('protocol: customClaim takes only a kind of element; customOpen only the two links; customGrant needs a price', () => {
  for (const what of ['EMF pictures', 'PICT images', 'unknown images', 'Word 97-2003 formatting', 'RTF formatting']) assert.ok(P.validateInbound({ type: 'customClaim', what }).ok, what);
  for (const what of ['', 'Quarterly salary review of John images', '<img> images', 'EMF', 'https://x images', 42]) assert.ok(!P.validateInbound({ type: 'customClaim', what }).ok, String(what));
  assert.deepStrictEqual(P.validateInbound({ type: 'customOpen', which: 'tier', href: 'https://evil.example' }), { ok: true, msg: { type: 'customOpen', which: 'tier' } });
  assert.ok(!P.validateInbound({ type: 'customOpen', which: 'https://evil.example' }).ok);
  assert.ok(P.validateOutbound({ type: 'customGrant', usd: 299 }));
  assert.ok(!P.validateOutbound({ type: 'customGrant', usd: '299' }));
});

// ---------- the extension host (stubbed VS Code) ----------

const external = [];
class Uri {
  constructor(p, scheme) { this.path = p; this.fsPath = p; this.scheme = scheme || 'file'; }
  static file(p) { return new Uri(p); }
  static parse(s) { const u = new Uri(s, s.split(':')[0]); u.raw = s; return u; }
  static joinPath(u, ...parts) { return new Uri(path.join(u.path, ...parts)); }
  toString() { return this.raw || 'file://' + this.path; }
}
const settings = { theme: 'auto', maxFileSizeMB: 50, maxImageSizeMB: 5, maxTotalImagesMB: 40 };
const vscodeStub = {
  Uri, version: '1.142.0',
  EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } dispose() {} },
  RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
  ViewColumn: { Beside: -2 }, ProgressLocation: { Window: 10 },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }),
    fs: { stat: async (u) => ({ size: fs.statSync(u.fsPath).size }), readFile: async (u) => fs.readFileSync(u.fsPath) },
    createFileSystemWatcher: () => ({ onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), dispose() {} }),
    openTextDocument: async (o) => o, onDidChangeConfiguration: () => ({ dispose() {} }), registerTextDocumentContentProvider: () => ({ dispose() {} })
  },
  window: { showInformationMessage: () => {}, showWarningMessage: () => {}, showTextDocument: async () => {}, withProgress: (_o, fn) => fn(), registerCustomEditorProvider: () => ({ dispose() {} }) },
  env: { appName: 'Visual Studio Code', openExternal: async (u) => { external.push(u.toString()); return true; }, clipboard: { writeText: async () => {} } },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : origResolve.call(this, req, ...rest); };
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };
const { DocxEditorProvider } = require('../src/extension');

function fakePanel() {
  const l = {};
  const panel = {
    active: true, visible: true, posted: [],
    webview: { cspSource: 'vscode-resource:', asWebviewUri: (u) => u, options: null, html: '', postMessage: async (m) => { panel.posted.push(m); return true; }, onDidReceiveMessage: (fn) => { l.msg = fn; return { dispose() {} }; } },
    onDidChangeViewState: () => ({ dispose() {} }), onDidDispose: (fn) => { l.dispose = fn; },
    send: (m) => l.msg(m), close: () => l.dispose()
  };
  return panel;
}
const ctx = { extensionUri: Uri.file(path.join(__dirname, '..')), subscriptions: [], extension: { packageJSON: { version: '0.4.3' } } };
async function openIn(provider, file) {
  const doc = await provider.openCustomDocument(Uri.file(path.join(__dirname, 'fixtures', file)));
  const panel = fakePanel();
  await provider.resolveCustomEditor(doc, panel);
  await panel.send({ type: 'ready' });
  return panel;
}
const grants = (p) => p.posted.filter((m) => m.type === 'customGrant');

test('host: nothing on open; one grant per session; links only for the panel that showed it', async () => {
  external.length = 0;
  const provider = new DocxEditorProvider(ctx); // one provider = one extension host session
  const a = await openIn(provider, 'sample.docx');
  const b = await openIn(provider, 'sample.docx');
  assert.strictEqual(grants(a).length + grants(b).length, 0, 'nothing on open');
  await b.send({ type: 'customOpen', which: 'tier' });
  assert.deepStrictEqual(external, [], 'no link before the line was shown');
  await a.send({ type: 'customClaim', what: 'EMF pictures' });
  await a.send({ type: 'customClaim', what: 'EMF pictures' });
  await b.send({ type: 'customClaim', what: 'TIFF pictures' });
  assert.deepStrictEqual(grants(a), [{ type: 'customGrant', usd: 299 }]);
  assert.strictEqual(grants(b).length, 0, 'once per session, across panels');
  await b.send({ type: 'customOpen', which: 'tier' });
  assert.deepStrictEqual(external, [], 'the other panel cannot open it');
  await a.send({ type: 'customClaim', what: 'Salary list of Jane images' });
  await a.send({ type: 'customOpen', which: 'request' });
  await a.send({ type: 'customOpen', which: 'tier' });
  assert.strictEqual(external.length, 2);
  assert.match(external[0], /title=Format%20request%3A%20EMF%20pictures%20in%20DOCX%20Viewer&viewer=DOCX%20Viewer&format=EMF%20pictures/);
  assert.doesNotMatch(external[0], /sample/);
  assert.strictEqual(external[1], TIER);
});

test('host: hidden when a funding value is empty', async () => {
  for (const k of ['custom_format_tier', 'custom_format_usd', 'custom_format_issues']) {
    const keep = CO.FUNDING_CUSTOM[k];
    CO.FUNDING_CUSTOM[k] = k === 'custom_format_usd' ? 0 : '';
    try {
      external.length = 0;
      const p = await openIn(new DocxEditorProvider(ctx), 'sample.docx');
      await p.send({ type: 'customClaim', what: 'EMF pictures' });
      await p.send({ type: 'customOpen', which: 'tier' });
      assert.strictEqual(grants(p).length, 0, k);
      assert.deepStrictEqual(external, [], k);
    } finally { CO.FUNDING_CUSTOM[k] = keep; }
  }
});

// ---------- the Reading view webview in jsdom ----------

function bootReading() {
  const html = W.buildWebviewHtml({ cspSource: 'x', uris: { css: 'a', protocol: 'b', search: 'c', viewer: 'd', pictures: 'e' }, theme: 'auto', zoom: 1, pageAvailable: true }).replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
  const win = dom.window;
  win.DocxProtocol = P;
  win.DocxSearch = S;
  win.Element.prototype.scrollIntoView = function () {};
  // jsdom has no layout: the scroller is 0..600 px, an element "below" (data-below) is off screen.
  win.Element.prototype.getBoundingClientRect = function () {
    if (this.id === 'dv-scroll') return { top: 0, bottom: 600, width: 800, height: 600 };
    const below = this.closest('[data-below]');
    return below ? { top: 2000, bottom: 2020, width: 100, height: 20 } : { top: 100, bottom: 120, width: 100, height: 20 };
  };
  const posted = [];
  win.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m), getState: () => null, setState: () => {} });
  win.eval(fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.js'), 'utf8'));
  const send = (data) => win.dispatchEvent(new win.MessageEvent('message', { data }));
  const render = (chunk, banner) => {
    send({ type: 'begin', v: 1, meta: { fileName: 'a.docx', size: 1 }, total: 1, banner: banner || '', bannerActions: [] });
    send({ type: 'chunk', index: 0, total: 1, html: chunk });
    send({ type: 'end', outline: [], warnings: [], stats: { skippedImages: 1 } });
  };
  return { win, doc: win.document, posted, send, render, claims: () => posted.filter((m) => m.type === 'customClaim') };
}
const PLACEHOLDER = '<p>Before <span class="dv-img-skipped" data-dv-unsup="PICT images">[Image not shown: PICT images are not supported]</span> after</p>';

test('webview: no claim on open; after a click the placeholder on screen claims; the grant puts one line after it', () => {
  const v = bootReading();
  v.render(PLACEHOLDER);
  assert.strictEqual(v.claims().length, 0, 'nothing on open');
  v.doc.getElementById('dv-scroll').dispatchEvent(new v.win.Event('scroll'));
  assert.strictEqual(v.claims().length, 0, 'a scroll restore is not a user action');
  v.win.dispatchEvent(new v.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true }));
  v.win.dispatchEvent(new v.win.KeyboardEvent('keydown', { key: 'p', ctrlKey: true }));
  v.win.dispatchEvent(new v.win.KeyboardEvent('keydown', { key: 'Shift' }));
  assert.strictEqual(v.claims().length, 0, 'a VS Code shortcut or a lone modifier is not a user action in the document');
  v.doc.getElementById('dv-doc').dispatchEvent(new v.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.deepStrictEqual(v.claims(), [{ type: 'customClaim', what: 'PICT images' }]);
  v.win.dispatchEvent(new v.win.KeyboardEvent('keydown', { key: 'j' }));
  assert.strictEqual(v.claims().length, 1, 'asked once');
  assert.strictEqual(v.doc.querySelector('.dv-customfmt'), null, 'nothing before the host says yes');
  v.send({ type: 'customGrant', usd: 299 });
  const line = v.doc.querySelector('.dv-customfmt');
  assert.strictEqual(line.previousElementSibling.className, 'dv-img-skipped', 'right after the placeholder');
  assert.strictEqual(line.textContent, ' Request support for this (free), or we build it for USD 299 once.');
  assert.ok(!v.posted.some((m) => m.type === 'customOpen'), 'no link opens by itself');
  line.querySelectorAll('button').forEach((b) => b.dispatchEvent(new v.win.MouseEvent('click', { bubbles: true })));
  assert.deepStrictEqual(v.posted.filter((m) => m.type === 'customOpen').map((m) => m.which), ['request', 'tier']);
  v.send({ type: 'customGrant', usd: 299 });
  assert.strictEqual(v.doc.querySelectorAll('.dv-customfmt').length, 1);
});

test('webview: no placeholder (or only a size-limit one) never claims; an off-screen one waits until scrolled to', () => {
  let v = bootReading();
  v.render('<p>Plain text <span class="dv-img-skipped">[Image not shown: 9.0 MB is over the 5.0 MB image limit]</span></p>');
  v.doc.getElementById('dv-doc').dispatchEvent(new v.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.strictEqual(v.claims().length, 0);
  v = bootReading();
  v.render('<div data-below="1">' + PLACEHOLDER + '</div>');
  v.win.dispatchEvent(new v.win.WheelEvent('wheel', { deltaY: 40 }));
  assert.strictEqual(v.claims().length, 0, 'not on screen yet');
  v.doc.querySelector('[data-below]').removeAttribute('data-below'); // scrolled into view
  v.win.dispatchEvent(new v.win.WheelEvent('wheel', { deltaY: 40 }));
  assert.strictEqual(v.claims().length, 1);
});

test('webview: the Text only banner of an old .doc gets the line inside the banner', () => {
  const v = bootReading();
  v.render('<p>Text</p>', 'Old Word 97-2003 file. Text only: formatting, images and layout are not shown.');
  v.doc.getElementById('dv-doc').dispatchEvent(new v.win.MouseEvent('pointerdown', { bubbles: true }));
  assert.deepStrictEqual(v.claims(), [{ type: 'customClaim', what: 'Word 97-2003 formatting' }]);
  v.send({ type: 'customGrant', usd: 299 });
  assert.match(v.doc.getElementById('dv-banner-text').textContent, /are not shown\. Request support for this \(free\), or we build it for USD 299 once\.$/);
  // a new document: the line goes away and a new user action is needed (the host says no in this session anyway)
  v.render('<p>Other</p>', 'Old Word 97-2003 file. Text only: formatting, images and layout are not shown.');
  assert.strictEqual(v.doc.querySelector('.dv-customfmt'), null);
  assert.strictEqual(v.claims().length, 1);
});

// ---------- Page view: a picture that could not be drawn ----------

test('Page view: the EMF placeholder gets the line after a user action, once; a drawn page without one never claims', async () => {
  const Page = require('../media/page');
  async function boot(withBadEmf) {
    const html = W.buildPageHtml({ cspSource: 'x', uris: { css: 'a', protocol: 'b', search: 'c', pageView: 'd', page: 'e' }, theme: 'auto', zoom: 1 }).replace(/<script[\s\S]*?<\/script>/g, '');
    const dom = new JSDOM(html, { pretendToBeVisual: true });
    const win = dom.window;
    let n = 0;
    win.URL.createObjectURL = () => 'blob:vscode-webview://test/' + (++n);
    win.URL.revokeObjectURL = () => {};
    const keepURL = global.URL.createObjectURL;
    global.URL.createObjectURL = win.URL.createObjectURL;
    win.Element.prototype.scrollIntoView = function () {};
    win.Element.prototype.getBoundingClientRect = function () { return this.id === 'dv-pages' ? { top: 0, bottom: 600, width: 800, height: 600 } : { top: 50, bottom: 110, width: 320, height: 60 }; };
    win.DocxProtocol = P;
    win.DocxSearch = S;
    win.DocxPreview = {
      renderAsync: async (data, body, styleEl, opts, hook) => {
        const sec = win.document.createElement('section');
        sec.className = 'docx';
        const p = win.document.createElement('p');
        p.textContent = 'Page text ';
        if (withBadEmf) {
          const img = win.document.createElement('img');
          img.src = await hook(new win.Blob([new Uint8Array([1, 2, 3, 4])]), 'word/media/image1.emf', (b) => 'blob:orig');
          p.appendChild(img);
        }
        sec.appendChild(p);
        body.appendChild(sec);
      }
    };
    const posted = [];
    Page.boot(win, { postMessage: (m) => posted.push(m), getState: () => null, setState: () => {} });
    win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'pageData', v: 1, meta: { fileName: 'a.docx', size: 4 }, theme: 'auto', zoom: 1, bytes: new Uint8Array(4) } }));
    for (let i = 0; i < 200 && !posted.some((m) => m.type === 'pageRendered' || m.type === 'pageFailed'); i++) await new Promise((r) => setTimeout(r, 10));
    global.URL.createObjectURL = keepURL;
    return { win, doc: win.document, posted, claims: () => posted.filter((m) => m.type === 'customClaim') };
  }
  let v = await boot(true);
  assert.ok(v.posted.some((m) => m.type === 'pageRendered'));
  const img = v.doc.querySelector('#dv-page-root img');
  assert.strictEqual(img.getAttribute('data-dv-unsup'), 'EMF pictures');
  assert.strictEqual(v.claims().length, 0, 'nothing on open');
  v.win.dispatchEvent(new v.win.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.deepStrictEqual(v.claims(), [{ type: 'customClaim', what: 'EMF pictures' }]);
  v.win.dispatchEvent(new v.win.MessageEvent('message', { data: { type: 'customGrant', usd: 299 } }));
  const line = v.doc.querySelector('.dv-customfmt');
  assert.strictEqual(line.previousElementSibling, img);
  assert.strictEqual(line.textContent, ' Request support for this (free), or we build it for USD 299 once.');
  v = await boot(false);
  v.win.dispatchEvent(new v.win.KeyboardEvent('keydown', { key: 'ArrowDown' }));
  assert.strictEqual(v.claims().length, 0);
});
