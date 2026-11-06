'use strict';
// "Compare with Git HEAD" and "Compare with Another Document": git reading in a real temporary
// repository, error sentences, the safety flags passed to git, and the diff command wiring.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('../src/compare');
const { convertDocx } = require('../src/convert');

const fx = (f) => path.join(__dirname, 'fixtures', f);
let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docxv-compare-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function gitRepo(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, stdio: 'pipe' });
  g('init', '-q');
  return { dir, g };
}

test('DiffStore keeps at most max entries; diffPath and diffTitle are safe and readable', () => {
  const s = new C.DiffStore(2);
  const a = s.put('a'); s.put('b'); const c = s.put('c');
  assert.strictEqual(s.get(a), null);
  assert.strictEqual(s.get(c), 'c');
  assert.strictEqual(C.diffPath('HEAD', 'a/b?#.docx'), '/HEAD/a_b__.docx.md');
  assert.strictEqual(C.diffTitle('r.docx', 'HEAD', 'r.docx', 'Working Tree'), 'r.docx (HEAD ↔ Working Tree, as Markdown)');
  assert.strictEqual(C.diffTitle('a.docx', 'A', 'b.odt', 'B'), 'a.docx ↔ b.odt (as Markdown)');
  assert.ok(C.isDocument('/x/Report.ODT') && C.isDocument('a.docx') && !C.isDocument('a.pdf'));
});

test('readFromHead returns the committed bytes while the working copy differs', async () => {
  const { dir, g } = gitRepo('repo1');
  const file = path.join(dir, 'Report.docx');
  fs.copyFileSync(fx('sample.docx'), file);
  g('add', '.'); g('commit', '-q', '-m', 'add');
  fs.copyFileSync(fx('sample.dotx'), file);
  const r = await C.readFromHead(file, 50 * 1024 * 1024);
  assert.ok(r.ok, r.message);
  assert.ok(Buffer.compare(r.bytes, fs.readFileSync(fx('sample.docx'))) === 0);
});

test('readFromHead explains a new file, a folder outside git and a missing git', async () => {
  const { dir, g } = gitRepo('repo2');
  fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
  g('add', '.'); g('commit', '-q', '-m', 'first');
  fs.copyFileSync(fx('sample.docx'), path.join(dir, 'New.docx'));
  const r1 = await C.readFromHead(path.join(dir, 'New.docx'), 1e6);
  assert.match(r1.message, /no committed version/);
  const plain = path.join(tmp, 'plain'); fs.mkdirSync(plain);
  fs.copyFileSync(fx('sample.docx'), path.join(plain, 'A.docx'));
  const r2 = await C.readFromHead(path.join(plain, 'A.docx'), 1e6);
  assert.match(r2.message, /not in a Git repository|no committed version/);
  const missing = (cmd, args, opts, cb) => { const e = new Error('spawn git ENOENT'); e.code = 'ENOENT'; cb(e, Buffer.alloc(0), Buffer.alloc(0)); };
  const r3 = await C.readFromHead('/x/A.docx', 1e6, missing);
  assert.match(r3.message, /Git is not installed/);
});

test('git runs without a shell, with fsmonitor and hooks off, and with cat-file (no textconv)', async () => {
  let seen;
  const fake = (cmd, args, opts, cb) => { seen = { cmd, args, opts }; cb(null, Buffer.from('PK')); };
  await C.readFromHead('/repo/sub/A.docx', 5e6, fake);
  assert.strictEqual(seen.cmd, 'git');
  assert.deepStrictEqual(seen.args, ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'cat-file', 'blob', 'HEAD:./A.docx']);
  assert.strictEqual(seen.opts.cwd, '/repo/sub');
  assert.strictEqual(seen.opts.encoding, 'buffer');
  assert.ok(!('shell' in seen.opts));
});

// ---- command wiring with a stubbed vscode ----
class Uri {
  constructor(scheme, p, query) { this.scheme = scheme; this.path = p; this.fsPath = p; this.query = query || ''; }
  static file(p) { return new Uri('file', p); }
  static from(o) { return new Uri(o.scheme, o.path, o.query); }
  static joinPath(u, ...parts) { return new Uri(u.scheme, path.join(u.path, ...parts)); }
  toString() { return this.scheme + '://' + this.path + (this.query ? '?' + this.query : ''); }
}
function stubVscode(trusted) {
  const calls = { diff: [], info: [], warn: [], cmds: {}, provider: null };
  const vscode = {
    Uri,
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } dispose() {} },
    ProgressLocation: { Notification: 15 },
    workspace: { isTrusted: trusted, registerTextDocumentContentProvider: (scheme, p) => { calls.provider = { scheme, p }; return { dispose() {} }; } },
    window: {
      withProgress: (_o, fn) => fn(),
      showInformationMessage: (m) => calls.info.push(m),
      showWarningMessage: (m) => calls.warn.push(m),
      showOpenDialog: async () => calls.pick
    },
    commands: {
      registerCommand: (id, fn) => { calls.cmds[id] = fn; return { dispose() {} }; },
      executeCommand: async (id, ...args) => { if (id === 'vscode.diff') calls.diff.push(args); }
    }
  };
  return { vscode, calls };
}
const convertUri = async (uri) => convertDocx(fs.readFileSync(uri.fsPath), { ext: path.extname(uri.fsPath) });
const convertBytes = async (bytes, name) => convertDocx(Buffer.from(bytes), { ext: path.extname(name) });

test('Compare with Git HEAD opens the diff editor with HEAD on the left and the file on the right', async () => {
  const { dir, g } = gitRepo('repo3');
  const file = path.join(dir, 'Report.odt');
  fs.copyFileSync(fx('report.odt'), file);
  g('add', '.'); g('commit', '-q', '-m', 'add');
  fs.copyFileSync(fx('sample.docx'), file); // the file changed on disk
  const { vscode, calls } = stubVscode(true);
  const ctx = { subscriptions: [] };
  C.registerCompare({ vscode, context: ctx, convertUri, convertBytes, maxBytes: () => 50e6, activeUri: () => null });
  assert.strictEqual(calls.provider.scheme, 'docx-viewer-diff');
  await calls.cmds['docxViewer.compareWithHead'](Uri.file(file));
  assert.strictEqual(calls.diff.length, 1, JSON.stringify(calls.warn));
  const [left, right, title, opts] = calls.diff[0];
  assert.strictEqual(left.path, '/HEAD/Report.odt.md');
  assert.strictEqual(right.path, '/Working Tree/Report.odt.md');
  assert.strictEqual(title, 'Report.odt (HEAD ↔ Working Tree, as Markdown)');
  assert.deepStrictEqual(opts, { preview: false });
  const text = (u) => calls.provider.p.provideTextDocumentContent(u);
  assert.match(text(left), /^# Q3 2026 Field Report/);
  assert.match(text(left), /\| North \| \$9\.8M/);
  assert.match(text(right), /Q3 2026 Field Report/);
  assert.notStrictEqual(text(left), text(right));
  assert.match(text(new Uri('docx-viewer-diff', '/x.md', '999')), /comparison is closed/);
});

test('Compare with Git HEAD is refused in an untrusted workspace and for non-file URIs', async () => {
  const { vscode, calls } = stubVscode(false);
  C.registerCompare({ vscode, context: { subscriptions: [] }, convertUri, convertBytes, maxBytes: () => 50e6, activeUri: () => null });
  await calls.cmds['docxViewer.compareWithHead'](Uri.file(fx('sample.docx')));
  assert.match(calls.info[0], /trusted workspace/);
  await calls.cmds['docxViewer.compareWithHead'](new Uri('git', '/a.docx'));
  assert.match(calls.info[1], /on this computer only/);
  await calls.cmds['docxViewer.compareWithHead']();
  assert.match(calls.info[2], /Open a Word or OpenDocument file first/);
  assert.strictEqual(calls.diff.length, 0);
});

test('Compare with Another Document: two files selected in the Explorer, or a picked second file', async () => {
  const { vscode, calls } = stubVscode(false); // needs no trust: git is not run
  C.registerCompare({ vscode, context: { subscriptions: [] }, convertUri, convertBytes, maxBytes: () => 50e6, activeUri: () => null });
  const a = Uri.file(fx('sample.docx'));
  const b = Uri.file(fx('report.odt'));
  await calls.cmds['docxViewer.compareWithDocument'](a, [a, b]);
  assert.strictEqual(calls.diff.length, 1);
  assert.strictEqual(calls.diff[0][2], 'sample.docx ↔ report.odt (as Markdown)');
  calls.pick = [Uri.file(fx('sample.dotx'))];
  await calls.cmds['docxViewer.compareWithDocument'](a);
  assert.strictEqual(calls.diff.length, 2);
  assert.strictEqual(calls.diff[1][1].path, '/B/sample.dotx.md');
  calls.pick = [Uri.file(fx('legacy.doc'))];
  await calls.cmds['docxViewer.compareWithDocument'](a);
  assert.strictEqual(calls.diff.length, 2);
  assert.match(calls.warn[0], /could not compare: legacy\.doc did not open/);
  calls.pick = undefined;
  await calls.cmds['docxViewer.compareWithDocument'](a);
  assert.strictEqual(calls.diff.length, 2);
});
