'use strict';
// OpenDocument text (.odt) support: a pandoc-written file, a hand-built file with LibreOffice-style
// automatic styles, merged cells, spaces, notes and hostile content, and the non-text ODF notices.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { convertDocx } = require('../src/convert');
const { noticeFor } = require('../src/detect');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const NSDECL = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"';

async function odt(bodyXml, { mime = 'application/vnd.oasis.opendocument.text', autoStyles = '', files = {} } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', mime, { compression: 'STORE' });
  zip.file('content.xml', '<?xml version="1.0" encoding="UTF-8"?><office:document-content ' + NSDECL + '><office:automatic-styles>' + autoStyles + '</office:automatic-styles><office:body><office:text>' + bodyXml + '</office:text></office:body></office:document-content>');
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('pandoc .odt: outline, table, image, footnote, lists, quote and link', async () => {
  const r = await convertDocx(fx('report.odt'), { ext: '.odt' });
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.strictEqual(r.format, 'odt');
  assert.deepStrictEqual(r.outline.map((o) => o.text), ['Q3 2026 Field Report', 'Summary', 'Revenue by region', 'Installations', 'Highlights', 'Risks']);
  assert.deepStrictEqual(r.outline.map((o) => o.level), [1, 1, 1, 1, 2, 2]);
  assert.strictEqual(r.stats.tables, 1);
  assert.strictEqual(r.stats.images, 1);
  assert.strictEqual(r.stats.footnotes, 1);
  const html = r.chunks.join('');
  assert.match(html, /<strong>18\.2 MW<\/strong>/);
  assert.match(html, /<s>Margins fell\.<\/s>/);
  assert.match(html, /<a href="https:\/\/example\.com\/q3-report">the report page<\/a>/);
  assert.match(html, /<img src="data:image\/png;base64,[A-Za-z0-9+/=]+" alt="">/);
  assert.match(html, /<p class="dv-caption"><em>Installed capacity by month<\/em><\/p>/);
  assert.match(html, /<ol><li><p>Two school districts/);
  assert.match(html, /<ul><li><p>Panels shipped in August/);
  assert.match(html, /<blockquote><p>Customers asked/);
  assert.match(r.markdown, /\| North \| \$9\.8M \| \$13\.1M \| \+34% \|/);
  assert.match(r.markdown, /\[\^1\]: Ticket counts come from the service desk export/);
  assert.match(r.text, /Revenue grew in every region/);
});

test('a .docx still converts with mammoth and is marked as docx', async () => {
  const r = await convertDocx(fx('sample.docx'), { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.format, 'docx');
});

test('automatic styles give bold, italic, underline and superscript; Title style gives the title', async () => {
  const styles = '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="T2" style:family="text"><style:text-properties fo:font-style="italic" style:text-underline-style="solid"/></style:style>' +
    '<style:style style:name="T3" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>' +
    '<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Title"/>';
  const buf = await odt('<text:p text:style-name="P1">Plan</text:p><text:p>a <text:span text:style-name="T1">bold</text:span> and <text:span text:style-name="T2">mixed</text:span> x<text:span text:style-name="T3">2</text:span></text:p>', { autoStyles: styles });
  const r = await convertDocx(buf, { ext: '.odt' });
  assert.ok(r.ok);
  const html = r.chunks.join('');
  assert.match(html, /<h1 class="dv-title" id="h-1">Plan<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em><u>mixed<\/u><\/em>/);
  assert.match(html, /x<sup>2<\/sup>/);
});

test('merged cells, repeated spaces, tabs, line breaks, endnotes and numbered lists', async () => {
  const styles = '<text:list-style style:name="L1"><text:list-level-style-number text:level="1" style:num-format="1"/><text:list-level-style-bullet text:level="2" text:bullet-char="•"/></text:list-style>';
  const body = '<table:table><table:table-column table:number-columns-repeated="2"/>' +
    '<table:table-header-rows><table:table-row><table:table-cell table:number-columns-spanned="2"><text:p>Both</text:p></table:table-cell><table:covered-table-cell/></table:table-row></table:table-header-rows>' +
    '<table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell><text:p>b</text:p></table:table-cell></table:table-row></table:table>' +
    '<text:p>one<text:s text:c="3"/>two<text:tab/>three<text:line-break/>four<text:note text:note-class="endnote"><text:note-citation>i</text:note-citation><text:note-body><text:p>The end note.</text:p></text:note-body></text:note></text:p>' +
    '<text:list text:style-name="L1"><text:list-item><text:p>first</text:p><text:list><text:list-item><text:p>inner</text:p></text:list-item></text:list></text:list-item></text:list>';
  const r = await convertDocx(await odt(body, { autoStyles: styles }), { ext: '.odt' });
  assert.ok(r.ok);
  const html = r.chunks.join('');
  assert.match(html, /<td colspan="2"><p>Both<\/p><\/td><\/tr><tr><td><p>a<\/p><\/td><td><p>b<\/p><\/td>/);
  assert.match(html, /one {3}two\tthree<br>four<sup><a id="d-endnote-ref-1" href="#d-endnote-1">\[1\]<\/a><\/sup>/);
  assert.match(html, /<ol><li><p>first<\/p><ul><li><p>inner<\/p><\/li><\/ul><\/li><\/ol>/);
  assert.strictEqual(r.stats.footnotes, 1);
  assert.match(r.markdown, /\[\^e1\]: The end note\./);
});

test('hostile .odt: script text stays text, javascript and file links and remote images are dropped, comments left out', async () => {
  const body = '<text:p>&lt;script&gt;alert(1)&lt;/script&gt; <text:a xlink:href="javascript:alert(1)">bad</text:a> <text:a xlink:href="file:///etc/passwd">file</text:a>' +
    '<office:annotation><text:p>secret reviewer comment</text:p></office:annotation></text:p>' +
    '<text:p><draw:frame><draw:image xlink:href="https://evil.example/x.png"/></draw:frame></text:p>' +
    '<text:p><draw:frame><draw:image xlink:href="Pictures/x.svg"/></draw:frame></text:p>';
  const r = await convertDocx(await odt(body, { files: { 'Pictures/x.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' } }), { ext: '.odt' });
  assert.ok(r.ok);
  const html = r.chunks.join('');
  assert.ok(!/<script/i.test(html));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!/javascript:|file:\/\/|evil\.example/.test(html));
  assert.ok(!/secret reviewer comment/.test(html));
  assert.match(html, /\[Image not shown: linked images are not shown\]/);
  assert.match(html, /\[Image not shown: SVG images are not supported\]/);
  assert.strictEqual(r.stats.skippedImages, 2);
});

test('image limits apply to .odt pictures', async () => {
  const png = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'chart.png'));
  const body = '<text:p><draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p>';
  const r = await convertDocx(await odt(body, { files: { 'Pictures/a.png': png } }), { ext: '.odt', maxImageBytes: 100 });
  assert.ok(r.ok);
  assert.match(r.chunks.join(''), /is over the 100 B image limit/);
});

test('spreadsheets and presentations get a clear notice; missing content.xml is called out', async () => {
  const ods = await odt('', { mime: 'application/vnd.oasis.opendocument.spreadsheet' });
  const r1 = await convertDocx(ods, { ext: '.odt' });
  assert.strictEqual(r1.ok, false);
  assert.match(r1.notice.title, /OpenDocument spreadsheet, presentation or drawing/);
  const zip = new JSZip();
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' });
  const r2 = await convertDocx(await zip.generateAsync({ type: 'nodebuffer' }), { ext: '.odt' });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.notice.title, /not a readable OpenDocument text/);
  assert.match(noticeFor('unknown', '.odt').title, /not an OpenDocument text file/);
});

test('an .odt renamed to .docx still opens (detected by its mimetype entry)', async () => {
  const r = await convertDocx(fx('report.odt'), { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.format, 'odt');
});

test('deep nesting does not overflow the stack', async () => {
  let body = '<text:p>deep</text:p>';
  for (let i = 0; i < 3000; i++) body = '<text:section>' + body + '</text:section>';
  const r = await convertDocx(await odt(body), { ext: '.odt' });
  assert.ok(r.ok);
});
