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
      readFile: async (u) => new Uint8Array(fs.readFileSync(u.fsPath))
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

test('.doc file shows the old-format notice with an open-in-app action', async () => {
  const { panel } = await open('legacy.doc');
  assert.strictEqual(panel.posted.length, 1);
  assert.strictEqual(panel.posted[0].type, 'notice');
  assert.strictEqual(panel.posted[0].kind, 'legacyDoc');
  assert.deepStrictEqual(panel.posted[0].actions, ['openInDefaultApp']);
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
