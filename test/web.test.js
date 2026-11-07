'use strict';
// VS Code for the Web build (package.json "browser"). The real out/web bundles run here:
// out/web/worker.js inside a vm context that has only what a browser Web Worker has (no require,
// process, Buffer or Node modules), and out/web/extension.js with a vscode stub in Web mode, whose
// Worker class starts that vm worker from a blob: URL, as the browser does. Needs `npm run build`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resolveObjectURL } = require('buffer');

const ROOT = path.join(__dirname, '..');
const WEB_EXT = path.join(ROOT, 'out', 'web', 'extension.js');
const WEB_WORKER = path.join(ROOT, 'out', 'web', 'worker.js');
const FIX = path.join(__dirname, 'fixtures');
const built = fs.existsSync(WEB_EXT) && fs.existsSync(WEB_WORKER);

// ---- a browser-like Web Worker around the bundled worker script -------------------------------
// No MessageChannel in the worker realm: Node MessagePorts keep the test process alive after the
// last test. JSZip's setImmediate polyfill then schedules with setTimeout, which a browser also has.
function workerContext(onPost) {
  const g = {
    TextDecoder, TextEncoder, URL, Blob, queueMicrotask, console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: globalThis.crypto, importScripts() {}, postMessage: (m) => onPost(m)
  };
  const ctx = vm.createContext(g);
  vm.runInContext('self = globalThis', ctx);
  return ctx;
}

class FakeWorker {
  constructor(url) {
    FakeWorker.started.push(url);
    if (FakeWorker.refuse) throw new Error('nested workers are not supported');
    this.ready = resolveObjectURL(url).text().then((code) => {
      this.ctx = workerContext((m) => { if (!this.terminated && this.onmessage) setImmediate(() => this.onmessage({ data: structuredClone(m) })); });
      vm.runInContext(code, this.ctx, { filename: 'out/web/worker.js' });
    });
  }
  postMessage(msg) {
    this.ready.then(() => {
      const U8 = vm.runInContext('Uint8Array', this.ctx);
      this.ctx.onmessage({ data: { bytes: U8.from(msg.bytes), opts: JSON.parse(JSON.stringify(msg.opts || {})) } });
    }).catch((err) => this.onerror && this.onerror({ message: String(err) }));
  }
  terminate() { this.terminated = true; }
}
FakeWorker.started = [];
FakeWorker.refuse = false;

// Converts one file with the bundled web worker, outside the extension.
function convertWithWebWorker(bytes, opts) {
  const url = URL.createObjectURL(new Blob([fs.readFileSync(WEB_WORKER)], { type: 'text/javascript' }));
  return new Promise((resolve, reject) => {
    const w = new FakeWorker(url);
    w.onmessage = (e) => { w.terminate(); resolve(e.data); };
    w.onerror = (e) => reject(new Error(e.message));
    w.postMessage({ bytes, opts });
  });
}

// ---- small pieces --------------------------------------------------------------------------------
test('rand: hex tags and CSP nonces come from Web Crypto, with the right length and alphabet', () => {
  const { hex, nonce } = require('../src/rand');
  assert.match(hex(4), /^[0-9a-f]{8}$/);
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const n = nonce(); assert.match(n, /^[A-Za-z0-9]{22}$/); seen.add(n); }
  assert.strictEqual(seen.size, 200);
});

test('detect: oleKind and detectFormat give the same answers for a Node Buffer and a plain Uint8Array', () => {
  const { detectFormat, oleKind, indexOfBytes } = require('../src/detect');
  for (const f of fs.readdirSync(FIX)) {
    const buf = fs.readFileSync(path.join(FIX, f));
    const u8 = new Uint8Array(buf);
    assert.strictEqual(detectFormat(u8), detectFormat(buf), f);
    assert.strictEqual(oleKind(u8), oleKind(buf), f);
  }
  const hay = new Uint8Array([1, 2, 3, 1, 2, 4, 1, 2]);
  assert.strictEqual(indexOfBytes(hay, new Uint8Array([1, 2, 4])), 3);
  assert.strictEqual(indexOfBytes(hay, new Uint8Array([2, 4, 1, 2])), 4);
  assert.strictEqual(indexOfBytes(hay, new Uint8Array([4, 1, 2, 3])), -1);
  assert.strictEqual(oleKind(new Uint8Array(fs.readFileSync(path.join(FIX, 'simple.doc')))), 'doc');
});

test('web path stand-in matches path.posix for the calls the extension makes', () => {
  const web = require('../src/web/path');
  const cases = ['/a/b/Report.docx', 'Report.docx', '/Report.docx', '/a/b/', '/a/b.c/d', '/a/.hidden', 'x/y.tar.gz', '/'];
  for (const c of cases) {
    assert.strictEqual(web.basename(c), path.posix.basename(c), 'basename ' + c);
    assert.strictEqual(web.dirname(c), path.posix.dirname(c), 'dirname ' + c);
    assert.strictEqual(web.extname(c), path.posix.extname(c), 'extname ' + c);
  }
  assert.strictEqual(web.basename('/a/b.docx', '.docx'), 'b');
  assert.strictEqual(web.join('/a', 'b', '../c', 'd.docx'), path.posix.join('/a', 'b', '../c', 'd.docx'));
});

test('web stream stand-in: data, end and error in order, as word-extractor reads its OLE streams (simple.doc runs through it in the bundle test below)', async () => {
  const { Readable } = require('../src/web/stream');
  class Chunks extends Readable { constructor(parts) { super(); this.parts = parts; } _read() { return Promise.resolve().then(() => this.push(this.parts.length ? this.parts.shift() : null)); } }
  const got = await new Promise((resolve, reject) => {
    const out = [];
    const s = new Chunks(['a', 'b', 'c']);
    s.on('data', (c) => out.push(c)); s.on('error', reject); s.on('end', () => resolve(out.join('')));
  });
  assert.strictEqual(got, 'abc');
  const failing = new (class extends Readable { _read() { return Promise.reject(new Error('bad sector')); } })();
  await assert.rejects(new Promise((resolve, reject) => { failing.on('data', () => {}); failing.on('error', reject); failing.on('end', resolve); }), /bad sector/);
});

test('web child_process stand-in fails like a missing git, so Compare with Git HEAD explains it', async () => {
  const { readFromHead } = require('../src/compare');
  const { execFile } = require('../src/web/child_process');
  const r = await readFromHead('/repo/a.docx', 1024, execFile);
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /Git is not installed/);
});

test('package.json: browser entry, and the two desktop-only commands are hidden on the web', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.browser, './out/web/extension.js');
  assert.strictEqual(pkg.main, './out/extension.js');
  assert.strictEqual(pkg.capabilities.virtualWorkspaces, true);
  const m = pkg.contributes.menus;
  const all = [...m['editor/title'], ...m['explorer/context'], ...m['scm/resourceState/context'], ...m.commandPalette];
  for (const item of all.filter((i) => i.command === 'docxViewer.compareWithHead' || i.command === 'docxViewer.openInDefaultApp')) {
    assert.match(item.when, /!isWeb/, item.command + ' ' + item.when);
  }
  const ignore = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
  assert.doesNotMatch(ignore, /^out\/\*\*|^out\/web/m, 'out/web must ship in the vsix');
});

// ---- the bundles ---------------------------------------------------------------------------------
test('web bundles load no Node module: the only require left is vscode; the converter ships once', { skip: !built && 'run npm run build first' }, () => {
  const ext = fs.readFileSync(WEB_EXT, 'utf8');
  assert.ok(ext.length < 80 * 1024, 'out/web/extension.js is ' + ext.length + ' bytes: the converter must stay in the worker only');
  assert.doesNotMatch(ext, /readFloatLE|ieee754/, 'no Buffer polyfill in the extension host bundle');
  const requires = new Set([...ext.matchAll(/\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((x) => x[1]));
  assert.deepStrictEqual([...requires], ['vscode']);
  const worker = fs.readFileSync(WEB_WORKER, 'utf8');
  assert.doesNotMatch(worker, /\brequire\(\s*["'`]/);
  assert.doesNotMatch(worker, /worker_threads|child_process/);
});

test('web worker bundle converts every fixture like the desktop converter (no Node globals in its realm)', { skip: !built && 'run npm run build first' }, async () => {
  const { convertDocx } = require('../src/convert');
  const files = fs.readdirSync(FIX).filter((f) => /\.(docx|dotx|docm|odt|doc)$/.test(f));
  assert.ok(files.length >= 10, 'fixtures: ' + files.length);
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(FIX, f));
    const ext = path.extname(f).toLowerCase();
    const desk = await convertDocx(bytes, { ext });
    const msg = await convertWithWebWorker(bytes, { ext });
    assert.ok(!msg.error, f + ': ' + msg.error);
    const web = msg.result;
    assert.strictEqual(web.ok, desk.ok, f);
    if (!desk.ok) { assert.strictEqual(web.notice.kind, desk.notice.kind, f); continue; }
    assert.strictEqual(web.text, desk.text, f + ' text');
    assert.strictEqual(web.markdown.replace(/⁣[0-9a-f]+:/g, ''), desk.markdown.replace(/⁣[0-9a-f]+:/g, ''), f + ' markdown');
    assert.deepStrictEqual(web.outline, desk.outline, f + ' outline');
    assert.strictEqual((web.images || []).length, (desk.images || []).length, f + ' images');
    for (let i = 0; i < (desk.images || []).length; i++) assert.deepStrictEqual(Buffer.from(web.images[i].data), Buffer.from(desk.images[i].data), f + ' image ' + i);
  }
});

// ---- the extension in Web mode ---------------------------------------------------------------------
const calls = { info: [], external: [] };
class Uri {
  constructor(p, scheme) { this.path = p; this.fsPath = p; this.scheme = scheme || 'file'; }
  static file(p) { return new Uri(p); }
  static parse(s) { const u = new Uri(s, s.split(':')[0]); u.raw = s; return u; }
  static joinPath(u, ...parts) { return new Uri(path.posix.join(u.path, ...parts), u.scheme); }
  toString() { return this.raw || this.scheme + '://' + this.path; }
}
let registered = {};
const vscodeWeb = {
  Uri, UIKind: { Desktop: 1, Web: 2 },
  EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} },
  RelativePattern: class { constructor(b, p) { this.base = b; this.pattern = p; } },
  ViewColumn: { Beside: -2 }, ProgressLocation: { Window: 10, Notification: 15 },
  workspace: {
    isTrusted: true,
    getConfiguration: () => ({ get: (k, d) => d }),
    fs: {
      stat: async (u) => ({ size: fs.statSync(u.path).size }),
      readFile: async (u) => new Uint8Array(fs.readFileSync(u.path)) // the browser API returns a Uint8Array
    },
    createFileSystemWatcher: () => ({ onDidChange: () => ({ dispose() {} }), onDidCreate: () => ({ dispose() {} }), dispose() {} }),
    openTextDocument: async (o) => o,
    onDidChangeConfiguration: () => ({ dispose() {} }),
    registerTextDocumentContentProvider: () => ({ dispose() {} })
  },
  window: {
    showInformationMessage: async (m) => { calls.info.push(m); },
    showWarningMessage: async (m) => { calls.info.push(m); },
    showTextDocument: async () => {},
    withProgress: (_o, fn) => fn(),
    registerCustomEditorProvider: () => ({ dispose() {} })
  },
  env: {
    uiKind: 2,
    openExternal: async (u) => { calls.external.push(String(u)); return true; },
    clipboard: { writeText: async () => {} }
  },
  commands: { registerCommand: (id, fn) => { registered[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} }
};

// Loads the browser bundle the way the web extension host does (CommonJS, only 'vscode' resolvable),
// with Worker and fetch as in a browser worker.
function loadWebExtension() {
  const code = fs.readFileSync(WEB_EXT, 'utf8');
  const mod = { exports: {} };
  const req = (n) => { if (n === 'vscode') return vscodeWeb; throw new Error('web bundle required ' + n); };
  const fakeFetch = async (url) => {
    assert.strictEqual(url, 'https://ext.test/out/web/worker.js');
    return { ok: true, status: 200, text: async () => fs.readFileSync(WEB_WORKER, 'utf8') };
  };
  // Worker and fetch are globals in a browser worker; the bundle sees them through these parameters.
  const fn = new Function('module', 'exports', 'require', 'Worker', 'fetch', code);
  fn(mod, mod.exports, req, FakeWorker, fakeFetch);
  return mod.exports;
}

function fakePanel() {
  const listeners = {};
  const panel = {
    active: true, visible: true, posted: [],
    webview: {
      cspSource: 'https://ext.test', asWebviewUri: (u) => u, options: null, html: '',
      postMessage: async (m) => { panel.posted.push(m); return true; },
      onDidReceiveMessage: (fn) => { listeners.msg = fn; return { dispose() {} }; }
    },
    onDidChangeViewState: () => ({ dispose() {} }),
    onDidDispose: (fn) => { listeners.dispose = fn; },
    send: (m) => listeners.msg(m)
  };
  return panel;
}

test('web extension bundle: opens .docx, .odt and .doc through a nested Web Worker; notices leave out Open in default app', { skip: !built && 'run npm run build first' }, async () => {
  const ext = loadWebExtension();
  const context = { extensionUri: new Uri('/', 'https'), subscriptions: [], globalState: { get: () => undefined, update: async () => {}, setKeysForSync() {} }, workspaceState: { get: () => undefined, update: async () => {} } };
  // extensionUri https://ext.test/ -> worker URL https://ext.test/out/web/worker.js
  context.extensionUri.toString = () => 'https://ext.test/';
  const origJoin = Uri.joinPath;
  Uri.joinPath = (u, ...parts) => { const r = origJoin(u, ...parts); if (u === context.extensionUri) r.toString = () => 'https://ext.test/' + parts.join('/'); return r; };
  const api = ext.activate(context);
  Uri.joinPath = origJoin;
  const provider = api.provider;
  FakeWorker.started.length = 0;

  async function open(f) {
    const doc = await provider.openCustomDocument(Uri.file(path.join(FIX, f)));
    const panel = fakePanel();
    await provider.resolveCustomEditor(doc, panel);
    await panel.send({ type: 'ready' });
    return { doc, panel };
  }
  for (const [f, outline] of [['sample.docx', 7], ['report.odt', 6], ['pump-test.docx', null], ['simple.doc', null]]) {
    const { panel } = await open(f);
    const types = panel.posted.map((m) => m.type);
    assert.strictEqual(types[0], 'begin', f + ' ' + JSON.stringify(panel.posted[0]).slice(0, 300));
    assert.strictEqual(types[types.length - 1], 'end', f);
    if (outline !== null) assert.strictEqual(panel.posted[panel.posted.length - 1].outline.length, outline, f);
  }
  assert.ok(FakeWorker.started.length >= 4, 'one worker per conversion');
  assert.ok(FakeWorker.started.every((u) => u.startsWith('blob:')), 'started from a blob: URL');

  const { panel } = await open('legacy.doc');
  assert.strictEqual(panel.posted[0].type, 'notice');
  assert.deepStrictEqual(panel.posted[0].actions, ['reload']);

  calls.info.length = 0; calls.external.length = 0;
  await registered['docxViewer.openInDefaultApp'](Uri.file(path.join(FIX, 'sample.docx')));
  assert.deepStrictEqual(calls.external, []);
  assert.match(calls.info[0], /cannot open files in another app/);
  assert.strictEqual(ext.isWeb(), true);
});

test('web runner: a browser that refuses the worker gives a clear notice, or the injected in-place converter', { skip: !built && 'run npm run build first' }, async () => {
  const rw = require('../src/web/run-worker');
  rw.configure({ workerUrl: 'https://ext.test/out/web/worker.js', inProcess: require('../src/convert').convertDocx });
  FakeWorker.refuse = true;
  try {
    const r = await rw.convertInWorker(fs.readFileSync(path.join(FIX, 'sample.docx')), { ext: '.docx' }, { Worker: FakeWorker, fetch: async () => ({ ok: true, text: async () => fs.readFileSync(WEB_WORKER, 'utf8') }) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(rw.lastMode(), 'inline');
    rw.configure({ workerUrl: 'https://ext.test/other.js', inProcess: null });
    const n = await rw.convertInWorker(new Uint8Array([1]), {}, { Worker: FakeWorker, fetch: async () => ({ ok: true, text: async () => '' }) });
    assert.strictEqual(n.ok, false);
    assert.match(n.notice.title, /could not start its converter/);
    assert.strictEqual(rw.lastMode(), 'none');
  } finally { FakeWorker.refuse = false; }
});

test('web runner: a worker that never answers is stopped by the time limit with a clear notice', async () => {
  const rw = require('../src/web/run-worker');
  rw.configure({ workerUrl: 'https://ext.test/w.js' });
  let terminated = false;
  class Silent { constructor() {} postMessage() {} terminate() { terminated = true; } }
  const r = await rw.convertInWorker(new Uint8Array([1, 2, 3]), {}, { Worker: Silent, timeoutMs: 50, fetch: async () => ({ ok: true, text: async () => '' }) });
  assert.strictEqual(r.ok, false);
  assert.match(r.notice.title, /took too long/);
  assert.strictEqual(terminated, true);
});

test('web runner: a worker error becomes a could-not-read notice, out-of-memory gets its own title', async () => {
  const rw = require('../src/web/run-worker');
  rw.configure({ workerUrl: 'https://ext.test/w.js' });
  for (const [message, title] of [['SyntaxError: bad', /could not read/], ['RangeError: Array buffer allocation failed', /too much memory/]]) {
    class Failing { postMessage() { setTimeout(() => this.onerror({ message, preventDefault() {} }), 5); } terminate() {} }
    const r = await rw.convertInWorker(new Uint8Array([1]), {}, { Worker: Failing, fetch: async () => ({ ok: true, text: async () => '' }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.notice.title, title);
  }
});
