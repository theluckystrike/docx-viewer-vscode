'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../src/html');

const clean = (html) => H.sanitize(H.parse(html));
const render = (html) => H.renderNode(clean(html).tree);

test('escapes text and attributes again after decoding', () => {
  const out = render('<p>a &lt;script&gt;alert(1)&lt;/script&gt; &amp; b</p>');
  assert.strictEqual(out, '<p>a &lt;script&gt;alert(1)&lt;/script&gt; &amp; b</p>');
  const alt = render('<p><img src="data:image/png;base64,AAAA" alt="x&quot; onerror=&quot;alert(1)" /></p>');
  assert.ok(!/onerror="/.test(alt), alt);
  assert.ok(alt.includes('alt="x&quot; onerror=&quot;alert(1)"'));
});

test('drops script, style, iframe and event handlers', () => {
  const out = render('<p onclick="x()">hi<script>evil()</script><style>p{}</style><iframe src="x"></iframe></p>');
  assert.strictEqual(out, '<p>hi</p>');
});

test('keeps only safe link targets', () => {
  assert.strictEqual(render('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.strictEqual(render('<a href="file:///etc/passwd">x</a>'), '<a>x</a>');
  assert.strictEqual(render('<a href="https://example.com/a?b=1&amp;c=2">x</a>'), '<a href="https://example.com/a?b=1&amp;c=2">x</a>');
  assert.strictEqual(render('<a href="mailto:a@b.c">x</a>'), '<a href="mailto:a@b.c">x</a>');
  assert.strictEqual(render('<a href="#_Toc12">x</a>'), '<a href="#d-_Toc12">x</a>');
});

test('prefixes document ids so they cannot clash with the viewer UI', () => {
  assert.strictEqual(render('<p id="dv-q">x</p>'), '<p id="d-dv-q">x</p>');
  assert.strictEqual(render('<p id="a b&quot;c">x</p>'), '<p id="d-a_b_c">x</p>');
});

test('images need a raster data URI, other images become placeholders', () => {
  const ok = clean('<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="chart" /></p>');
  assert.strictEqual(ok.images, 1);
  assert.strictEqual(ok.skippedImages, 0);
  const svg = clean('<p><img src="data:image/svg+xml;base64,PHN2Zz4=" /></p>');
  assert.strictEqual(svg.images, 0);
  assert.strictEqual(svg.skippedImages, 1);
  assert.match(H.renderNode(svg.tree), /class="dv-img-skipped"/);
  const remote = render('<p><img src="https://tracker.example/pixel.png" /></p>');
  assert.ok(!remote.includes('tracker'), remote);
  const big = render('<p><img src="" data-dv-skipped="9.0 MB is over the 5.0 MB image limit" alt="photo" /></p>');
  assert.match(big, /\[Image "photo" not shown: 9\.0 MB is over the 5\.0 MB image limit\]/);
});

test('headings get stable ids and feed the outline', () => {
  const r = clean('<h1>One</h1><p>x</p><h2><a id="_Toc1"></a>Two &amp; more</h2><h3>   </h3>');
  assert.deepStrictEqual(r.outline, [
    { level: 1, text: 'One', id: 'h-1' },
    { level: 2, text: 'Two & more', id: 'h-2' }
  ]);
  assert.match(H.renderNode(r.tree), /<h2 id="h-2"><a id="d-_Toc1"><\/a>Two &amp; more<\/h2>/);
});

test('table spans are kept only when numeric', () => {
  assert.strictEqual(render('<table><tr><td colspan="2" rowspan="x">a</td></tr></table>'), '<table><tr><td colspan="2">a</td></tr></table>');
});

test('footnote list is marked and counted', () => {
  const r = clean('<p>a<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p><ol><li id="footnote-1"><p>Note <a href="#footnote-ref-1">↑</a></p></li></ol>');
  assert.strictEqual(r.footnotes, 1);
  assert.match(H.renderNode(r.tree), /<ol class="dv-footnotes"><li id="d-footnote-1">/);
});

test('unclosed and stray tags do not break the tree', () => {
  assert.strictEqual(render('<p>a<strong>b</p><p>c</em></p>'), '<p>a<strong>b</strong></p><p>c</p>');
  assert.strictEqual(render('plain < text > here'), 'plain &lt; text &gt; here');
});

test('numeric entities decode safely', () => {
  assert.strictEqual(H.decodeEntities('&#65;&#x42;&#xD800;&#99999999;'), 'AB��');
});

test('chunkBlocks splits at top-level blocks and keeps all content', () => {
  const html = Array.from({ length: 300 }, (_, i) => '<p>paragraph ' + i + ' ' + 'x'.repeat(50) + '</p>').join('');
  const tree = clean(html).tree;
  const chunks = H.chunkBlocks(tree, 2000);
  assert.ok(chunks.length > 5);
  assert.strictEqual(chunks.join(''), H.renderNode(tree));
  for (const c of chunks) assert.ok(c.startsWith('<p>') && c.endsWith('</p>'));
  assert.deepStrictEqual(H.chunkBlocks(clean('').tree, 2000), ['']);
});

test('markdown covers headings, emphasis, lists, tables, links, footnotes and escaping', () => {
  const md = H.toMarkdown(clean(
    '<h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> with *stars* and [brackets].' +
    '<sup><a href="#footnote-1" id="footnote-ref-1">[1]</a></sup></p>' +
    '<ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><ol start="3"><li>three</li></ol>' +
    '<table><tr><td><p>A</p></td><td><p>B|C</p></td></tr><tr><td colspan="2"><p>wide</p></td></tr></table>' +
    '<p><a href="https://example.com/x y">link</a> <img src="data:image/png;base64,AA==" alt="pic" /></p>' +
    '<p>1. not a list</p>' +
    '<ol><li id="footnote-1"><p>The note. <a href="#footnote-ref-1">↑</a></p></li></ol>').tree);
  assert.strictEqual(md, [
    '# Title',
    '',
    'Some **bold** and *italic* with \\*stars\\* and \\[brackets\\].[^1]',
    '',
    '- one',
    '  - nested',
    '- two',
    '',
    '3. three',
    '',
    '| A | B\\|C |',
    '| --- | --- |',
    '| wide |  |',
    '',
    '[link](https://example.com/x%20y) ![pic](#image-1)',
    '',
    '\\1. not a list',
    '',
    '[^1]: The note.',
    ''
  ].join('\n'));
});

test('plain text keeps structure without markup', () => {
  const t = H.toPlainText(clean('<h1>T</h1><p>a <strong>b</strong><br />c</p><ol><li>x</li><li>y</li></ol><table><tr><td><p>1</p></td><td><p>2</p></td></tr></table>').tree);
  assert.strictEqual(t, 'T\n\na b\nc\n\n1. x\n2. y\n\n1\t2\n');
});
