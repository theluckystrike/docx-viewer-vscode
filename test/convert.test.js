'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { convertDocx } = require('../src/convert');
const { detectFormat, noticeFor } = require('../src/detect');
const { convertInWorker } = require('../src/run-worker');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));

test('detectFormat recognizes zip, old .doc, rtf, empty and junk', () => {
  assert.strictEqual(detectFormat(fx('sample.docx')), 'zip');
  assert.strictEqual(detectFormat(fx('legacy.doc')), 'ole');
  assert.strictEqual(detectFormat(Buffer.from('{\\rtf1 hi}')), 'rtf');
  assert.strictEqual(detectFormat(Buffer.alloc(0)), 'empty');
  assert.strictEqual(detectFormat(fx('not-a-zip.docx')), 'unknown');
});

test('old .doc gets a clear message, an OLE file named .docx is called out as encrypted', () => {
  assert.strictEqual(noticeFor('ole', '.doc').kind, 'legacyDoc');
  assert.match(noticeFor('ole', '.doc').title, /old Word file/);
  assert.strictEqual(noticeFor('ole', '.docx').kind, 'encrypted');
  assert.strictEqual(noticeFor('zip', '.docx'), null);
});

test('sample.docx converts with outline, table, image, footnote and link', async () => {
  const r = await convertDocx(fx('sample.docx'), { ext: '.docx' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.outline.map((o) => o.text), ['Q3 2026 Field Report', 'Summary', 'Revenue by region', 'Installations', 'Highlights', 'Risks', 'Next steps']);
  assert.strictEqual(r.stats.tables, 1);
  assert.strictEqual(r.stats.images, 1);
  assert.strictEqual(r.stats.footnotes, 1);
  const html = r.chunks.join('');
  // Pictures travel as bytes next to the HTML (blob: URLs in the webview), not as base64.
  assert.match(html, /<img data-dv-img="0" alt="">/);
  assert.doesNotMatch(html, /base64/);
  assert.strictEqual(r.images.length, 1);
  assert.strictEqual(r.images[0].type, 'image/png');
  assert.ok(r.images[0].data instanceof Uint8Array && r.images[0].data.length > 100);
  assert.deepStrictEqual([...r.images[0].data.slice(1, 4)], [0x50, 0x4e, 0x47]); // PNG
  assert.match(html, /<a href="https:\/\/example\.com\/q3-report">/);
  assert.match(html, /<td><p>\$13\.1M<\/p><\/td>/);
  assert.match(r.markdown, /\| North \| \$9\.8M \| \$13\.1M \| \+34% \|/);
  assert.match(r.markdown, /\[\^1\]: Ticket counts come from the service desk export/);
  assert.match(r.text, /^Q3 2026 Field Report\n\nNorthwind Solar installed 18\.2 MW/);
  assert.ok(r.stats.words > 150);
});

test('.dotx templates render the same as .docx', async () => {
  const a = await convertDocx(fx('sample.docx'));
  const b = await convertDocx(fx('sample.dotx'));
  assert.ok(b.ok);
  assert.deepStrictEqual(b.chunks, a.chunks);
});

test('image size cap replaces big images with a placeholder', async () => {
  const r = await convertDocx(fx('sample.docx'), { maxImageBytes: 1000 });
  assert.ok(r.ok);
  assert.strictEqual(r.stats.images, 0);
  assert.strictEqual(r.stats.skippedImages, 1);
  assert.match(r.chunks.join(''), /not shown: 12 KB is over the 1000 B image limit/);
});

test('total image budget is enforced', async () => {
  const r = await convertDocx(fx('sample.docx'), { maxTotalImageBytes: 100 });
  assert.match(r.chunks.join(''), /total image limit/);
});

test('zip without a Word part gives a notice, not a crash', async () => {
  // Minimal valid empty zip: end-of-central-directory record only would not start with PK\x03\x04,
  // so build a one-file zip by hand.
  const name = Buffer.from('hello.txt');
  const data = Buffer.from('hi');
  const crc = zlib.crc32 ? zlib.crc32(data) : 0xd8932aac;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(2, 18); local.writeUInt32LE(2, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(2, 20); central.writeUInt32LE(2, 24); central.writeUInt16LE(name.length, 28);
  const localLen = local.length + name.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(localLen, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  const r = await convertDocx(zip, { ext: '.docx' });
  assert.strictEqual(r.ok, false);
  assert.ok(['notDocx', 'error'].includes(r.notice.kind), JSON.stringify(r.notice));
});

test('worker thread returns the same result as in-process conversion', async () => {
  const bytes = fx('sample.docx');
  const viaWorker = await convertInWorker(bytes, { ext: '.docx' }, { timeoutMs: 30000 });
  const direct = await convertDocx(bytes, { ext: '.docx' });
  assert.ok(viaWorker.ok);
  assert.deepStrictEqual(viaWorker.chunks, direct.chunks);
  assert.strictEqual(viaWorker.markdown, direct.markdown);
});

test('worker time limit stops a slow conversion with a clear notice', async () => {
  const r = await convertInWorker(fx('sample.docx'), {}, { timeoutMs: 1 });
  assert.strictEqual(r.ok, false);
  assert.match(r.notice.title, /took too long/);
});

test('large generated document converts and chunks', async () => {
  // Build a ~2,000-paragraph docx by repeating the body of sample.docx through JSZip.
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fx('sample.docx'));
  const xml = await zip.file('word/document.xml').async('string');
  const body = xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('<w:sectPr'));
  const big = xml.replace(body, body.repeat(80));
  zip.file('word/document.xml', big);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  const t0 = Date.now();
  const r = await convertDocx(buf, { maxChunkChars: 50000 });
  assert.ok(r.ok);
  assert.ok(r.chunks.length >= 3, 'chunks: ' + r.chunks.length);
  assert.strictEqual(r.images.length, 80);
  assert.strictEqual(r.outline.length, 7 * 80);
  assert.ok(Date.now() - t0 < 20000);
});

test('bundled out/worker.js (after npm run build) gives the same result', { skip: !fs.existsSync(path.join(__dirname, '..', 'out', 'worker.js')) }, async () => {
  const bytes = fx('sample.docx');
  const r = await convertInWorker(bytes, { ext: '.docx' }, { workerFile: path.join(__dirname, '..', 'out', 'worker.js') });
  const direct = await convertDocx(bytes, { ext: '.docx' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.chunks, direct.chunks);
});
