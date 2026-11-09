'use strict';
// EXEC15 (CONV3 fix 5): the toolbar "Compare" button and its quick pick, and the try rule of src/pro.js:
// check() before any input, commit() only after the output is on disk. A cancelled picker or save dialog keeps
// every free try.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPro, TRIAL_USES, TRIAL_KEY } = require('../src/pro');
const { createCompareMenu } = require('../src/compare-menu');
const { registerFolders } = require('../src/redline/folders');
const { createRedline } = require('../src/redline/panel');
const { buildWebviewHtml, buildPageHtml } = require('../src/webview-html');
const P = require('../media/protocol');
const F = require('./helpers/redline-fixtures');

class Uri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; this.fsPath = p; }
  static file(p) { return new Uri('file', p); }
  static joinPath(u, ...parts) { return new Uri(u.scheme, path.join(u.path, ...parts)); }
  toString() { return this.scheme + '://' + this.path; }
}

function stubContext() {
  const store = new Map();
  return { store, globalState: { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } }, subscriptions: [] };
}

// A license stub that is never Pro and records every explaining modal.
function stubLicense() {
  const shown = [];
  return { shown, isPro: () => false, refresh() {}, requirePro: async (f) => { shown.push(f); return false; }, onDidChange: () => ({ dispose() {} }), ready: Promise.resolve() };
}

// A vscode stub. dialogs: answers for showOpenDialog in order (undefined = Escape). save: the showSaveDialog answer.
function stubVscode(opts) {
  const o = opts || {};
  const dialogs = (o.dialogs || []).slice();
  const calls = { open: 0, save: 0, picks: [], infos: [], warnings: [], status: [] };
  const cmds = {};
  const vscode = {
    Uri,
    FileType: { File: 1, Directory: 2 },
    ProgressLocation: { Notification: 15 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    workspace: {
      getConfiguration: () => ({ get: (k, d) => (k === 'showProFeatures' && o.showPro !== undefined ? o.showPro : d) }),
      workspaceFolders: undefined,
      fs: {
        readDirectory: async (u) => fs.readdirSync(u.path, { withFileTypes: true }).map((e) => [e.name, e.isDirectory() ? 2 : 1]),
        stat: async (u) => ({ size: fs.statSync(u.path).size }),
        readFile: async (u) => fs.readFileSync(u.path),
        writeFile: async (u, data) => fs.writeFileSync(u.path, data)
      }
    },
    window: {
      showOpenDialog: async () => { calls.open++; return dialogs.shift(); },
      showSaveDialog: async () => { calls.save++; return o.save; },
      showQuickPick: async (items, qp) => { calls.picks.push({ items, qp }); return typeof o.pick === 'function' ? o.pick(items) : undefined; },
      showInformationMessage: async (m) => { calls.infos.push(m); return undefined; },
      showWarningMessage: async (m) => { calls.warnings.push(m); return undefined; },
      setStatusBarMessage: (m) => { calls.status.push(m); },
      withProgress: async (_o, fn) => fn({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) })
    },
    commands: { registerCommand: (id, fn) => { cmds[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} },
    env: { openExternal: async () => {} }
  };
  return { vscode, calls, cmds };
}

const tries = (ctx) => (ctx.store.get(TRIAL_KEY) || {});

test('EXEC15: Escape on the first, second or save folder picker keeps 3 of 3 folder compare tries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec15-cancel-'));
  try {
    const older = path.join(root, 'v1');
    const newer = path.join(root, 'v2');
    for (const d of [older, newer]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(older, 'A.docx'), await F.contractV1());
    fs.writeFileSync(path.join(newer, 'A.docx'), await F.contractV2());
    const answers = [
      [undefined],                                            // Escape on "older"
      [[Uri.file(older)], undefined],                         // Escape on "newer"
      [[Uri.file(older)], [Uri.file(newer)], undefined]       // Escape on "save here"
    ];
    for (const dialogs of answers) {
      const ctx = stubContext();
      const { vscode, calls, cmds } = stubVscode({ dialogs });
      const lic = stubLicense();
      const pro = createPro({ vscode, context: ctx, license: lic });
      registerFolders({ vscode, context: ctx, redline: { open: async () => {} }, pro, isWeb: () => false });
      assert.equal(await cmds['docxViewer.compareFolders'](), undefined);
      assert.equal(calls.open, dialogs.length);
      assert.deepEqual(tries(ctx), {}, 'no try stored');
      assert.equal(pro.left('compareFolders'), TRIAL_USES);
      assert.equal(pro.label('compareFolders'), 'Pro, 3 free tries');
      assert.equal(calls.status.length, 0, 'no "free try used" status message');
      assert.equal(lic.shown.length, 0, 'no Pro window while tries are left');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('EXEC15: a folder compare uses one try only after index.html is written; no matching names uses none', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec15-commit-'));
  try {
    const older = path.join(root, 'v1');
    const newer = path.join(root, 'v2');
    const other = path.join(root, 'v3');
    const out = path.join(root, 'out');
    for (const d of [older, newer, other, out]) fs.mkdirSync(d);
    fs.writeFileSync(path.join(older, 'A.docx'), await F.contractV1());
    fs.writeFileSync(path.join(newer, 'A.docx'), await F.contractV2());
    fs.writeFileSync(path.join(other, 'B.docx'), await F.contractV2());
    const ctx = stubContext();
    const lic = stubLicense();
    // No document with the same name: nothing written, no try.
    let s = stubVscode({ dialogs: [[Uri.file(older)], [Uri.file(other)]] });
    let pro = createPro({ vscode: s.vscode, context: ctx, license: lic });
    registerFolders({ vscode: s.vscode, context: ctx, redline: { open: async () => {} }, pro, isWeb: () => false });
    await s.cmds['docxViewer.compareFolders']();
    assert.match(s.calls.infos[0], /No documents with the same name/);
    assert.equal(pro.left('compareFolders'), 3);
    // A real run: the try is stored after the report exists.
    s = stubVscode({ dialogs: [[Uri.file(older)], [Uri.file(newer)], [Uri.file(out)]] });
    let seenIndexBeforeCommit = null;
    const upd = ctx.globalState.update;
    ctx.globalState.update = async (k, v) => { if (k === TRIAL_KEY) seenIndexBeforeCommit = fs.existsSync(path.join(out, 'index.html')); return upd(k, v); };
    pro = createPro({ vscode: s.vscode, context: ctx, license: lic });
    registerFolders({ vscode: s.vscode, context: ctx, redline: { open: async () => {} }, pro, isWeb: () => false });
    const r = await s.cmds['docxViewer.compareFolders']();
    assert.equal(r.results.length, 1);
    assert.equal(seenIndexBeforeCommit, true, 'index.html existed when the try was stored');
    assert.equal(pro.left('compareFolders'), 2);
    assert.match(s.calls.status[0], /free try of folder compare used, 2 left/);
    assert.equal(pro.left('exportRedline'), 3, 'the other tool keeps its own tries');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('EXEC15: redline export uses a try only after the file is saved; Escape on the save dialog keeps it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'exec15-export-'));
  try {
    const a = await F.contractV1();
    const b = await F.contractV2();
    const ctx = stubContext();
    const lic = stubLicense();
    const fakePanel = (redline) => ({
      payload: { exportDocx: true },
      a: { name: 'Contract v1.docx', bytes: a, label: 'older' },
      b: { name: 'Contract v2.docx', bytes: b, label: 'newer' },
      job: (task) => ({ task, a: { bytes: a, name: 'Contract v1.docx', label: 'older' }, b: { bytes: b, name: 'Contract v2.docx', label: 'newer' }, opts: { formatting: true, author: 'Compare', date: '2026-11-10T00:00:00Z' } }),
      postPro() { this.posted = (this.posted || 0) + 1; },
      redline
    });
    // Escape on the save dialog.
    let s = stubVscode({ save: undefined });
    let pro = createPro({ vscode: s.vscode, context: ctx, license: lic });
    let rl = createRedline({ vscode: s.vscode, context: ctx, pro, cfg: () => ({}) });
    let p = fakePanel();
    assert.equal(await rl.host.exportRedline(p, 'docx'), undefined);
    assert.equal(s.calls.save, 1);
    assert.equal(pro.left('exportRedline'), 3);
    assert.equal(p.posted || 0, 0);
    // Saved: one try.
    const target = Uri.file(path.join(root, 'out redline.docx'));
    s = stubVscode({ save: target });
    pro = createPro({ vscode: s.vscode, context: ctx, license: lic });
    rl = createRedline({ vscode: s.vscode, context: ctx, pro, cfg: () => ({}) });
    p = fakePanel();
    await rl.host.exportRedline(p, 'docx');
    assert.ok(fs.statSync(target.path).size > 1000, 'the .docx is on disk');
    assert.equal(pro.left('exportRedline'), 2);
    assert.equal(p.posted, 1, 'the panel gets the new try count');
    // With no tries left the save dialog never opens; the Pro window explains once.
    await ctx.globalState.update(TRIAL_KEY, { exportRedline: 3 });
    s = stubVscode({ save: target });
    pro = createPro({ vscode: s.vscode, context: ctx, license: lic });
    rl = createRedline({ vscode: s.vscode, context: ctx, pro, cfg: () => ({}) });
    await rl.host.exportRedline(fakePanel(), 'docx');
    assert.equal(s.calls.save, 0);
    assert.deepEqual(lic.shown, ['Redline export']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function menuFor(o) {
  const s = stubVscode(o);
  const ctx = stubContext();
  const lic = o.license || stubLicense();
  const pro = o.web ? null : createPro({ vscode: s.vscode, context: ctx, license: lic });
  const called = [];
  const compare = {
    compareWithHead: async (u) => { called.push(['head', u]); },
    compareWithOther: async (u, sel, forced) => { called.push(['other', u, forced]); return o.panel; }
  };
  const folders = o.web ? null : { compareFolders: async () => { called.push(['folders']); } };
  const exports = [];
  const redline = o.web ? null : { active: () => o.open || null, host: { exportRedline: async (p, f) => { exports.push([p, f]); } } };
  const menu = createCompareMenu({ vscode: s.vscode, pro, compare, redline, folders, isWeb: () => !!o.web, activeUri: () => Uri.file('/w/doc.docx') });
  return { s, ctx, lic, pro, menu, called, exports };
}

test('EXEC15: the Compare quick pick lists the 2 free compares first, then the 2 Pro tools with their free tries', async () => {
  const m = menuFor({});
  await m.menu.menu();
  const { items, qp } = m.s.calls.picks[0];
  const labels = items.map((i) => i.label.replace(/^\$\([a-z-]+\) /, ''));
  assert.deepEqual(labels, [
    'Compare with Git HEAD',
    'Compare with another document',
    'Zovo Pro',
    'Compare two folders (Pro, 3 free tries)',
    'Export redline as Word with tracked changes (Pro, 3 free tries)'
  ]);
  assert.equal(items[0].description, 'free');
  assert.equal(items[1].description, 'free');
  assert.equal(items[2].kind, -1, 'a separator, not a choice');
  assert.equal(qp.title, 'Compare this document');
  assert.match(qp.placeHolder, /3 free tries each/);
  assert.match(qp.placeHolder, /USD 19 once/);
  // Escape on the quick pick: nothing runs.
  assert.deepEqual(m.called, []);
  // After one saved export the label counts down.
  await m.pro.commit('exportRedline');
  assert.match(m.menu.items()[4].label, /\(Pro, 2 free tries\)$/);
  await m.pro.commit('exportRedline'); await m.pro.commit('exportRedline');
  assert.match(m.menu.items()[4].label, /\(Pro\)$/);
});

test('EXEC15: Compare quick pick choices run the right command; showProFeatures=false and the web build hide the Pro rows', async () => {
  const doc = Uri.file('/w/doc.docx');
  for (const [id, want] of [['head', 'head'], ['other', 'other'], ['folders', 'folders']]) {
    const m = menuFor({ pick: (items) => items.find((i) => i.id === id) });
    await m.menu.menu(doc);
    assert.equal(m.called[0][0], want);
    if (id !== 'folders') assert.equal(m.called[0][1], doc);
    assert.equal(m.pro.left('compareFolders'), 3, 'choosing in the menu uses no try');
  }
  const hidden = menuFor({ showPro: false });
  assert.deepEqual(hidden.menu.items().map((i) => i.id), ['head', 'other']);
  const web = menuFor({ web: true });
  assert.deepEqual(web.menu.items().map((i) => i.id), ['other']);
  await web.menu.menu();
  assert.equal(web.s.calls.picks[0].qp.placeHolder, 'Pick a compare');
  // A Pro user sees the tools without a tries label.
  const lic = Object.assign(stubLicense(), { isPro: () => true });
  const paid = menuFor({ license: lic });
  assert.deepEqual(paid.menu.items().slice(3).map((i) => i.label.replace(/^\$\([a-z-]+\) /, '')), ['Compare two folders', 'Export redline as Word with tracked changes']);
});

test('EXEC15: Export from the Compare menu: the open redline is exported; otherwise compare first, export after it finishes; no tries left explains before any picker', async () => {
  // An open redline with a result is exported directly.
  const open = { payload: { exportDocx: true } };
  let m = menuFor({ open, pick: (items) => items.find((i) => i.id === 'export') });
  await m.menu.menu();
  assert.deepEqual(m.exports, [[open, 'docx']]);
  assert.deepEqual(m.called, []);
  // No redline open: compare this document with another (redline view), wait, then export.
  const panel = { payload: null };
  panel.done = Promise.resolve().then(() => { panel.payload = { exportDocx: true }; return { ok: true }; });
  m = menuFor({ panel, pick: (items) => items.find((i) => i.id === 'export') });
  await m.menu.menu();
  assert.equal(m.called[0][0], 'other');
  assert.equal(m.called[0][2], 'redline');
  assert.deepEqual(m.exports, [[panel, 'docx']]);
  // Escape on the document picker (compareWithOther returns nothing): no export, no try.
  m = menuFor({ panel: undefined, pick: (items) => items.find((i) => i.id === 'export') });
  await m.menu.menu();
  assert.deepEqual(m.exports, []);
  assert.equal(m.pro.left('exportRedline'), 3);
  // A failed compare: no export.
  const bad = { payload: null, done: Promise.resolve({ ok: false }) };
  m = menuFor({ panel: bad, pick: (items) => items.find((i) => i.id === 'export') });
  await m.menu.menu();
  assert.deepEqual(m.exports, []);
  // No tries left: the Pro window explains, no picker opens.
  m = menuFor({ panel, pick: (items) => items.find((i) => i.id === 'export') });
  await m.ctx.globalState.update(TRIAL_KEY, { exportRedline: 3 });
  await m.menu.menu();
  assert.deepEqual(m.called, []);
  assert.deepEqual(m.lic.shown, ['Redline export']);
});

test('EXEC15: both toolbars have a plain "Compare" button (no PRO badge); the protocol and package.json know the command', () => {
  const opts = { nonce: 'n', cspSource: 'vscode-resource:', uris: { css: 'c', protocol: 'p', search: 's', viewer: 'v', pageView: 'pv', page: 'pg' }, showSupportLinks: false };
  for (const html of [buildWebviewHtml(opts), buildPageHtml(opts)]) {
    const m = html.match(/<button[^>]*data-cmd="compare"[^>]*>([^<]*)<\/button>/);
    assert.ok(m, 'Compare button present');
    assert.equal(m[1], 'Compare');
    assert.doesNotMatch(html, /PRO<|proBadge/);
  }
  assert.deepEqual(P.validateInbound({ type: 'command', name: 'compare' }), { ok: true, msg: { type: 'command', name: 'compare' } });
  const pk = require('../package.json');
  const c = pk.contributes.commands.find((x) => x.command === 'docxViewer.compare');
  assert.equal(c.title, 'Compare...');
  assert.ok(pk.contributes.menus['editor/title'].find((x) => x.command === 'docxViewer.compare'));
  // CONV3 fix 6: one "Zovo Pro" palette category with the same titles in every product.
  const t = Object.fromEntries(pk.contributes.commands.filter((x) => x.category === 'Zovo Pro').map((x) => [x.command.split('.')[1], x.title]));
  assert.deepEqual(Object.keys(t), ['getPro', 'payWithPayPal', 'unlockWithSponsors', 'enterLicenseKey', 'removeLicense']);
});

test('EXEC15: activation adds no Pro badge, toast or popup; the Compare command is registered', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.js'), 'utf8');
  assert.match(src, /registerCommand\('docxViewer\.compare'/);
  assert.match(src, /case 'compare': return this\.compareMenu/);
  const menu = fs.readFileSync(path.join(__dirname, '..', 'src', 'compare-menu.js'), 'utf8');
  assert.doesNotMatch(menu, /show(Information|Warning|Error)Message/);
});
