'use strict';
// Legacy Word 97-2003 (.doc) as text: tables, Unicode, side parts, notices for broken,
// encrypted and mislabeled files, Markdown, Git compare, bundle contents and speed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { convertDocx } = require('../src/convert');
const { detectFormat, noticeFor, canConvert } = require('../src/detect');
const { convertInWorker } = require('../src/run-worker');
const D = require('../src/doc');
const S = require('../media/search');
const C = require('../src/compare');

const fxPath = (f) => path.join(__dirname, 'fixtures', f);
const fx = (f) => fs.readFileSync(fxPath(f));
const textOf = (html) => html.replace(/<[^>]+>/g, ' ');

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docxv-doc-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test('simple.doc: paragraphs, a 2x2 table, Unicode and the text-only banner', async () => {
  const r = await convertDocx(fx('simple.doc'), { ext: '.doc' });
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.strictEqual(r.format, 'doc');
  const html = r.chunks.join('');
  assert.match(html, /<p>Spec<\/p>/);
  const table = html.match(/<table>[\s\S]*?<\/table>/)[0];
  assert.strictEqual((table.match(/<tr>/g) || []).length, 2);
  assert.strictEqual((table.match(/<td>/g) || []).length, 4);
  assert.match(table, /<td>Name<\/td><td>Value<\/td>/);
  assert.match(html, /Ünïcödé 中文/);
  assert.strictEqual(r.banner, 'Old Word 97-2003 file. Text only: formatting, images and layout are not shown.');
  assert.strictEqual(r.stats.tables, 1);
  assert.deepStrictEqual(r.outline, [], 'no style names in a .doc, so no headings from the body');
});

test('Copy as Markdown on simple.doc gives a Markdown table; plain text keeps the cells', async () => {
  const r = await convertDocx(fx('simple.doc'), { ext: '.doc' });
  assert.match(r.markdown, /\| Name \| Value \|\n\| --- \| --- \|\n\| alpha \| 1 \|/);
  assert.match(r.text, /alpha\t1/);
  assert.ok(!/Old Word 97-2003/.test(r.markdown), 'the banner is not part of the document text');
});

test('search finds "alpha" in the sentence and once in the table', async () => {
  const r = await convertDocx(fx('simple.doc'), { ext: '.doc' });
  const visible = textOf(r.chunks.join(''));
  assert.strictEqual(S.findMatches(visible, 'alpha').length, 2, 'once in the sentence, once in the table');
  assert.strictEqual(S.findMatches(textOf(r.chunks.join('').match(/<table>[\s\S]*?<\/table>/)[0]), 'alpha').length, 1);
});

test('.dot (template) opens the same way', async () => {
  const r = await convertDocx(fx('simple.doc'), { ext: '.dot' });
  assert.ok(r.ok);
  assert.ok(canConvert('ole', '.dot') && canConvert('ole', '.doc') && !canConvert('ole', '.docx'));
});

test('side parts become sections with their names in the outline', () => {
  const fake = {
    getBody: () => 'Body line\n',
    getHeaders: () => 'ACME Confidential\nPage 1\n',
    getFootnotes: () => 'A footnote\n',
    getEndnotes: () => '',
    getAnnotations: () => 'Check this number\n',
    getTextboxes: () => '\n'
  };
  const { html, sections } = D.docToHtml(fake);
  assert.deepStrictEqual(sections, ['Headers and footers', 'Footnotes', 'Comments']);
  assert.match(html, /<h2>Headers and footers<\/h2>\n<p>ACME Confidential<\/p>/);
});

test('textToHtml escapes text and pads short table rows', () => {
  const html = D.textToHtml('<img src=x onerror=alert(1)>\na\tb\tc\t\nd\t\n');
  assert.ok(!/<img/.test(html));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<tr><td>d<\/td><td><\/td><td><\/td><\/tr>/);
});

test('broken legacy.doc gives the "could not read" notice, not an empty page', async () => {
  const r = await convertDocx(fx('legacy.doc'), { ext: '.doc' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.notice.kind, 'error');
  assert.match(r.notice.title, /could not read this \.doc file/);
  assert.match(r.notice.detail, /Invalid Short Sector Allocation Table/);
});

test('password-protected .doc gives the password notice', async () => {
  const r = await convertDocx(fx('encrypted.doc'), { ext: '.doc' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.notice.kind, 'encrypted');
  assert.match(r.notice.title, /password protected/);
});

test('RTF named .doc opens as text, HTML named .doc gets its own notice; a renamed .docx opens as .docx', async () => {
  assert.strictEqual(detectFormat(fx('rtf-as.doc')), 'rtf');
  assert.strictEqual(detectFormat(fx('html-as.doc')), 'html');
  const rtf = await convertDocx(fx('rtf-as.doc'), { ext: '.doc' });
  assert.strictEqual(rtf.ok, true);
  assert.strictEqual(rtf.format, 'rtf');
  assert.match(rtf.banner, /Rich Text Format/);
  assert.deepStrictEqual(rtf.bannerActions, ['openInDefaultApp']);
  const html = await convertDocx(fx('html-as.doc'), { ext: '.doc' });
  assert.strictEqual(html.notice.title, 'This .doc file is really an HTML file');
  assert.strictEqual(noticeFor('html', '.docx').title, 'This is not a Word .docx file');
  assert.strictEqual(detectFormat(Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/related')), 'html');
  const docx = await convertDocx(fx('docx-as.doc'), { ext: '.doc' });
  assert.ok(docx.ok);
  assert.strictEqual(docx.format, 'docx');
  assert.strictEqual(docx.outline[0].text, 'Q3 2026 Field Report');
});

test('the worker converts .doc too', async () => {
  const r = await convertInWorker(fx('simple.doc'), { ext: '.doc' }, { workerFile: path.join(__dirname, '..', 'src', 'worker.js') });
  assert.ok(r.ok);
  assert.ok(r.banner);
});

test('Compare with Git HEAD on a .doc shows the changed table row', async () => {
  const dir = path.join(tmp, 'repo');
  fs.mkdirSync(dir);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: dir, stdio: 'pipe' });
  g('init', '-q');
  const file = path.join(dir, 'Spec.doc');
  fs.copyFileSync(fxPath('simple.doc'), file);
  g('add', '.'); g('commit', '-q', '-m', 'add');
  fs.copyFileSync(fxPath('simple-v2.doc'), file);
  assert.ok(C.isDocument(file));
  const head = await C.readFromHead(file, 50 * 1024 * 1024);
  assert.ok(head.ok, head.message);
  const left = await convertDocx(head.bytes, { ext: '.doc' });
  const right = await convertDocx(fs.readFileSync(file), { ext: '.doc' });
  assert.match(left.markdown, /\| alpha \| 1 \|/);
  assert.match(right.markdown, /\| alpha \| 2 \|/);
  const changed = left.markdown.split('\n').filter((l, i) => l !== right.markdown.split('\n')[i]);
  assert.deepStrictEqual(changed, ['| alpha | 1 |']);
});

test('package.json opens .doc and .dot by default and offers the Explorer commands for them', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const sel = pj.contributes.customEditors[0].selector.map((s) => s.filenamePattern);
  assert.ok(sel.includes('*.doc') && sel.includes('*.dot'));
  assert.strictEqual(pj.contributes.customEditors[0].priority, 'default');
  for (const m of pj.contributes.menus['explorer/context']) assert.match(m.when, /\|doc\|dot\)\$/);
});

test('bundle: the worker build has word-extractor but no saxes or yauzl, and all licenses are allowed', async () => {
  const esbuild = require('esbuild');
  const { checkMetafile, licenseAllowed } = require('../scripts/licenses');
  const r = await esbuild.build({ entryPoints: [path.join(__dirname, '..', 'src', 'worker.js')], bundle: true, platform: 'node', write: false, metafile: true, logLevel: 'silent' });
  const c = checkMetafile(r.metafile, path.join(__dirname, '..'));
  assert.deepStrictEqual(c.problems, []);
  assert.ok('word-extractor' in c.packages);
  assert.ok(!('saxes' in c.packages) && !('yauzl' in c.packages));
  assert.ok(licenseAllowed('(MIT OR GPL-3.0-or-later)') && licenseAllowed('(MIT AND Zlib)'));
  assert.ok(!licenseAllowed('AGPL-3.0') && !licenseAllowed('GPL-3.0') && !licenseAllowed('(MIT AND GPL-2.0)'));
  const bad = checkMetafile({ inputs: { 'node_modules/saxes/saxes.js': {} } }, path.join(__dirname, '..'));
  assert.strictEqual(bad.problems.length, 1);
});

// macOS textutil writes a broken allocation table above about 2.4 MB (the last sectors are left out),
// so the speed fixture stays just under that. Such broken files get the "could not read" notice.
test('a .doc with about 2.4 MB of text opens in under 3 s', { skip: process.platform !== 'darwin' && 'needs macOS textutil' }, async () => {
  const src = path.join(tmp, 'big.html');
  const line = '<p>Line NUM of a long legacy document with enough words to fill the page nicely.</p>\n';
  const parts = ['<html><head><meta charset="utf-8"></head><body>'];
  for (let i = 0; i < 15000; i++) parts.push(line.replace('NUM', String(i)));
  parts.push('</body></html>');
  fs.writeFileSync(src, parts.join(''));
  const out = path.join(tmp, 'big.doc');
  execFileSync('textutil', ['-convert', 'doc', src, '-output', out]);
  fs.rmSync(src);
  const bytes = fs.readFileSync(out);
  assert.ok(bytes.length > 2e6 && bytes.length < 50e6, 'size ' + bytes.length);
  const t0 = Date.now();
  const r = await convertInWorker(bytes, { ext: '.doc' }, { workerFile: path.join(__dirname, '..', 'src', 'worker.js') });
  const ms = Date.now() - t0;
  console.log('# big .doc: ' + (bytes.length / 1e6).toFixed(1) + ' MB in ' + ms + ' ms');
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.match(r.text, /Line 14999 of a long legacy document/);
  assert.ok(ms < 3000, ms + ' ms');
  fs.rmSync(out);
});
