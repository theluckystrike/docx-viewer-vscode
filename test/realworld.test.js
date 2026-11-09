'use strict';
// 0.3.0: fixes found on real-world files (public bug-report corpora and government reports).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { makeDocx, p } = require('./helpers/make-docx');
const { convertDocx } = require('../src/convert');
const { convertInWorker } = require('../src/run-worker');
const { ommlToMathml } = require('../src/omml');
const { renderChart, parseChart } = require('../src/chart');
const { rtfToText, tabBlocksToRows } = require('../src/rtf');
const { oleKind, noticeFor, canConvert, detectFormat } = require('../src/detect');
const H = require('../src/html');
const P = require('../media/protocol');
const { buildWebviewHtml, buildPageHtml, fontAttr } = require('../src/webview-html');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const M_NS = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"';

// ---------- equations ----------

const QUADRATIC = '<m:oMathPara><m:oMath><m:r><m:t>x=</m:t></m:r><m:f><m:num><m:r><m:t>-b±</m:t></m:r><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t>-4ac</m:t></m:r></m:e></m:rad></m:num><m:den><m:r><m:t>2a</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara>';

test('OMML to MathML: fraction, root, superscript, with a linear form', () => {
  const r = ommlToMathml(QUADRATIC);
  assert.ok(r);
  assert.strictEqual(r.display, true);
  assert.match(r.mathml, /^<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML" class="dv-math" display="block"/);
  assert.match(r.mathml, /<mfrac>/);
  assert.match(r.mathml, /<msqrt>/);
  assert.match(r.mathml, /<msup><mrow><mi>b<\/mi><\/mrow><mrow><mn>2<\/mn><\/mrow><\/msup>/);
  assert.strictEqual(r.linear, 'x=(-b±√(b^2-4ac))/(2a)');
});

test('OMML linear form: a fraction next to a letter gets brackets', () => {
  const r = ommlToMathml('<m:oMath><m:r><m:t>f</m:t></m:r><m:f><m:num><m:r><m:t>L</m:t></m:r></m:num><m:den><m:r><m:t>D</m:t></m:r></m:den></m:f><m:f><m:num><m:r><m:t>v</m:t></m:r></m:num><m:den><m:r><m:t>2g</m:t></m:r></m:den></m:f></m:oMath>');
  assert.strictEqual(r.linear, 'f(L/D)(v/(2g))');
});

test('pump-test.docx sample: 4 equations, 2 charts, figure numbers, no notes', async () => {
  const r = await convertDocx(fx('pump-test.docx'), { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.stats.equations, 4);
  assert.strictEqual(r.stats.charts, 2);
  assert.deepStrictEqual(r.warnings, []);
  assert.match(r.text, /Figure 1\. Measured flow/);
  assert.match(r.text, /Figure 2\. Efficiency/);
  assert.match(r.markdown, /\| Pump B \| 42\.1 \| 41\.7 \| 42\.4 \|/);
});

test('OMML to MathML: n-ary sum with limits, delimiters, matrix, function name, accent', () => {
  const sum = ommlToMathml('<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr><m:sub><m:r><m:t>k=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>k</m:t></m:r></m:e></m:nary></m:oMath>');
  assert.match(sum.mathml, /<munderover><mo largeop="true">∑<\/mo>/);
  assert.strictEqual(sum.display, false);
  const integral = ommlToMathml('<m:oMath><m:nary><m:sub><m:r><m:t>0</m:t></m:r></m:sub><m:sup><m:r><m:t>1</m:t></m:r></m:sup><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>');
  assert.match(integral.mathml, /<msubsup><mo largeop="true">∫<\/mo>/, 'integrals keep limits at the side');
  const d = ommlToMathml('<m:oMath><m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:e><m:r><m:t>b</m:t></m:r></m:e></m:d></m:oMath>');
  assert.strictEqual(d.linear, '[a|b]');
  const mat = ommlToMathml('<m:oMath><m:m><m:mr><m:e><m:r><m:t>1</m:t></m:r></m:e><m:e><m:r><m:t>0</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>0</m:t></m:r></m:e><m:e><m:r><m:t>1</m:t></m:r></m:e></m:mr></m:m></m:oMath>');
  assert.match(mat.mathml, /<mtable><mtr><mtd>/);
  assert.strictEqual(mat.linear, '[1, 0; 0, 1]');
  const fn = ommlToMathml('<m:oMath><m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>xy</m:t></m:r></m:e></m:func></m:oMath>');
  assert.match(fn.mathml, /<mi mathvariant="normal">sin<\/mi>/);
  assert.match(fn.mathml, /<mi>x<\/mi><mi>y<\/mi>/, 'variables are one letter each');
  const acc = ommlToMathml('<m:oMath><m:acc><m:accPr><m:chr m:val="̇"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>');
  assert.match(acc.mathml, /<mover accent="true">/);
});

test('OMML: document text is escaped, never markup', () => {
  const r = ommlToMathml('<m:oMath><m:r><m:t>&lt;script&gt;alert(1)&lt;/script&gt;</m:t></m:r><m:r><m:rPr><m:nor/></m:rPr><m:t>"&amp;"</m:t></m:r></m:oMath>');
  assert.doesNotMatch(r.mathml, /<script/);
  assert.match(r.mathml, /&lt;/);
  assert.match(r.mathml, /<mtext>&quot;&amp;&quot;<\/mtext>/);
  const broken = ommlToMathml('<m:oMath><m:r>');
  assert.ok(broken === null || /^<math /.test(broken.mathml), 'broken XML never throws');
  assert.strictEqual(ommlToMathml('<<<'), null);
});

test('equations show in Reading view as MathML, and as text in Markdown and plain text', async () => {
  const body = p('Before the formula') + '<w:p>' + QUADRATIC + '</w:p>'
    + '<w:p><w:r><w:t xml:space="preserve">Inline </w:t></w:r><m:oMath><m:sSup><m:e><m:r><m:t>e</m:t></m:r></m:e><m:sup><m:r><m:t>iπ</m:t></m:r></m:sup></m:sSup><m:r><m:t>+1=0</m:t></m:r></m:oMath><w:r><w:t xml:space="preserve"> holds.</w:t></w:r></w:p>';
  const r = await convertDocx(await makeDocx({ body, ns: M_NS }), { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.stats.equations, 2);
  const html = r.chunks.join('');
  assert.match(html, /<p class="dv-eq"><math [^>]*display="block"/, 'display equation gets its own centered block');
  assert.match(html, /<p>Inline <math [^>]*class="dv-math"[^>]*>.*<\/math> holds\.<\/p>/);
  assert.doesNotMatch(html, //, 'no marker left');
  assert.match(r.markdown, /x=\(-b±√\(b\^2-4ac\)\)\/\(2a\)/);
  assert.match(r.markdown, /Inline e\^\(iπ\)\+1=0 holds\./);
  assert.match(r.text, /Inline e\^\(iπ\)\+1=0 holds\./);
});

// ---------- charts ----------

function chartXml(kind, opts = {}) {
  const ser = (i, name, vals) => `<c:ser><c:idx val="${i}"/><c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache></c:strRef></c:tx>
    <c:cat><c:${opts.dates ? 'numRef' : 'strRef'}><c:${opts.dates ? 'numCache' : 'strCache'}>${opts.dates ? '<c:formatCode>m/d/yyyy</c:formatCode>' : ''}<c:ptCount val="3"/>${(opts.cats || ['North', 'South', 'East']).map((c, k) => `<c:pt idx="${k}"><c:v>${c}</c:v></c:pt>`).join('')}</c:${opts.dates ? 'numCache' : 'strCache'}></c:${opts.dates ? 'numRef' : 'strRef'}></c:cat>
    <c:val><c:numRef><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/>${vals.map((v, k) => `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`;
  const title = opts.title ? `<c:title><c:tx><c:rich><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>${opts.title}</a:t></a:r></a:p></c:rich></c:tx></c:title>` : '';
  const dir = kind === 'barChart' ? `<c:barDir val="${opts.horizontal ? 'bar' : 'col'}"/><c:grouping val="clustered"/>` : '';
  const series = (opts.series || [['Q2', [9.8, 11.2, 8.1]], ['Q3', [13.1, 12.4, 9]]]).map((s, i) => ser(i, s[0], s[1])).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ${C_NS} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:chart>${title}<c:autoTitleDeleted val="0"/><c:plotArea><c:${kind}>${dir}${series}</c:${kind}></c:plotArea></c:chart></c:chartSpace>`;
}
const DRAWING = (rid) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="3200400"/><wp:docPr id="1" name="Chart 1"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="${rid}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

test('chart part: bar chart becomes SVG bars, a data table and a Markdown table', () => {
  const r = renderChart(chartXml('barChart', { title: 'Revenue by region' }));
  assert.ok(r);
  assert.match(r.html, /^<figure class="dv-chart"><figcaption>Revenue by region<\/figcaption><svg class="dv-chart-svg"/);
  assert.strictEqual((r.html.match(/<rect class="dv-s[12]" x=/g) || []).length, 6 + 2, '6 bars and 2 legend keys');
  assert.match(r.html, /<title>Q3, North: 13\.1<\/title>/);
  assert.match(r.html, /<table class="dv-chart-data">/);
  assert.match(r.markdown, /^\*\*Chart: Revenue by region\*\*/);
  assert.match(r.markdown, /\| North \| 9\.8 \| 13\.1 \|/);
  assert.match(r.text, /North\t9\.8\t13\.1/);
});

test('chart part: line, pie, horizontal bars, dates and escaping', () => {
  assert.match(renderChart(chartXml('lineChart')).html, /<polyline class="dv-s1 dv-chart-line"/);
  const pie = renderChart(chartXml('pieChart', { series: [['Share', [50, 30, 20]]] }));
  assert.strictEqual((pie.html.match(/<path class="dv-s\d dv-chart-slice"/g) || []).length, 3);
  assert.match(pie.html, /North: 50 \(50%\)/);
  assert.match(renderChart(chartXml('barChart', { horizontal: true })).html, /text-anchor="end">North<\/text>/);
  const dates = parseChart(chartXml('lineChart', { dates: true, cats: [45658, 45659, 45660] }));
  assert.deepStrictEqual(dates.categories, ['2025-01-01', '2025-01-02', '2025-01-03']);
  const evil = renderChart(chartXml('barChart', { title: '&lt;img src=x onerror=alert(1)&gt;', series: [['&lt;b&gt;', [1, 2, 3]]] }));
  assert.doesNotMatch(evil.html, /<img|<b>/);
  assert.strictEqual(renderChart('<c:chartSpace ' + C_NS + '><c:chart><c:plotArea/></c:chart></c:chartSpace>'), null);
  assert.strictEqual(renderChart('not xml <'), null);
});

test('a chart in a .docx shows in Reading view; Copy as Markdown gets its data', async () => {
  const buf = await makeDocx({
    body: p('Revenue grew.') + DRAWING('rIdChart1') + p('After the chart.'),
    ns: C_NS,
    rels: [{ id: 'rIdChart1', type: 'chart', target: 'charts/chart1.xml' }],
    extraParts: { 'word/charts/chart1.xml': chartXml('barChart', { title: 'Revenue by region' }) }
  });
  const r = await convertDocx(buf, { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.stats.charts, 1);
  const html = r.chunks.join('');
  assert.match(html, /<p>Revenue grew\.<\/p><figure class="dv-chart">/, 'the chart replaces its paragraph');
  assert.match(html, /<\/figure><p>After the chart\.<\/p>/);
  assert.match(r.markdown, /Revenue grew\.\n\n\*\*Chart: Revenue by region\*\*\n\n\| \| Q2 \| Q3 \|/);
});

test('a chart whose part is missing is left out quietly', async () => {
  const buf = await makeDocx({ body: p('Text.') + DRAWING('rIdNope'), ns: C_NS });
  const r = await convertDocx(buf, { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.stats.charts, 0);
  assert.match(r.markdown, /Text\./);
});

// ---------- simple fields ----------

test('figure numbers in simple fields (w:fldSimple) are kept', async () => {
  const body = '<w:p><w:r><w:t xml:space="preserve">Figure </w:t></w:r><w:fldSimple w:instr=" SEQ Figure \\* ARABIC "><w:r><w:t>29</w:t></w:r></w:fldSimple><w:r><w:t>. Reef habitat</w:t></w:r></w:p><w:p><w:fldSimple w:instr=" PAGE "/><w:r><w:t>End</w:t></w:r></w:p>';
  const r = await convertDocx(await makeDocx({ body }), { ext: '.docx' });
  assert.ok(r.ok);
  assert.match(r.text, /Figure 29\. Reef habitat/);
  assert.deepStrictEqual(r.warnings, []);
});

// ---------- sanitizer and protocol ----------

test('sanitizer: image references become data-dv-img, anything else is a placeholder', () => {
  const t = H.sanitize(H.parse('<p><img src="dv-img:5" alt="map"><img src="dv-img:x"><img src="javascript:alert(1)"></p>'));
  const html = H.renderNode(t.tree);
  assert.match(html, /<img data-dv-img="5" alt="map">/);
  assert.strictEqual((html.match(/dv-img-skipped/g) || []).length, 2);
  assert.strictEqual(t.images, 1);
});

test('injectItems: only markers with this conversion\'s tag are replaced', () => {
  const tree = H.sanitize(H.parse('<p>a ffff0000:0 b abcd1234:0</p>')).tree;
  const counts = H.injectItems(tree, { 'abcd1234:0': { kind: 'math', html: '<math></math>', inlineHtml: '<math></math>', markdown: 'x', text: 'x', block: false } }, 'abcd1234');
  assert.strictEqual(counts.equations, 1);
  const html = H.renderNode(tree);
  assert.match(html, /<math><\/math>/);
  assert.match(html, /ffff0000:0/, 'a marker from another tag stays plain text');
});

test('protocol: images travel in their own message after begin, with an image type allowlist', () => {
  const msgs = P.buildRenderMessages({ chunks: ['<p>x</p>'], outline: [], warnings: [], stats: {}, images: [{ type: 'image/png', data: new Uint8Array([1, 2]) }] }, { fileName: 'a.docx' });
  assert.deepStrictEqual(msgs.map((m) => m.type), ['begin', 'images', 'chunk', 'end']);
  assert.ok(P.validateOutbound(msgs[1]));
  assert.ok(!P.validateOutbound({ type: 'images', list: [{ type: 'image/svg+xml', data: new Uint8Array(1) }] }), 'no SVG images');
  assert.ok(!P.validateOutbound({ type: 'images', list: [{ type: 'image/png', data: 'AAAA' }] }));
  assert.ok(!P.buildRenderMessages({ chunks: ['x'], outline: [], warnings: [], stats: {} }, {}).some((m) => m.type === 'images'));
});

test('images survive the worker: bytes arrive as Uint8Array', async () => {
  const r = await convertInWorker(fx('sample.docx'), { ext: '.docx' });
  assert.ok(r.ok);
  assert.strictEqual(r.images.length, 1);
  assert.ok(r.images[0].data instanceof Uint8Array);
  assert.strictEqual(r.images[0].type, 'image/png');
});

test('mammoth style noise is not shown as conversion notes', async () => {
  const body = '<w:p><w:pPr><w:pStyle w:val="NoSpacing"/></w:pPr><w:r><w:t>Hello</w:t></w:r></w:p>';
  const r = await convertDocx(await makeDocx({ body }), { ext: '.docx' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.warnings, []);
});

// ---------- odd real-world files ----------

function fakeOle(streamName) {
  const b = Buffer.alloc(2048);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(b);
  Buffer.from(streamName, 'utf16le').copy(b, 1024);
  return b;
}

test('password-protected .docx (encrypted OLE container) says so plainly', async () => {
  const enc = fakeOle('EncryptedPackage');
  assert.strictEqual(oleKind(enc), 'encrypted');
  assert.strictEqual(canConvert('ole', '.docx', enc), false);
  const r = await convertDocx(enc, { ext: '.docx' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.notice.title, 'This document is password protected');
  assert.strictEqual(noticeFor('ole', '.docx', enc).kind, 'encrypted');
});

test('an old Word 97-2003 file with a .docx or .docm name opens as text with a note', async () => {
  const bytes = fx('simple.doc');
  assert.strictEqual(oleKind(bytes), 'doc');
  assert.strictEqual(canConvert('ole', '.docm', bytes), true);
  const r = await convertDocx(bytes, { ext: '.docm' });
  assert.ok(r.ok);
  assert.strictEqual(r.format, 'doc');
  assert.match(r.banner, /old Word 97-2003 file with a \.docm name/);
  assert.ok(r.stats.words > 0);
});

test('XML parts with a DOCTYPE and custom entities still open', async () => {
  const buf = await makeDocx({ body: p('Kept text') });
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', xml.replace('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE w:document [<!ENTITY testent SYSTEM "file:///etc/passwd">]>').replace('Kept text', 'Kept text &testent;'));
  const r = await convertDocx(await zip.generateAsync({ type: 'nodebuffer' }), { ext: '.docx' });
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.match(r.text, /Kept text/);
  assert.doesNotMatch(r.text, /root:/);
});

test('tables nested 400 deep convert in the worker (bigger stack)', async () => {
  let inner = p('deep');
  for (let i = 0; i < 400; i++) inner = `<w:tbl><w:tr><w:tc>${inner}</w:tc></w:tr></w:tbl><w:p/>`;
  const r = await convertInWorker(await makeDocx({ body: inner }), { ext: '.docx' });
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.match(r.text, /deep/);
});

// ---------- RTF ----------

test('RTF to text: paragraphs, code page, Unicode, tables; fonts and pictures skipped', () => {
  const rtf = '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Times New Roman;}}{\\colortbl;\\red0\\green0\\blue0;}{\\*\\generator Tool;}'
    + '\\pard Caf\\\'e9 \\u8364? price\\par'
    + '{\\pict\\pngblip 89504e47}'
    + '\\trowd\\cellx1000\\cellx2000\\pard\\intbl Name\\cell Count\\cell\\row'
    + '\\trowd\\cellx1000\\cellx2000\\pard\\intbl Total\\cell 12\\cell\\row'
    + '\\pard Last \\{line\\}\\par}';
  const t = rtfToText(Buffer.from(rtf, 'latin1'));
  assert.match(t, /^Café € price\n/);
  assert.doesNotMatch(t, /Times|89504e47|Tool/);
  assert.match(t, /Name\tCount\t\nTotal\t12\t\n/);
  assert.match(t, /Last \{line\}/);
  assert.throws(() => rtfToText(Buffer.from('plain')), /not an RTF/);
});

test('RTF: tab-aligned columns on two or more lines become a table', async () => {
  assert.strictEqual(tabBlocksToRows('Title\nName\tA\tB\nX\t1\t2\nEnd\tonly one'), 'Title\nName\tA\tB\t\nX\t1\t2\t\nEnd\tonly one');
  assert.strictEqual(tabBlocksToRows('a\tb\tc'), 'a\tb\tc', 'a single line stays a paragraph');
  const rtf = '{\\rtf1\\ansi \\pard Bulletin\\par Altcourse\\tab 794\\tab 150%\\par Ashfield\\tab 407\\tab 50%\\par}';
  const r = await convertDocx(Buffer.from(rtf, 'latin1'), { ext: '.doc' });
  assert.match(r.chunks.join(''), /<p>Bulletin<\/p>\s*<table><tbody><tr><td>Altcourse<\/td><td>794<\/td><td>150%<\/td><\/tr>/);
});

test('RTF named .doc shows a table in Reading view', async () => {
  const rtf = '{\\rtf1\\ansi \\pard Prison population\\par\\trowd\\pard\\intbl Male\\cell 80,000\\cell\\row\\trowd\\pard\\intbl Female\\cell 4,000\\cell\\row}';
  const r = await convertDocx(Buffer.from(rtf, 'latin1'), { ext: '.doc' });
  assert.ok(r.ok);
  assert.strictEqual(r.format, 'rtf');
  assert.match(r.chunks.join(''), /<table><tbody><tr><td>Male<\/td><td>80,000<\/td><\/tr>/);
  assert.strictEqual(detectFormat(Buffer.from(rtf)), 'rtf');
  assert.strictEqual(canConvert('rtf', '.docx'), false, 'only under a .doc/.dot name');
});

// ---------- toolbar and font ----------

const URIS = { css: 'c', protocol: 'p', search: 's', viewer: 'v', pageView: 'pv', page: 'pg' };

test('toolbar: hide and show buttons in both views; hidden state comes from the host', () => {
  const r = buildWebviewHtml({ cspSource: 'x', uris: URIS, nonce: 'N', toolbarHidden: true });
  assert.match(r, /data-bar="hidden"/);
  assert.match(r, /id="dv-bar-hide"/);
  assert.match(r, /id="dv-bar-show"/);
  const pg = buildPageHtml({ cspSource: 'x', uris: URIS, nonce: 'N' });
  assert.match(pg, /data-bar="shown"/);
  assert.match(pg, /id="dv-bar-hide"/);
  assert.deepStrictEqual(P.validateInbound({ type: 'setToolbar', hidden: true }), { ok: true, msg: { type: 'setToolbar', hidden: true } });
  assert.strictEqual(P.validateInbound({ type: 'setToolbar', hidden: 'yes' }).msg.hidden, false);
  assert.ok(P.validateOutbound({ type: 'toolbar', hidden: false }));
});

test('font setting: editor, a font list, or nothing; odd values are dropped', () => {
  assert.strictEqual(fontAttr('editor'), 'editor');
  assert.strictEqual(fontAttr('Georgia, "Times New Roman", serif'), 'Georgia, "Times New Roman", serif');
  assert.strictEqual(fontAttr('x;}body{display:none'), '');
  assert.strictEqual(fontAttr(42), '');
  assert.match(buildWebviewHtml({ cspSource: 'x', uris: URIS, nonce: 'N', font: 'editor' }), /data-font="editor"/);
});

test('package.json: 0.4.4, toolbar command and keybinding, font setting, higher limits, 30 keywords', () => {
  const pkg = require('../package.json');
  assert.strictEqual(pkg.version, '0.4.4');
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'docxViewer.toggleToolbar'));
  const kb = pkg.contributes.keybindings.find((k) => k.command === 'docxViewer.toggleToolbar');
  assert.strictEqual(kb.when, "activeCustomEditorId == 'docxViewer.preview'");
  const props = pkg.contributes.configuration.properties;
  assert.strictEqual(props['docxViewer.fontFamily'].default, '');
  assert.strictEqual(props['docxViewer.maxFileSizeMB'].default, 100);
  assert.strictEqual(props['docxViewer.maxTotalImagesMB'].default, 300);
  assert.strictEqual(pkg.keywords.length, 30);
  for (const k of ['docx reader', 'doc viewer', 'word reader']) assert.ok(pkg.keywords.includes(k), k);
  assert.match(pkg.displayName, /^DOCX Viewer & ODT Viewer, Word Document Preview/);
  const words = new Set(pkg.displayName.toLowerCase().split(/[^a-z0-9]+/));
  for (const q of ['docx viewer', 'word viewer', 'docx preview', 'odt viewer', 'word document viewer', 'word preview']) assert.ok(q.split(' ').every((w) => words.has(w)), q);
});
