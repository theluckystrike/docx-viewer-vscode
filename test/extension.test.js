'use strict';
// Drives DocxEditorProvider through a stubbed vscode module: open, ready, render messages,
// notices for .doc and oversized files, link and command handling.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const calls = { external: [], clipboard: [], info: [], textDocs: [] };
const settings = { theme: 'auto', maxFileSizeMB: 50, maxImageSizeMB: 5, maxTotalImagesMB: 40 };
class Uri {
  constructor(p, scheme) { this.path = p; this.fsPath = p; this.scheme = scheme || 'file'; }
  static file(p) { return new Uri(p); }
  static parse(s) { const u = new Uri(s, s.split(':')[0]); u.raw = s; return u; }
  static joinPath(u, ...parts) { return new Uri(path.join(u.path, ...parts)); }
  toString() { return this.raw || 'file://' + this.path; }
}
const vscodeStub = {
  Uri,
  EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } dispose() {} },
  RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
  ViewColumn: { Beside: -2 },
  ProgressLocation: { Window: 10 },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }),
    fs: {
      stat: async (u) => ({ size: fs.statSync(u.fsPath).size }),
      readFile: async (u) => fs.readFileSync(u.fsPath) // a Node Buffer, like the real API often returns
    },
    createFileSystemWatcher: () => ({ onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), dispose() {} }),
    openTextDocument: async (o) => { calls.textDocs.push(o); return o; },
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} })
  },
  window: {
    showInformationMessage: (m) => calls.info.push(m),
    showWarningMessage: (m) => calls.info.push(m),
    showTextDocument: async () => {},
    withProgress: (_o, fn) => fn(),
    registerCustomEditorProvider: () => ({ dispose() {} })
  },
  env: {
    openExternal: async (u) => { calls.external.push(u.toString()); return true; },
    clipboard: { writeText: async (t) => { calls.clipboard.push(t); } }
  },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: async () => {} }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'vscode' ? 'vscode' : origResolve.call(this, req, ...rest); };
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };
const { DocxEditorProvider } = require('../src/extension');

function fakePanel() {
  const listeners = {};
  const panel = {
    active: true, visible: true, posted: [],
    webview: {
      cspSource: 'vscode-resource:',
      asWebviewUri: (u) => u,
      options: null, html: '',
      postMessage: async (m) => { panel.posted.push(m); return true; },
      onDidReceiveMessage: (fn) => { listeners.msg = fn; return { dispose() {} }; }
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: (fn) => { listeners.dispose = fn; },
    send: (m) => listeners.msg(m),
    close: () => listeners.dispose()
  };
  return panel;
}

const ctx = { extensionUri: Uri.file(path.join(__dirname, '..')), subscriptions: [] };
const fixture = (f) => Uri.file(path.join(__dirname, 'fixtures', f));

async function open(file) {
  const provider = new DocxEditorProvider(ctx);
  const doc = await provider.openCustomDocument(fixture(file));
  const panel = fakePanel();
  await provider.resolveCustomEditor(doc, panel);
  await panel.send({ type: 'ready' });
  return { provider, doc, panel };
}

test('webview gets scripts enabled, command URIs only for the support links, and resources limited to media/', async () => {
  const { panel } = await open('sample.docx');
  assert.strictEqual(panel.webview.options.enableScripts, true);
  assert.deepStrictEqual(panel.webview.options.enableCommandUris, ['docxViewer.supportDeveloper', 'docxViewer.moreViewers', 'workbench.action.openSettings']);
  assert.strictEqual(panel.webview.options.localResourceRoots.length, 1);
  assert.match(panel.webview.options.localResourceRoots[0].path, /media$/);
  assert.match(panel.webview.html, /Content-Security-Policy/);
});

test('ready triggers begin, chunks and end for a .docx', async () => {
  const { panel } = await open('sample.docx');
  const types = panel.posted.map((m) => m.type);
  assert.strictEqual(types[0], 'begin');
  assert.strictEqual(types[types.length - 1], 'end');
  assert.strictEqual(panel.posted[0].meta.fileName, 'sample.docx');
  const end = panel.posted[panel.posted.length - 1];
  assert.strictEqual(end.outline.length, 7);
});

test('an .odt file renders through the worker with its outline (OpenDocument text)', async () => {
  const { panel } = await open('report.odt');
  const types = panel.posted.map((m) => m.type);
  assert.strictEqual(types[0], 'begin');
  assert.strictEqual(types[types.length - 1], 'end');
  assert.strictEqual(panel.posted[0].meta.fileName, 'report.odt');
  assert.strictEqual(panel.posted[panel.posted.length - 1].outline.length, 6);
});

test('convertBytes converts committed bytes and gives a notice for non-ZIP bytes', async () => {
  const { convertBytes } = require('../src/extension');
  const r = await convertBytes(fs.readFileSync(path.join(__dirname, 'fixtures', 'report.odt')), 'report.odt');
  assert.ok(r.ok);
  assert.match(r.markdown, /# Q3 2026 Field Report/);
  const bad = await convertBytes(Buffer.from('version https://git-lfs.github.com/spec/v1'), 'a.docx');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.notice.kind, 'notDocx');
});

test('a broken .doc shows the could-not-read notice with Try again and Open in default app', async () => {
  const { panel } = await open('legacy.doc');
  assert.strictEqual(panel.posted.length, 1);
  assert.strictEqual(panel.posted[0].type, 'notice');
  assert.strictEqual(panel.posted[0].kind, 'error');
  assert.match(panel.posted[0].title, /could not read this \.doc file/);
  assert.deepStrictEqual(panel.posted[0].actions, ['reload', 'openInDefaultApp']);
});

test('a Word 97-2003 .doc renders its text with the text-only banner', async () => {
  const { panel } = await open('simple.doc');
  const types = panel.posted.map((m) => m.type);
  assert.strictEqual(types[0], 'begin');
  assert.strictEqual(types[types.length - 1], 'end');
  assert.match(panel.posted[0].banner, /^Old Word 97-2003 file\. Text only/);
  assert.match(panel.posted.filter((m) => m.type === 'chunk').map((m) => m.html).join(''), /<td>alpha<\/td><td>1<\/td>/);
  assert.match(panel.webview.html, /id="dv-banner"[^>]*hidden/);
  const sample = await open('sample.docx');
  assert.strictEqual(sample.panel.posted[0].banner, '', 'no banner for .docx');
});

test('RTF saved as .doc opens as text with a note and Open in default app', async () => {
  const { panel } = await open('rtf-as.doc');
  assert.strictEqual(panel.posted[0].type, 'begin');
  assert.match(panel.posted[0].banner, /Rich Text Format/);
  assert.deepStrictEqual(panel.posted[0].bannerActions, ['openInDefaultApp']);
});

test('oversized file asks first, and Open anyway renders it', async () => {
  const origStat = vscodeStub.workspace.fs.stat;
  vscodeStub.workspace.fs.stat = async () => ({ size: 200 * 1024 * 1024 });
  try {
    const { panel } = await open('sample.docx');
    assert.strictEqual(panel.posted[0].kind, 'tooLarge');
    assert.match(panel.posted[0].title, /200\.0 MB/);
    panel.posted.length = 0;
    await panel.send({ type: 'command', name: 'openAnyway' });
    assert.strictEqual(panel.posted[0].type, 'begin');
  } finally {
    vscodeStub.workspace.fs.stat = origStat;
  }
});

test('links: https opens externally, javascript: and command: are ignored', async () => {
  const { panel } = await open('sample.docx');
  calls.external.length = 0;
  await panel.send({ type: 'openLink', href: 'https://example.com/q3-report' });
  await panel.send({ type: 'openLink', href: 'javascript:alert(1)' });
  await panel.send({ type: 'openLink', href: 'command:workbench.action.terminal.new' });
  assert.deepStrictEqual(calls.external, ['https://example.com/q3-report']);
});

test('copyMarkdown and openAsText commands use the cached conversion', async () => {
  const { panel } = await open('sample.docx');
  calls.clipboard.length = 0; calls.textDocs.length = 0;
  await panel.send({ type: 'command', name: 'copyMarkdown' });
  await panel.send({ type: 'command', name: 'openAsText' });
  assert.match(calls.clipboard[0], /^# Q3 2026 Field Report\n/);
  assert.strictEqual(calls.textDocs[0].language, 'plaintext');
  assert.match(calls.textDocs[0].content, /Revenue by region/);
  assert.match(calls.info[calls.info.length - 1], /^Copied \d+ words as Markdown/);
});

test('unknown messages are ignored and closing the panel stops posting', async () => {
  const { panel, provider } = await open('sample.docx');
  const n = panel.posted.length;
  await panel.send({ type: 'command', name: 'deleteEverything' });
  await panel.send('garbage');
  assert.strictEqual(panel.posted.length, n);
  panel.close();
  assert.strictEqual(provider.panels.size, 0);
});

// ---------- support links (Sponsor, More free viewers) ----------
test('support: package.json has the sponsor field, the two commands and the setting', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const support = require('../src/support');
  assert.strictEqual(pkg.sponsor.url, 'https://github.com/sponsors/theluckystrike');
  assert.strictEqual(pkg.sponsor.url, support.sponsorUrl());
  const ids = pkg.contributes.commands.map((c) => c.command);
  assert.ok(ids.includes('docxViewer.supportDeveloper') && ids.includes('docxViewer.moreViewers'));
  const cfgs = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
  assert.strictEqual(cfgs.map((c) => c.properties['docxViewer.showSupportLinks']).find(Boolean).default, true);
  assert.ok(support.otherProducts('zovo.docx-viewer-vscode').every((p) => p.id !== 'zovo.docx-viewer-vscode'));
});

test('support: the footer shows by default and docxViewer.showSupportLinks=false hides it', async () => {
  try {
    for (const [value, shown] of [[undefined, true], [false, false]]) {
      if (value === undefined) delete settings.showSupportLinks; else settings.showSupportLinks = value;
      const { panel } = await open('sample.docx');
      const html = panel.webview.html;
      assert.strictEqual(/id="zovo-support"/.test(html), shown, String(value));
      assert.strictEqual(html.includes('command:docxViewer.supportDeveloper'), shown);
      const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
      assert.ok(!/unsafe-(inline|eval)/.test(csp));
      panel.close();
    }
  } finally { delete settings.showSupportLinks; }
});

test('support: activate registers Support the developer and More free viewers', () => {
  const registered = [];
  const orig = vscodeStub.commands.registerCommand;
  vscodeStub.commands.registerCommand = (id) => { registered.push(id); return { dispose() {} }; };
  try {
    require('../src/extension').activate({ extensionUri: ctx.extensionUri, subscriptions: [], globalState: { get() {}, update: async () => {} } });
  } finally { vscodeStub.commands.registerCommand = orig; }
  assert.ok(registered.includes('docxViewer.supportDeveloper') && registered.includes('docxViewer.moreViewers'));
  assert.ok(registered.includes('docxViewer.compareWithHead') && registered.includes('docxViewer.compareWithDocument'));
});

// ---------- Page view switching (host side) ----------
const os = require('os');
const { NOTES } = require('../src/extension');
function memento() { const m = new Map(); return { get: (k) => m.get(k), update: async (k, v) => { m.set(k, v); }, map: m }; }
const settle = () => new Promise((r) => setTimeout(r, 0));

test('Page view: the switch is offered for .docx only, swaps the CSP and sends the file bytes', async () => {
  ctx.workspaceState = memento();
  try {
    const { panel, doc } = await open('sample.docx');
    assert.match(panel.webview.html, /data-cmd="showPage"/);
    assert.ok(!/unsafe-inline/.test(panel.webview.html));
    await panel.send({ type: 'command', name: 'showPage' });
    assert.strictEqual(ctx.workspaceState.get('docxViewer.view'), 'page', 'the switch is remembered for the workspace');
    assert.match(panel.webview.html, /style-src vscode-resource: &#39;unsafe-inline&#39;|style-src vscode-resource: 'unsafe-inline'/);
    assert.match(panel.webview.html, /data-cmd="showReading"/);
    panel.posted.length = 0;
    await panel.send({ type: 'ready' });
    assert.strictEqual(panel.posted.length, 1);
    assert.strictEqual(panel.posted[0].type, 'pageData');
    assert.ok(panel.posted[0].bytes instanceof Uint8Array);
    assert.ok(!Buffer.isBuffer(panel.posted[0].bytes), 'a Node Buffer reaches the webview as a plain object');
    assert.strictEqual(panel.posted[0].bytes.length, fs.statSync(doc.uri.fsPath).size);
    // A new panel in the same workspace opens in Page view.
    const again = await open('sample.docx');
    assert.strictEqual(again.panel.posted[0].type, 'pageData');
    // .odt and .doc never get Page view, even when it is the remembered choice.
    const odt = await open('report.odt');
    assert.ok(!/data-cmd="showPage"/.test(odt.panel.webview.html));
    assert.strictEqual(odt.panel.posted[0].type, 'begin');
    await odt.panel.send({ type: 'command', name: 'showPage' });
    assert.ok(!/unsafe-inline/.test(odt.panel.webview.html));
    await again.panel.send({ type: 'command', name: 'showReading' });
    assert.strictEqual(ctx.workspaceState.get('docxViewer.view'), 'reading');
  } finally { delete ctx.workspaceState; }
});

test('Page view failure falls back to Reading view with a notice, never an empty page', async () => {
  settings.defaultView = 'page';
  try {
    const { panel } = await open('sample.docx');
    assert.strictEqual(panel.posted[0].type, 'pageData');
    panel.posted.length = 0;
    await panel.send({ type: 'pageFailed', reason: 'error' });
    assert.ok(!/unsafe-inline/.test(panel.webview.html), 'back to the Reading view HTML');
    await panel.send({ type: 'ready' });
    const begin = panel.posted[0];
    assert.strictEqual(begin.type, 'begin');
    assert.strictEqual(begin.banner, NOTES.failed);
    assert.strictEqual(begin.banner, 'Page view could not lay out this file, so it opens in Reading view.');
    assert.ok(panel.posted.some((m) => m.type === 'chunk' && m.html.length > 100));
  } finally { delete settings.defaultView; }
});

test('size guard: a 25 MB file with pageViewMaxMB 20 opens in Reading view with the note and an "anyway" button', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docxv-big-'));
  settings.defaultView = 'page';
  settings.pageViewMaxMB = 20; // the default is 100 since 0.3.0
  try {
    const big = path.join(dir, 'big.docx');
    const fd = fs.openSync(big, 'w');
    fs.writeSync(fd, fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.docx')));
    fs.ftruncateSync(fd, 25 * 1024 * 1024);
    fs.closeSync(fd);
    const provider = new DocxEditorProvider(ctx);
    const doc = await provider.openCustomDocument(Uri.file(big));
    const panel = fakePanel();
    await provider.resolveCustomEditor(doc, panel);
    await panel.send({ type: 'ready' });
    await settle();
    assert.ok(!/unsafe-inline/.test(panel.webview.html));
    panel.posted.length = 0;
    await panel.send({ type: 'ready' });
    assert.strictEqual(panel.posted[0].type, 'begin');
    assert.strictEqual(panel.posted[0].banner, 'This file is too large for Page view. Reading view is faster for it.');
    assert.deepStrictEqual(panel.posted[0].bannerActions, ['pageAnyway']);
    await panel.send({ type: 'command', name: 'pageAnyway' });
    panel.posted.length = 0;
    await panel.send({ type: 'ready' });
    assert.strictEqual(panel.posted[0].type, 'pageData');
  } finally {
    delete settings.pageViewMaxMB;
    delete settings.defaultView;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zoom from one panel is saved for the workspace and sent to the other panels', async () => {
  ctx.workspaceState = memento();
  try {
    const a = await open('sample.docx');
    const b = fakePanel();
    await a.provider.resolveCustomEditor(await a.provider.openCustomDocument(fixture('report.odt')), b);
    await a.panel.send({ type: 'setZoom', zoom: 1.3 });
    assert.strictEqual(ctx.workspaceState.get('docxViewer.zoom'), 1.3);
    assert.ok(b.posted.some((m) => m.type === 'zoom' && m.zoom === 1.3));
    assert.ok(!a.panel.posted.some((m) => m.type === 'zoom'), 'not echoed to the sender');
    const c = await open('sample.docx');
    assert.match(c.panel.webview.html, /data-zoom="1\.3"/);
  } finally { delete ctx.workspaceState; }
});

test('package.json declares the Page view settings', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const props = pj.contributes.configuration.properties;
  assert.deepStrictEqual(props['docxViewer.defaultView'].enum, ['reading', 'page']);
  assert.strictEqual(props['docxViewer.defaultView'].default, 'reading');
  assert.strictEqual(props['docxViewer.pageViewMaxMB'].default, 100); // 0.3.0: a 47 MB report lays out in 0.4 s
  assert.strictEqual(props['docxViewer.zoom'].default, 1);
});

// ---------- tracked changes and comments (host side) ----------
test('tracked.docx opens in Markup with the bar; Final and Original re-render; Copy stays on Final', async () => {
  const { provider, doc, panel } = await open('tracked.docx');
  const begin = panel.posted[0];
  assert.strictEqual(begin.type, 'begin');
  assert.deepStrictEqual(begin.revisions, { label: '2 changes by 2 people · 1 comment', mode: 'markup', authors: ['Alice', 'Bob'] });
  const end = panel.posted[panel.posted.length - 1];
  assert.deepStrictEqual(Object.values(end.changes).map((c) => c.author), ['Alice', 'Bob']);
  assert.match(panel.posted.filter((m) => m.type === 'chunk').map((m) => m.html).join(''), /<del class="dv-del dv-a1 dv-c0">100<\/del><ins class="dv-ins dv-a2 dv-c1">120<\/ins>/);
  assert.deepStrictEqual(end.outline.map((o) => o.text), ['Fees', 'Comments (1)']);
  panel.posted.length = 0;
  await panel.send({ type: 'command', name: 'revOriginal' });
  assert.strictEqual(panel.posted[0].revisions.mode, 'original');
  assert.match(panel.posted.filter((m) => m.type === 'chunk').map((m) => m.html).join(''), /The fee is 100 EUR/);
  panel.posted.length = 0;
  await panel.send({ type: 'command', name: 'revFinal' });
  assert.strictEqual(panel.posted[0].revisions.mode, 'final');
  assert.strictEqual(panel.posted[panel.posted.length - 1].changes, null);
  calls.clipboard.length = 0;
  await panel.send({ type: 'command', name: 'copyMarkdown' });
  assert.strictEqual(calls.clipboard[0], '# Fees\n\nThe fee is 120 EUR\n');
  assert.ok(provider && doc);
});

test('Page view says that Reading view shows the changes, only for files that have them', async () => {
  const { pageNoteText } = require('../src/extension');
  assert.strictEqual(pageNoteText({ changes: 12, comments: 4 }), 'This document has 12 tracked changes and 4 comments. Reading view shows them.');
  settings.defaultView = 'page';
  try {
    const t = await open('tracked.docx');
    await settle();
    assert.deepStrictEqual(t.panel.posted.map((m) => m.type), ['pageData', 'pageNote']);
    assert.strictEqual(t.panel.posted[1].text, 'This document has 2 tracked changes and 1 comment. Reading view shows them.');
    assert.deepStrictEqual(t.panel.posted[1].actions, ['showReading']);
    const s = await open('sample.docx');
    await settle();
    assert.deepStrictEqual(s.panel.posted.map((m) => m.type), ['pageData']);
  } finally { delete settings.defaultView; }
});
