'use strict';
// Redline compare and the tracked-changes export (src/redline): diff engine, moves, table cells, formatting,
// accept/reject round trips, mixed formats, hostile files, the 500-page speed gate, escaping, Pro gating and the
// compare command wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const D = require('../src/redline/diff');
const M = require('../src/redline/model');
const job = require('../src/redline/job');
const XD = require('../src/redline/export-docx');
const { runRedline } = require('../src/redline/run');
const { convertDocx } = require('../src/convert');
const { createPro, TRIAL_USES } = require('../src/pro');
const C = require('../src/compare');
const F = require('./helpers/redline-fixtures');
const { makeDocx, p } = require('./helpers/make-docx');
const { largePair, rng, sentence } = require('./helpers/redline-large');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const LARGE_DIR = path.join(os.homedir(), 'docx-viewer-work', 'redline-test-' + process.pid);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const squash = (s) => s.replace(/￼/g, '').replace(/\s+/g, '');
const pair = (task, a, b, an, bn, opts) => ({ task, a: { bytes: a, name: an || 'old.docx' }, b: { bytes: b, name: bn || 'new.docx' }, opts: Object.assign({ formatting: true, date: '2026-11-09T00:00:00Z' }, opts || {}) });

async function docXml(bytes) {
  const z = await JSZip.loadAsync(bytes);
  return z.file('word/document.xml').async('string');
}

function wellFormed(xml) {
  const errors = [];
  new DOMParser({ errorHandler: { warning() {}, error: (e) => errors.push(e), fatalError: (e) => errors.push(e) } }).parseFromString(xml, 'text/xml');
  return errors;
}

async function viewerText(bytes, mode) {
  const r = await convertDocx(bytes, { ext: '.docx', revisionMode: mode });
  assert.ok(r.ok, JSON.stringify(r.notice));
  return squash(r.text);
}

test.after(() => { fs.rmSync(LARGE_DIR, { recursive: true, force: true }); });

// ---------- diff ----------
test('diff: ops rebuild both sides for 2,000 random sequences', () => {
  const r = rng(7);
  for (let t = 0; t < 2000; t++) {
    const mk = () => Array.from({ length: Math.floor(r() * 40) }, () => 'abcde'[Math.floor(r() * 5)]);
    const a = mk();
    const b = mk();
    const ops = D.diff(a, b);
    const na = [];
    const nb = [];
    for (const o of ops) {
      for (let i = 0; i < o.n; i++) {
        if (o.t !== '+') na.push(a[o.a + i]);
        if (o.t !== '-') nb.push(b[o.b + i]);
        if (o.t === '=') assert.equal(a[o.a + i], b[o.b + i]);
      }
    }
    assert.equal(na.join(''), a.join(''));
    assert.equal(nb.join(''), b.join(''));
  }
});

test('diff: 20,000 unrelated lines on each side finish fast (patience anchors and the Myers budget)', () => {
  const r = rng(3);
  const a = Array.from({ length: 20000 }, () => sentence(r, 6));
  const b = Array.from({ length: 20000 }, () => sentence(r, 6));
  const t = Date.now();
  const ops = D.diff(a, b);
  assert.ok(Date.now() - t < 3000, 'took ' + (Date.now() - t) + ' ms');
  assert.ok(ops.length >= 2);
});

test('words: a replaced word reads as one deletion and one insertion; whitespace between edits joins them', () => {
  const ops = D.words('pay within 30 days', 'pay within 45 days');
  assert.deepEqual(ops.map((o) => o.t), ['=', '-', '+', '=']);
  const two = D.words('a quick brown fox', 'a slow red fox');
  assert.deepEqual(two.map((o) => o.t), ['=', '-', '+', '=']);
});

// ---------- compare view ----------
test('contract pair: insertions, deletions, a moved clause, table cells and a formatting change', async () => {
  const r = await job.run(pair('view', await F.contractV1(), await F.contractV2()));
  assert.ok(r.ok);
  const c = r.payload.counts;
  assert.equal(c.moves, 2); // heading and paragraph of clause 3
  assert.equal(c.cells, 3);
  assert.equal(c.formatting, 1);
  assert.ok(c.insertions >= 5 && c.deletions >= 4, JSON.stringify(c));
  assert.match(r.payload.summary, /insertions?, .* deletions?, 2 moves, 3 table cells, 1 formatting change/);
  const types = new Set(r.payload.changes.map((x) => x.type));
  for (const t of ['ins', 'del', 'move', 'cell', 'fmt']) assert.ok(types.has(t), t);
  const html = r.payload.rows.map((x) => x.i).join('');
  assert.match(html, /<del class="rl-del" data-c="c\d+">(<span class="f-b">)?thirty(<\/span>)?<\/del>/);
  assert.match(html, /<ins class="rl-ins" data-c="c\d+">(<span class="f-b">)?forty-five(<\/span>)?<\/ins>/);
  assert.match(html, /rl-mt[^>]*data-mv="1"/);
  assert.match(html, /<td class="rl-cell"/);
  assert.match(html, /class="rl-fmt"[^>]*title="italic on"/);
  // Side by side: the old side has the deletion, the new side the insertion.
  const mod = r.payload.rows.find((x) => x.k === 'mod');
  assert.match(mod.l, /rl-del/);
  assert.doesNotMatch(mod.l, /rl-ins/);
  assert.match(mod.r, /rl-ins/);
});

test('document text is escaped in the redline HTML', async () => {
  const a = await makeDocx({ body: p('Hello &lt;script&gt;alert(1)&lt;/script&gt; world') + F.SECT });
  const b = await makeDocx({ body: p('Hello &lt;img src=x onerror=alert(1)&gt; world') + F.SECT });
  const r = await job.run(pair('view', a, b));
  const html = r.payload.rows.map((x) => x.i + (x.l || '') + (x.r || '')).join('');
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /script&gt;/);
  assert.match(html, /&lt;/);
  const h = await job.run(pair('html', a, b));
  assert.doesNotMatch(h.html, /<script|<img|https?:\/\//i);
  assert.match(h.html, /Content-Security-Policy" content="default-src 'none'/);
});

// ---------- DOCX export ----------
test('DOCX export: w:ins, w:del, moves, table rows and formatting revisions by "Compare", well-formed, inputs untouched', async () => {
  const a = await F.contractV1();
  const b = await F.contractV2();
  const ha = sha(a);
  const hb = sha(b);
  const r = await job.run(pair('docx', a, b));
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.deepEqual({ accept: r.check.accept, reject: r.check.reject }, { accept: true, reject: true });
  assert.equal(sha(a), ha);
  assert.equal(sha(b), hb);
  const xml = await docXml(r.bytes);
  assert.deepEqual(wellFormed(xml), []);
  for (const tag of ['<w:ins ', '<w:del ', '<w:delText', '<w:moveFrom ', '<w:moveTo ', '<w:moveFromRangeStart', '<w:moveToRangeEnd', '<w:rPrChange']) assert.ok(xml.includes(tag), tag);
  assert.match(xml, /w:author="Compare" w:date="2026-11-09T00:00:00Z"/);
  // Revision ids are unique.
  const ids = [...xml.matchAll(/<w:(?:ins|del|moveFrom|moveTo|rPrChange|pPrChange) w:id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  // Styles and the rest of the package come from the newer document.
  const z = await JSZip.loadAsync(r.bytes);
  const zb = await JSZip.loadAsync(b);
  assert.equal(await z.file('word/styles.xml').async('string'), await zb.file('word/styles.xml').async('string'));
});

test('DOCX export round trip with the viewer\'s own accept/reject transform: Final = newer text, Original = older text', async () => {
  for (const [a, b] of [[await F.contractV1(), await F.contractV2()], [await F.contractV2(), await F.contractV1()]]) {
    const r = await job.run(pair('docx', a, b));
    assert.equal(await viewerText(r.bytes, 'final'), await viewerText(b, 'final'));
    assert.equal(await viewerText(r.bytes, 'original'), await viewerText(a, 'final'));
  }
});

test('existing tracked changes are accepted first, and comments in the newer file survive', async () => {
  const tracked = fx('tracked.docx');
  const v2 = await F.contractV2();
  const view = await job.run(pair('view', tracked, v2));
  assert.ok(view.ok);
  const r = await job.run(pair('docx', v2, tracked));
  assert.ok(r.ok);
  assert.equal(r.check.accept, true);
  assert.equal(r.check.reject, true);
  const xml = await docXml(r.bytes);
  const src = await docXml(tracked);
  if (/commentReference/.test(src)) assert.match(xml, /commentReference/);
});

test('mixed formats: .odt older and .docx newer compare and export; formatting is compared on shared properties only', async () => {
  const odt = fx('report.odt');
  const docx = fx('sample.docx');
  const v = await job.run(pair('view', odt, docx, 'report.odt', 'sample.docx'));
  assert.ok(v.ok);
  const same = await job.run(pair('view', fx('sample.docx'), fx('sample.docx')));
  assert.equal(same.payload.total, 0);
  const d = await job.run(pair('docx', odt, docx, 'report.odt', 'sample.docx'));
  assert.ok(d.ok);
  assert.equal(d.check.accept, true);
  assert.equal(d.check.reject, true);
  const back = await job.run(pair('docx', docx, odt, 'sample.docx', 'report.odt'));
  assert.equal(back.ok, false);
  assert.match(back.notice.title, /needs a Word file as the newer document/);
});

test('.doc text fallback: the changed table row of simple.doc shows as a table cell change', async () => {
  const v = await job.run(pair('view', fx('simple.doc'), fx('simple-v2.doc'), 'simple.doc', 'simple-v2.doc'));
  assert.ok(v.ok);
  assert.ok(v.payload.total >= 1);
  assert.ok(v.payload.banners.length >= 1);
});

test('fields and content controls: changes inside them export, and w:sdt and field codes stay', async () => {
  const body = (client, signer) => '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve"> of the contract.</w:t></w:r></w:p>' +
    '<w:sdt><w:sdtPr><w:tag w:val="client"/></w:sdtPr><w:sdtContent>' + p('Client: ' + client) + '</w:sdtContent></w:sdt>' +
    '<w:p><w:r><w:t xml:space="preserve">Signed for </w:t></w:r><w:sdt><w:sdtPr><w:tag w:val="signer"/></w:sdtPr><w:sdtContent><w:r><w:t>' + signer + '</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> today.</w:t></w:r></w:p>' + F.SECT;
  const a = await makeDocx({ body: body('Northwind Traders Ltd', 'the Supplier') });
  const b = await makeDocx({ body: body('Northwind Traders Limited', 'the Service Provider') });
  const r = await job.run(pair('docx', a, b));
  assert.ok(r.ok);
  assert.equal(r.check.accept, true);
  assert.equal(r.check.reject, true);
  const xml = await docXml(r.bytes);
  assert.equal((xml.match(/<w:sdt>/g) || []).length, 2);
  assert.match(xml, /<w:instrText xml:space="preserve"> PAGE <\/w:instrText>/);
  assert.deepEqual(wellFormed(xml), []);
});

// ---------- hostile files ----------
test('hostile: a zip bomb (document part claims 4 GB) is refused before it is unpacked', async () => {
  const ok = Buffer.from(await makeDocx({ body: p('x') + F.SECT }));
  // Patch the uncompressed size of word/document.xml in the central directory to 0xFFFFFF00.
  const name = Buffer.from('word/document.xml');
  let i = -1;
  for (let at = ok.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at !== -1; at = ok.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) {
    const len = ok.readUInt16LE(at + 28);
    if (ok.slice(at + 46, at + 46 + len).equals(name)) { i = at; break; }
  }
  assert.ok(i > 0);
  ok.writeUInt32LE(0xffffff00, i + 24);
  const r = await job.run(pair('view', await F.contractV1(), ok));
  assert.equal(r.ok, false);
  assert.match(r.notice.title, /unpacks to \d+ MB/);
});

test('hostile: password-protected file, damaged ZIP and non-document give a message, not a hang', async () => {
  const enc = Buffer.alloc(4096);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(enc);
  Buffer.from('EncryptedPackage', 'utf16le').copy(enc, 1024);
  const v1 = await F.contractV1();
  let r = await job.run(pair('view', enc, v1, 'locked.docx'));
  assert.equal(r.ok, false);
  assert.match(r.notice.title, /password protected/);
  assert.equal(r.which, 'a');
  r = await job.run(pair('view', v1, fx('not-a-zip.docx'), 'old.docx', 'not-a-zip.docx'));
  assert.equal(r.ok, false);
  assert.equal(r.which, 'b');
});

test('hostile: tables nested 120 deep compare and export without a stack overflow', async () => {
  let inner = p('Deepest');
  for (let d = 0; d < 120; d++) inner = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>' + inner + p('level ' + d) + '</w:tc></w:tr></w:tbl>';
  const deep = await makeDocx({ body: p('Nested.') + inner + p('After.') + F.SECT });
  const deep2 = await makeDocx({ body: p('Nested, edited.') + inner.replace('level 3<', 'level three<') + p('After.') + F.SECT });
  const r = await runRedline(pair('view', deep, deep2), { timeoutMs: 60000 });
  assert.ok(r.ok, JSON.stringify(r.notice));
  const d = await runRedline(pair('docx', deep, deep2), { timeoutMs: 60000 });
  assert.ok(d.ok, JSON.stringify(d.notice));
});

test('hostile: 10,000 footnotes and two unrelated documents finish in seconds', async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const notes = [];
  const body = [];
  for (let i = 1; i <= 10000; i++) {
    notes.push('<w:footnote w:id="' + i + '"><w:p><w:r><w:t>Note ' + i + '</w:t></w:r></w:p></w:footnote>');
    body.push('<w:p><w:r><w:t xml:space="preserve">Claim ' + i + '</w:t></w:r><w:r><w:footnoteReference w:id="' + i + '"/></w:r></w:p>');
  }
  const fn = await makeDocx({ body: body.join('') + F.SECT, rels: [{ id: 'rIdF', type: 'footnotes', target: 'footnotes.xml' }], extraParts: { 'word/footnotes.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ' + W + '>' + notes.join('') + '</w:footnotes>' } });
  const r1 = rng(11);
  const r2 = rng(12);
  const unrelatedA = await makeDocx({ body: Array.from({ length: 3000 }, () => p(sentence(r1, 20))).join('') + F.SECT });
  const unrelatedB = await makeDocx({ body: Array.from({ length: 3000 }, () => p(sentence(r2, 20))).join('') + F.SECT });
  let t = Date.now();
  const a = await runRedline(pair('view', fn, unrelatedB), { timeoutMs: 60000 });
  assert.ok(a.ok);
  assert.ok(Date.now() - t < 10000, 'footnotes vs unrelated took ' + (Date.now() - t));
  t = Date.now();
  const b = await runRedline(pair('docx', unrelatedA, unrelatedB), { timeoutMs: 60000 });
  assert.ok(b.ok);
  assert.equal(b.check.accept, true);
  assert.equal(b.check.reject, true);
  assert.ok(Date.now() - t < 10000, 'unrelated export took ' + (Date.now() - t));
});

// ---------- large ----------
test('500 pages with 200 tables: compare and DOCX export each under 10 s in the worker; Cancel stops it', async () => {
  fs.mkdirSync(LARGE_DIR, { recursive: true });
  const [x1, x2] = largePair();
  fs.writeFileSync(path.join(LARGE_DIR, 'v1.docx'), await makeDocx({ body: x1 }));
  fs.writeFileSync(path.join(LARGE_DIR, 'v2.docx'), await makeDocx({ body: x2 }));
  const a = fs.readFileSync(path.join(LARGE_DIR, 'v1.docx'));
  const b = fs.readFileSync(path.join(LARGE_DIR, 'v2.docx'));
  const stages = [];
  let t = Date.now();
  const v = await runRedline(pair('view', a, b), { onProgress: (s) => stages.push(s.stage) });
  const tv = Date.now() - t;
  assert.ok(v.ok);
  assert.ok(tv < 10000, 'view ' + tv + ' ms');
  assert.ok(stages.includes('Comparing'));
  assert.equal(v.payload.counts.moves, 3);
  assert.equal(v.payload.blocks.a > 4000, true);
  t = Date.now();
  const d = await runRedline(pair('docx', a, b));
  const td = Date.now() - t;
  assert.ok(d.ok);
  assert.ok(td < 10000, 'docx ' + td + ' ms');
  assert.equal(d.check.accept, true);
  assert.equal(d.check.reject, true);
  // Cancel: a token that fires after the job started.
  let fire;
  const token = { isCancellationRequested: false, onCancellationRequested: (fn) => { fire = fn; return { dispose() {} }; } };
  const pending = runRedline(pair('docx', a, b), { token });
  setTimeout(() => fire(), 30);
  const c = await pending;
  assert.equal(c.cancelled, true);
});

// ---------- model ----------
test('model: accept-all keeps inserted text, drops deleted text and deleted rows', () => {
  const xml = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Keep </w:t></w:r><w:ins w:id="1"><w:r><w:t>added</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>' +
    '<w:tbl><w:tr><w:trPr><w:del w:id="3"/></w:trPr><w:tc><w:p><w:r><w:t>old row</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>row</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
  const m = M.fromDocx(xml, '');
  assert.equal(m.blocks[0].text, 'Keep added');
  assert.equal(m.blocks[1].rows.length, 1);
  assert.equal(m.accepted, 3);
});

test('model: a non-w prefix for the WordprocessingML namespace is understood', () => {
  const xml = '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:pPr><x:pStyle x:val="Heading2"/></x:pPr><x:r><x:rPr><x:b/></x:rPr><x:t>Title</x:t></x:r></x:p></x:body></x:document>';
  const m = M.fromDocx(xml, '');
  assert.equal(m.blocks[0].text, 'Title');
  assert.equal(m.blocks[0].lvl, 2);
  assert.equal(m.blocks[0].segs[0].f.b, 1);
});

test('reject transform: inserted paragraphs and rows go, deleted ones come back', () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    '<w:p><w:pPr><w:rPr><w:ins w:id="1"/></w:rPr></w:pPr><w:ins w:id="2"><w:r><w:t>new para</w:t></w:r></w:ins></w:p>' +
    '<w:p><w:del w:id="3"><w:r><w:delText>old words</w:delText></w:r></w:del></w:p></w:body></w:document>';
  assert.equal(XD.textAfter(xml, 'reject'), 'oldwords');
  assert.equal(XD.textAfter(xml, 'accept'), 'newpara');
});

// ---------- Pro ----------
function stubContext() {
  const store = new Map();
  return { globalState: { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } }, subscriptions: [] };
}

test('Pro: each Pro feature works 3 times free, then explains itself once per click; PRO_ENABLED=false keeps all free', async () => {
  const shown = [];
  const lic = { isPro: () => false, refresh() {}, requirePro: async (f, d) => { shown.push([f, d]); return false; }, onDidChange: () => ({ dispose() {} }), ready: Promise.resolve() };
  const vscode = { window: { setStatusBarMessage() {} } };
  const pro = createPro({ vscode, context: stubContext(), license: lic });
  assert.equal(pro.label('exportRedline'), 'Pro, 3 free tries');
  for (let i = 0; i < TRIAL_USES; i++) { assert.equal(await pro.check('exportRedline'), true); await pro.commit('exportRedline'); }
  assert.equal(pro.label('exportRedline'), 'Pro');
  assert.equal(await pro.check('exportRedline'), false);
  assert.equal(shown.length, 1);
  // Module v2 (EXEC14): the product passes the detail and the tries used; the module writes the price and the rest.
  assert.equal(shown[0][0], 'Redline export');
  assert.equal(shown[0][1].triesUsed, 3);
  assert.match(shown[0][1].detail, /tracked changes/);
  assert.equal(await pro.check('compareFolders'), true); // its own counter
  const licensed = createPro({ vscode, context: stubContext(), license: Object.assign({}, lic, { isPro: () => true }) });
  for (let i = 0; i < 5; i++) { assert.equal(await licensed.check('exportRedline'), true); await licensed.commit('exportRedline'); }
  assert.equal(licensed.left('exportRedline'), 3); // a Pro user never uses tries
  const off = createPro({ vscode, context: stubContext(), license: lic, enabled: false });
  for (let i = 0; i < 5; i++) { assert.equal(await off.check('exportRedline'), true); await off.commit('exportRedline'); }
  assert.equal(off.label('exportRedline'), '');
});

test('Pro: docxViewer.showProFeatures=false hides Pro (shown() false) unless licensed or Pro is off; the setting and when clauses exist', () => {
  const lic = { isPro: () => false, refresh() {}, requirePro: async () => false, onDidChange: () => ({ dispose() {} }), ready: Promise.resolve() };
  const vs = (v) => ({ window: { setStatusBarMessage() {} }, workspace: { getConfiguration: () => ({ get: (k, d) => (k === 'showProFeatures' ? v : d) }) } });
  assert.equal(createPro({ vscode: vs(undefined), context: stubContext(), license: lic }).shown(), true);
  assert.equal(createPro({ vscode: vs(true), context: stubContext(), license: lic }).shown(), true);
  assert.equal(createPro({ vscode: vs(false), context: stubContext(), license: lic }).shown(), false);
  assert.equal(createPro({ vscode: vs(false), context: stubContext(), license: Object.assign({}, lic, { isPro: () => true }) }).shown(), true);
  assert.equal(createPro({ vscode: vs(false), context: stubContext(), license: lic, enabled: false }).shown(), true);
  const pk = require('../package.json');
  assert.equal(pk.contributes.configuration.properties['docxViewer.showProFeatures'].default, true);
  const pal = pk.contributes.menus.commandPalette;
  for (const c of ['exportRedlineDocx', 'exportRedlineHtml', 'compareFolders', 'getPro', 'unlockWithSponsors', 'enterLicenseKey', 'removeLicense']) {
    const e = pal.find((x) => x.command === 'docxViewer.' + c);
    assert.ok(e && /config\.docxViewer\.showProFeatures/.test(e.when), c);
  }
});

// ---------- command wiring ----------
class Uri {
  constructor(scheme, p) { this.scheme = scheme; this.path = p; this.fsPath = p; }
  static file(p) { return new Uri('file', p); }
  static from(o) { const u = new Uri(o.scheme, o.path); u.query = o.query; return u; }
  static joinPath(u, ...parts) { return new Uri(u.scheme, path.join(u.path, ...parts)); }
  toString() { return this.scheme + '://' + this.path; }
}

function wiringStub(setting, mtimes, web) {
  const calls = { cmds: {}, opened: [], diff: [], picks: 0 };
  const vscode = {
    Uri,
    EventEmitter: class { constructor() { this.event = () => {}; } fire() {} dispose() {} },
    ProgressLocation: { Notification: 15 },
    workspace: {
      isTrusted: true,
      registerTextDocumentContentProvider: () => ({ dispose() {} }),
      getConfiguration: () => ({ get: (k, d) => (k === 'compareView' ? setting : d) }),
      fs: { stat: async (u) => ({ mtime: mtimes[path.basename(u.path)] || 0, size: 10 }) }
    },
    window: {
      showInformationMessage: async () => {}, showWarningMessage: async () => {},
      showQuickPick: async (items) => { calls.picks++; return items.find((i) => i.view === 'redline'); },
      withProgress: async (o, fn) => fn({ report() {} }, { isCancellationRequested: false })
    },
    commands: { registerCommand: (id, fn) => { calls.cmds[id] = fn; return { dispose() {} }; }, executeCommand: async (...a) => { calls.diff.push(a); } }
  };
  const redline = { open: async (a, b) => { calls.opened.push([a, b]); } };
  const store = new Map();
  C.registerCompare({ vscode, context: { subscriptions: [], globalState: { get: (k) => store.get(k), update: async (k, v) => store.set(k, v) } }, convertUri: async () => ({ ok: true, markdown: 'x' }), convertBytes: async () => ({ ok: true, markdown: 'y' }), maxBytes: () => 1e6, activeUri: () => null, redline, isWeb: () => !!web });
  return calls;
}

test('compare commands: "ask" offers Redline or Markdown; the redline gets the older file first by modification time', async () => {
  const calls = wiringStub('ask', { 'new.docx': 200, 'old.docx': 100 });
  const a = Uri.file('/w/new.docx');
  const b = Uri.file('/w/old.docx');
  await calls.cmds['docxViewer.compareWithDocument'](a, [a, b]);
  assert.equal(calls.picks, 1);
  assert.equal(calls.opened.length, 1);
  assert.equal(calls.opened[0][0].name, 'old.docx');
  assert.equal(calls.opened[0][1].name, 'new.docx');
  await calls.cmds['docxViewer.compareRedline'](a, [a, b]);
  assert.equal(calls.picks, 1); // the direct command does not ask
  assert.equal(calls.opened.length, 2);
});

test('compare commands: setting "markdown" and VS Code for the Web keep the Markdown diff', async () => {
  for (const [setting, web] of [['markdown', false], ['ask', true]]) {
    const calls = wiringStub(setting, {}, web);
    const a = Uri.file('/w/a.docx');
    const b = Uri.file('/w/b.docx');
    await calls.cmds['docxViewer.compareWithDocument'](a, [a, b]);
    assert.equal(calls.opened.length, 0);
    assert.equal(calls.picks, 0);
    assert.equal(calls.diff.length, 1);
    assert.equal(calls.diff[0][0], 'vscode.diff');
  }
});

test('package.json: redline commands, settings and 0.4.0 phrases are contributed', () => {
  const pkg = require('../package.json');
  const ids = pkg.contributes.commands.map((c) => c.command);
  for (const id of ['docxViewer.compareRedline', 'docxViewer.compareWithHeadRedline', 'docxViewer.exportRedlineDocx', 'docxViewer.exportRedlineHtml', 'docxViewer.compareFolders', 'docxViewer.unlockWithSponsors', 'docxViewer.getPro', 'docxViewer.enterLicenseKey', 'docxViewer.removeLicense']) assert.ok(ids.includes(id), id);
  const props = pkg.contributes.configuration.properties;
  assert.equal(props['docxViewer.compareView'].default, 'ask');
  assert.equal(props['docxViewer.redlineFormatting'].default, true);
  for (const k of ['compare word documents', 'docx compare', 'docx diff', 'word compare', 'redline', 'track changes', 'document compare']) assert.ok(pkg.keywords.includes(k), k);
  assert.ok(pkg.keywords.length <= 30);
  assert.match(pkg.description, /Compare Word documents/);
  assert.equal(pkg.engines.vscode, '^1.90.0');
});

test('Redline against Git HEAD: the committed bytes go in as the older version, the file on disk as the newer one', async () => {
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docxv-redline-git-'));
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, stdio: 'pipe' });
    g('init', '-q');
    const file = path.join(dir, 'Contract.docx');
    fs.writeFileSync(file, await F.contractV1());
    g('add', '.');
    g('commit', '-q', '-m', 'v1');
    fs.writeFileSync(file, await F.contractV2());
    const calls = wiringStub('ask', {});
    await calls.cmds['docxViewer.compareWithHeadRedline'](Uri.file(file));
    assert.equal(calls.opened.length, 1);
    const [older, newer] = calls.opened[0];
    assert.equal(older.label, 'HEAD');
    assert.equal(sha(Buffer.from(older.bytes)), sha(await F.contractV1()));
    assert.equal(newer.uri.path, file);
    assert.equal(newer.label, 'Working Tree');
    const r = await job.run(pair('view', older.bytes, fs.readFileSync(file), 'Contract.docx', 'Contract.docx'));
    assert.equal(r.payload.counts.moves, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Folder compare: pairs files by relative path, writes one HTML redline per changed pair and an index, lists unmatched files', async () => {
  const { registerFolders, pairsOf } = require('../src/redline/folders');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docxv-folders-'));
  try {
    const older = path.join(root, 'v1');
    const newer = path.join(root, 'v2');
    const out = path.join(root, 'out');
    for (const d of [older, newer, out, path.join(older, 'sub'), path.join(newer, 'sub')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(older, 'Contract.docx'), await F.contractV1());
    fs.writeFileSync(path.join(newer, 'Contract.docx'), await F.contractV2());
    fs.writeFileSync(path.join(older, 'sub', 'Same.docx'), await F.contractV1());
    fs.writeFileSync(path.join(newer, 'sub', 'Same.docx'), await F.contractV1());
    fs.writeFileSync(path.join(older, 'Gone.docx'), await F.contractV1());
    fs.writeFileSync(path.join(newer, 'New.odt'), fx('report.odt'));
    fs.writeFileSync(path.join(newer, '~$Contract.docx'), 'lock file');
    const FileType = { File: 1, Directory: 2 };
    const picks = [[Uri.file(older)], [Uri.file(newer)], [Uri.file(out)]];
    const cmds = {};
    const infos = [];
    const vscode = {
      Uri, FileType, ProgressLocation: { Notification: 15 },
      workspace: {
        getConfiguration: () => ({ get: (k, d) => d }),
        fs: {
          readDirectory: async (u) => fs.readdirSync(u.path, { withFileTypes: true }).map((e) => [e.name, e.isDirectory() ? 2 : 1]),
          stat: async (u) => ({ size: fs.statSync(u.path).size }),
          readFile: async (u) => fs.readFileSync(u.path),
          writeFile: async (u, data) => fs.writeFileSync(u.path, data)
        }
      },
      window: {
        showOpenDialog: async () => picks.shift(),
        showInformationMessage: async (m) => { infos.push(m); return undefined; },
        showWarningMessage: async () => {},
        withProgress: async (o, fn) => fn({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) })
      },
      commands: { registerCommand: (id, fn) => { cmds[id] = fn; return { dispose() {} }; }, executeCommand: async () => {} },
      env: { openExternal: async () => {} }
    };
    const commits = [];
    const pro = { check: async () => true, commit: async (f) => { commits.push(f); } };
    registerFolders({ vscode, context: { subscriptions: [] }, redline: { open: async () => {} }, pro, isWeb: () => false });
    const r = await cmds['docxViewer.compareFolders']();
    assert.equal(r.results.length, 2);
    const changed = r.results.find((x) => x.rel === 'Contract.docx');
    assert.match(changed.status, /2 moves, 3 table cells/);
    assert.equal(r.results.find((x) => x.rel === 'sub/Same.docx').status, 'no differences in the text');
    assert.deepEqual(r.onlyOld, ['Gone.docx']);
    assert.deepEqual(r.onlyNew, ['New.odt']);
    const html = fs.readFileSync(path.join(out, 'Contract redline.html'), 'utf8');
    assert.match(html, /<ins class="rl-ins"/);
    const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.match(index, /href="Contract%20redline.html"/);
    assert.match(index, /Only in the older folder \(1\)/);
    assert.match(infos[0], /2 pairs compared: 1 changed/);
    assert.deepEqual(commits, ['compareFolders']); // one try, after index.html was written
    // Pro refused: nothing runs.
    const cmds2 = {};
    registerFolders({ vscode: Object.assign({}, vscode, { commands: { registerCommand: (id, fn) => { cmds2[id] = fn; return { dispose() {} }; } } }), context: { subscriptions: [] }, redline: null, pro: { check: async () => false, commit: async () => { throw new Error('no commit when refused'); } }, isWeb: () => false });
    assert.equal(await cmds2['docxViewer.compareFolders'](), undefined);
    assert.ok(pairsOf(new Map(), new Map()).pairs.length === 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Pro (CONV2): the real license facade explains with the buy buttons first, the how-to-buy line and the PayPal form for DOCX Viewer', async () => {
  const modal = []; const opened = [];
  const vscode = {
    Uri: { parse: (s) => ({ toString: () => s, s }) },
    env: { openExternal: async (u) => { opened.push(u.s); return true; } },
    window: {
      setStatusBarMessage() {},
      showInformationMessage: async (msg, o, ...b) => { if (o && o.modal) { modal.push({ msg, detail: o.detail, b }); return msg.startsWith('Pay for') ? 'Send the transaction ID' : 'Pay with PayPal'; } return undefined; },
      showWarningMessage: async () => undefined,
      showInputBox: async () => undefined,
      showQuickPick: async () => undefined,
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
  };
  const ctx = stubContext();
  ctx.secrets = { get: async () => undefined, store: async () => {}, delete: async () => {}, onDidChange: () => ({ dispose() {} }) };
  const pro = createPro({ vscode, context: ctx });
  await pro.ready;
  for (let i = 0; i < TRIAL_USES; i++) await pro.commit('exportRedline');
  assert.equal(await pro.check('exportRedline'), false);
  // Module v2 (EXEC14, CONV3 fix 4): 4 buttons, Get Zovo Pro first; the panel names the other DOCX Pro tool and the
  // count of Zovo extensions; the refund line stays hidden while funding.json refund_days is empty.
  assert.deepEqual(modal[0].b, ['Get Zovo Pro, USD 19', 'Pay with PayPal', 'I already paid']);
  assert.match(modal[0].msg, /^Redline export is part of Zovo Pro\./);
  assert.match(modal[0].detail, /You used the 3 free tries on this computer\./);
  assert.match(modal[0].detail, /USD 19 once, for life\. It turns on Folder compare here, and the Pro tools of all 22 Zovo extensions/);
  assert.match(modal[0].detail, /Everything that is free today stays free\./);
  assert.doesNotMatch(modal[0].detail, /refund/i);
  assert.equal(modal[1].msg, 'Pay for Zovo Pro with PayPal');
  assert.deepEqual(opened, ['https://github.com/theluckystrike/zovo-plugin-factory/issues/new?template=zovo-pro-key.yml&title=Zovo%20Pro%20key%3A%20PayPal%20payment%20for%20DOCX%20Viewer&product=DOCX%20Viewer']);
  const pk = require('../package.json');
  assert.ok(pk.contributes.commands.find((c) => c.command === 'docxViewer.payWithPayPal'));
  assert.ok(pk.contributes.menus.commandPalette.find((c) => c.command === 'docxViewer.payWithPayPal' && /showProFeatures/.test(c.when)));
});
