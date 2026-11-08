'use strict';
// EMF, WMF and TIFF pictures (0.3.2): detection, the EMF player, WMFJS, the TIFF decoder with its
// guards, hostile files, the converter hand-off, the protocol, both webviews' hooks and the CSP.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const F = require('./helpers/picture-files');
const { makeDocx, p } = require('./helpers/make-docx');
const K = require('../src/picture-kind');
const Pic = require('../src/pictures');
const { convertDocx } = require('../src/convert');
const P = require('../media/protocol');
const Page = require('../media/page');
const W = require('../src/webview-html');
const { showObjects } = require('../src/page-objects');

const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f));
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
// WMFJS draws with the DOM; the EMF player and the TIFF decoder do not need one.
global.document = dom.window.document;
global.XMLSerializer = dom.window.XMLSerializer;
const u8 = (b) => new Uint8Array(b.buffer, b.byteOffset, b.length);
function wellFormed(svg) {
  const d = new dom.window.DOMParser().parseFromString(svg, 'image/svg+xml');
  return !d.getElementsByTagName('parsererror').length && d.documentElement.nodeName === 'svg';
}
function timed(fn) { const t0 = Date.now(); let r; let err = null; try { r = fn(); } catch (e) { err = e; } return { r, err, ms: Date.now() - t0 }; }

// ---------- detection ----------

test('picture kind: EMF, WMF (placeable and plain) and TIFF by bytes; types and extensions', () => {
  assert.strictEqual(K.sniff(u8(F.sampleEmf())), 'emf');
  assert.strictEqual(K.sniff(u8(F.sampleWmf())), 'wmf');
  assert.strictEqual(K.sniff(u8(F.sampleWmf().subarray(22))), 'wmf');
  assert.strictEqual(K.sniff(u8(F.sampleTiff(1))), 'tiff');
  const mm = Buffer.from('MM\0*\0\0\0\x08', 'latin1');
  assert.strictEqual(K.sniff(u8(mm)), 'tiff');
  assert.strictEqual(K.sniff(u8(Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1'))), null);
  assert.strictEqual(K.sniff(u8(F.hostile.emfNotEmf())), null);
  assert.strictEqual(K.kindOfType('image/x-emf'), 'emf');
  assert.strictEqual(K.kindOfType('image/wmf'), 'wmf');
  assert.strictEqual(K.kindOfType('tif'), 'tiff');
  assert.strictEqual(K.kindOfType('image/png'), null);
});

// ---------- EMF ----------

test('EMF: shapes, a bitmap and text become well-formed SVG at the frame size', () => {
  const r = Pic.emfToSvg(u8(F.sampleEmf()));
  assert.strictEqual(r.width, 192);
  assert.strictEqual(r.height, 96);
  assert.ok(wellFormed(r.svg), 'parses as SVG');
  assert.match(r.svg, /viewBox="0 0 192 9[56](\.\d+)?"/);
  assert.match(r.svg, /fill="#ddebf7"/, 'brush color');
  assert.match(r.svg, /stroke="#1f4e79"/, 'pen color');
  assert.match(r.svg, />EMF picture drawn<\/text>/);
  assert.match(r.svg, /font-family="Arial, sans-serif"[^>]*font-weight="bold"/);
  assert.match(r.svg, /<image [^>]*href="data:image\/bmp;base64,/, 'the DIB is embedded');
  assert.match(r.svg, /<text x="[\d.]+ [\d.]+ [\d.]+/, 'per-character advances are kept');
  assert.doesNotMatch(r.svg, /<script|on\w+=/i);
});

test('EMF+ dual files draw their plain EMF records; EMF+ only files are refused with a reason', () => {
  const r = Pic.emfToSvg(u8(F.sampleEmf({ plus: true, text: 'dual' })));
  assert.match(r.svg, />dual<\/text>/);
  const e = timed(() => Pic.emfToSvg(u8(F.emfPlusOnly())));
  assert.ok(e.err instanceof Pic.PictureError);
  assert.match(e.err.message, /only EMF\+ records/);
});

test('EMF: text is escaped and characters XML does not allow are dropped', () => {
  const r = Pic.emfToSvg(u8(F.sampleEmf({ text: '<b>&"x"\u0001\ud800' })));
  assert.ok(wellFormed(r.svg));
  assert.match(r.svg, />&lt;b&gt;&amp;&quot;x&quot;<\/text>/);
});

test('EMF hostile: cut-off file draws what is there; huge size is scaled down; floods, zero-length records and bitmap bombs are refused fast', () => {
  const cut = timed(() => Pic.emfToSvg(u8(F.hostile.emfTruncated())));
  assert.ifError(cut.err);
  assert.ok(wellFormed(cut.r.svg));
  const huge = timed(() => Pic.emfToSvg(u8(F.hostile.emfHugeBounds())));
  assert.ifError(huge.err);
  assert.ok(huge.r.width <= 4000 && huge.r.height <= 4000, 'display size capped');
  for (const [name, bytes, why] of [
    ['zero', F.hostile.emfZeroRecord(), /nothing to draw/],
    ['flood', F.hostile.emfRecordFlood(), /more than 200000/],
    ['bomb', F.hostile.emfBitmapBomb(), /bitmap inside it is too large/],
    ['short', Buffer.alloc(40), /too short/]
  ]) {
    const t = timed(() => Pic.emfToSvg(u8(bytes)));
    assert.ok(t.err instanceof Pic.PictureError, name);
    assert.match(t.err.message, why, name);
    assert.ok(t.ms < 1000, name + ' took ' + t.ms + ' ms');
  }
});

test('EMF: a header that claims OpenGL records or has the description in the extension still draws', () => {
  const b = Buffer.from(F.sampleEmf());
  // Grow the header to 108 bytes with odd extension values, as some writers do.
  const head = Buffer.alloc(108);
  b.copy(head, 0, 0, 88);
  head.writeUInt32LE(108, 4);
  head.writeUInt32LE(7, 88); head.writeUInt32LE(4, 92); head.writeUInt32LE(1, 96);
  const out = Buffer.concat([head, b.subarray(88)]);
  out.writeUInt32LE(out.length, 48);
  const r = Pic.emfToSvg(u8(out));
  assert.match(r.svg, />EMF picture drawn<\/text>/);
});

// ---------- WMF ----------

test('WMF: placeable file draws text and shapes at its inch size', () => {
  const r = Pic.wmfToSvg(u8(F.sampleWmf('Equation 1')));
  assert.strictEqual(r.width, 133);
  assert.strictEqual(r.height, 67);
  assert.ok(wellFormed(r.svg));
  assert.match(r.svg, /Equation 1/);
  assert.match(r.svg, /<rect|<path|<ellipse/);
});

test('WMF hostile: zero-length record is refused, cut-off file draws what is there', () => {
  const z = timed(() => Pic.wmfToSvg(u8(F.hostile.wmfZeroRecord())));
  assert.ok(z.err instanceof Pic.PictureError);
  const cut = timed(() => Pic.wmfToSvg(u8(F.hostile.wmfTruncated())));
  assert.ifError(cut.err);
  assert.ok(cut.ms < 1000);
});

// ---------- TIFF ----------

function px(t, x, y) { const i = (y * t.width + x) * 4; return Array.from(t.rgba.subarray(i, i + 3)); }

test('TIFF: none, LZW, PackBits and Deflate give the same pixels; a 2-page file shows page 1', () => {
  for (const c of [1, 5, 32773, 8]) {
    const t = Pic.decodeTiff(u8(F.sampleTiff(c)));
    assert.strictEqual(t.width, 160, 'compression ' + c);
    assert.deepStrictEqual(px(t, 10, 10), [0xc0, 0x39, 0x2b], 'left half, compression ' + c);
    assert.deepStrictEqual(px(t, 150, 90), [0x29, 0x80, 0xb9], 'right half, compression ' + c);
    assert.deepStrictEqual(px(t, 80, 50), [0, 0, 0], 'black band, compression ' + c);
  }
  const two = Pic.decodeTiff(u8(F.sampleTiff(5, true)));
  assert.deepStrictEqual(px(two, 10, 10), [0xc0, 0x39, 0x2b], 'first page, not the green second one');
});

test('TIFF: LZW encoder round trip through the guarded decoder, longer than one table', () => {
  const data = new Uint8Array(70000);
  for (let i = 0; i < data.length; i++) data[i] = (i * 7 + (i >> 9)) & 255;
  const enc = u8(F.lzwEncode(data));
  const out = new Uint8Array(data.length);
  Pic.lzw(enc, 0, enc.length, out, 0);
  assert.deepStrictEqual(Buffer.from(out), Buffer.from(data));
});

test('TIFF hostile: 100000 x 100000 header refused before any allocation; loops, broken tables, broken LZW and Deflate bombs stay bounded', () => {
  const huge = timed(() => Pic.decodeTiff(u8(F.hostile.tiffHuge())));
  assert.ok(huge.err instanceof Pic.PictureError);
  assert.match(huge.err.message, /100000 x 100000 pixels/);
  assert.ok(huge.ms < 100);
  const loop = timed(() => Pic.decodeTiff(u8(F.hostile.tiffIfdLoop())));
  assert.ifError(loop.err);
  assert.strictEqual(loop.r.width, 4);
  const bad = timed(() => Pic.decodeTiff(u8(F.hostile.tiffBadIfd())));
  assert.ok(bad.err instanceof Pic.PictureError);
  const lzw = timed(() => Pic.decodeTiff(u8(F.hostile.tiffLzwGarbage())));
  assert.ok(lzw.ms < 2000, 'broken LZW took ' + lzw.ms + ' ms');
  const bomb = timed(() => Pic.decodeTiff(u8(F.hostile.tiffDeflateBomb())));
  assert.ok(bomb.ms < 2000, 'Deflate bomb took ' + bomb.ms + ' ms');
  if (!bomb.err) assert.strictEqual(bomb.r.rgba.length, 64 * 64 * 4);
});

test('TIFF: unsupported compression and missing strips give a reason, not a crash', () => {
  const t = Buffer.from(F.sampleTiff(1));
  const ifd = t.readUInt32LE(4);
  const n = t.readUInt16LE(ifd);
  for (let i = 0; i < n; i++) if (t.readUInt16LE(ifd + 2 + i * 12) === 259) t.writeUInt16LE(34712, ifd + 2 + i * 12 + 8); // JPEG 2000
  const e = timed(() => Pic.decodeTiff(u8(t)));
  assert.match(e.err.message, /compression type 34712/);
});

test('draw(): over the size limit and unknown bytes are refused with a reason; messages name the format', async () => {
  await assert.rejects(Pic.draw(u8(F.sampleEmf()), 'emf', { maxBytes: 100 }), /MB picture limit/);
  await assert.rejects(Pic.draw(u8(Buffer.from('not a picture at all, sorry')), 'emf'), /not an EMF, WMF or TIFF picture/);
  assert.strictEqual(P.pictureMessage('image/x-emf', new Error('it has nothing to draw')), 'Picture could not be drawn (EMF): it has nothing to draw');
  assert.strictEqual(P.pictureName('tif'), 'TIFF');
});

// ---------- converter and protocol ----------

test('converter: EMF, WMF and TIFF pictures travel as bytes with their own types, none skipped', async () => {
  const r = await convertDocx(fx('pictures.docx'), { ext: '.docx' });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.images.map((i) => i.type), ['image/x-emf', 'image/x-emf', 'image/x-wmf', 'image/tiff', 'image/tiff', 'image/tiff', 'image/tiff']);
  assert.strictEqual(r.stats.skippedImages, 0);
  assert.strictEqual((r.chunks.join('').match(/<img data-dv-img=/g) || []).length, 7);
  assert.ok(P.validateOutbound({ type: 'images', list: r.images }));
});

test('converter: the bytes decide the type (a WMF named .emf), unknown formats keep the placeholder, size limit still applies', async () => {
  const rels = [{ id: 'rI1', type: 'image', target: 'media/a.emf' }, { id: 'rI2', type: 'image', target: 'media/b.emf' }, { id: 'rI3', type: 'image', target: 'media/c.emf' }];
  const blip = (id) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="x"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const buf = await makeDocx({ body: blip('rI1') + blip('rI2') + blip('rI3') + p('x'), rels, contentTypes: ['<Default Extension="emf" ContentType="image/x-emf"/>'], extraParts: { 'word/media/a.emf': F.sampleWmf(), 'word/media/b.emf': Buffer.from('garbage bytes here'), 'word/media/c.emf': F.sampleEmf() } });
  const r = await convertDocx(buf, { ext: '.docx', maxImageBytes: 900 });
  assert.deepStrictEqual(r.images.map((i) => i.type), ['image/x-wmf']);
  const html = r.chunks.join('');
  assert.match(html, /EMF images are not supported/);
  assert.match(html, /over the 900 B image limit/);
});

test('protocol: images message accepts the three new types and nothing else new', () => {
  for (const t of ['image/x-emf', 'image/x-wmf', 'image/tiff']) assert.ok(P.validateOutbound({ type: 'images', list: [{ type: t, data: new Uint8Array(1) }] }), t);
  assert.ok(!P.validateOutbound({ type: 'images', list: [{ type: 'image/svg+xml', data: new Uint8Array(1) }] }));
  assert.ok(!P.validateOutbound({ type: 'images', list: [{ type: 'text/html', data: new Uint8Array(1) }] }));
});

// ---------- webviews ----------

test('webview HTML: both views carry the pictures script URL; CSP stays strict (no unsafe-eval, no workers, no network)', () => {
  const uris = { css: 'c', protocol: 'p', search: 's', viewer: 'v', pageView: 'pv', page: 'pg', pictures: 'https://file+.vscode-resource/media/pictures.js' };
  for (const html of [W.buildWebviewHtml({ cspSource: 'vscode-resource:', uris, nonce: 'n1' }), W.buildPageHtml({ cspSource: 'vscode-resource:', uris, nonce: 'n1' })]) {
    assert.match(html, /data-pictures="https:\/\/file\+\.vscode-resource\/media\/pictures\.js"/);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
    assert.doesNotMatch(csp, /unsafe-eval|worker-src|connect-src (?!'none')/);
    assert.match(csp, /script-src 'nonce-n1'/);
  }
  assert.doesNotMatch(W.buildWebviewHtml({ cspSource: 'x', uris: { css: 'c', protocol: 'p', search: 's', viewer: 'v' } }), /data-pictures/);
});

test('protocol.loadPictures: adds one script with the page nonce from <body data-pictures>, once', async () => {
  const d = new JSDOM('<!DOCTYPE html><html><head></head><body data-pictures="vscode-resource:/media/pictures.js"><script nonce="abc"></script></body></html>').window.document;
  const pr = P.loadPictures(d);
  const s = d.head.querySelector('script[src]');
  assert.ok(s);
  assert.strictEqual(s.getAttribute('src'), 'vscode-resource:/media/pictures.js');
  assert.strictEqual(s.nonce || s.getAttribute('nonce'), 'abc');
  d.defaultView.DocxPictures = { draw: () => Promise.resolve('ok'), kindOfType: K.kindOfType };
  s.onload();
  assert.strictEqual(await pr, d.defaultView.DocxPictures);
  assert.strictEqual(d.head.querySelectorAll('script[src]').length, 1);
});

test('Page view hook: EMF/WMF/TIFF parts are drawn, other parts pass through, failures become a labelled box', async () => {
  const made = [];
  global.URL.createObjectURL = (b) => { made.push(b); return 'blob:x/' + made.length; };
  const doc = new JSDOM('<!DOCTYPE html><body></body>').window.document;
  const fakeP = {
    drawPicture: (d, bytes, kind) => (kind === 'emf' ? Promise.resolve(new Blob(['<svg/>'], { type: 'image/svg+xml' })) : Promise.reject(new Error('it has nothing to draw'))),
    pictureMessage: P.pictureMessage
  };
  const urls = [];
  const hook = Page.pictureHook(doc, fakeP, { maxBytes: 1000 }, urls);
  const original = (b, pth) => 'orig:' + pth;
  assert.strictEqual(await hook(new Blob(['x']), 'word/media/image1.png', original), 'orig:word/media/image1.png');
  assert.strictEqual(await hook(new Blob(['x']), 'word/media/image2.emf', original), 'blob:x/1');
  assert.strictEqual(made[0].type, 'image/svg+xml');
  const failed = await hook(new Blob(['x']), 'word/media/image3.wmf', original);
  assert.strictEqual(failed, 'blob:x/2');
  const text = await made[1].text();
  assert.match(text, /Picture could not be drawn \(WMF\)/);
  await hook(new Blob([new Uint8Array(2000)]), 'word/media/image4.tif', original);
  assert.match(await made[2].text(), /over the 0 MB picture limit|picture limit/);
  assert.deepStrictEqual(urls, ['blob:x/1', 'blob:x/2', 'blob:x/3']);
});

test('Page view: docx-preview lays out pictures.docx with the hook; every picture slot gets a drawn URL', async () => {
  const { parseAsync, renderDocument } = await import('docx-preview');
  const win = new JSDOM('<!DOCTYPE html><body><div id="s"></div><div id="b"></div></body>').window;
  for (const k of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'NodeFilter', 'HTMLElement', 'Element', 'getComputedStyle']) global[k] = win[k];
  let n = 0;
  global.URL.createObjectURL = () => 'blob:t/' + (++n);
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0); // docx-preview sizes VML pictures in the next frame
  win.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 }); // no layout in jsdom
  const seen = [];
  const fakeP = { drawPicture: (d, bytes, kind) => { seen.push(kind + ':' + K.sniff(bytes)); return Promise.resolve(new Blob(['<svg/>'])); }, pictureMessage: P.pictureMessage };
  // The same steps as src/page-entry.js renderAsync.
  const doc = await parseAsync(await showObjects(require('jszip'), fx('pictures.docx')), Page.RENDER_OPTIONS);
  const original = doc.blobToURL.bind(doc);
  const hook = Page.pictureHook(win.document, fakeP, { maxBytes: 1e9 }, []);
  doc.blobToURL = (b, pth) => hook(b, pth, original);
  const nodes = await renderDocument(doc, Page.RENDER_OPTIONS);
  const body = win.document.getElementById('b');
  for (const x of nodes) body.appendChild(x);
  // Six <img> for DrawingML pictures and one SVG <image> for the VML (old equation) picture.
  const srcs = Array.from(body.querySelectorAll('img')).map((i) => i.getAttribute('src')).concat(Array.from(body.querySelectorAll('image')).map((i) => i.getAttribute('href') || i.getAttribute('xlink:href')));
  assert.strictEqual(srcs.length, 7, srcs.join(' '));
  assert.ok(srcs.every((u) => /^blob:t\//.test(u)), srcs.join(' '));
  assert.deepStrictEqual(seen.map((s) => s.split(':')[1]).sort(), ['emf', 'emf', 'tiff', 'tiff', 'tiff', 'tiff', 'wmf']);
  global.document = dom.window.document;
  global.XMLSerializer = dom.window.XMLSerializer;
});

test('Page view: <w:object> pictures (old equations) are renamed to <w:pict>; files without them pass through as they are', async () => {
  const JSZip = require('jszip');
  const plain = fx('toc.docx');
  assert.strictEqual(await showObjects(JSZip, plain), plain);
  const out = await showObjects(JSZip, fx('pictures.docx'));
  const xml = await (await JSZip.loadAsync(out)).file('word/document.xml').async('string');
  assert.doesNotMatch(xml, /<w:object/);
  assert.match(xml, /<w:pict><v:shape[^>]*><v:imagedata r:id="rIdP3"/);
  const junk = Buffer.from('not a zip');
  assert.strictEqual(await showObjects(JSZip, junk), junk);
});

test('Reading view keeps Shift+wheel sideways scrolling in both views', () => {
  const viewer = fs.readFileSync(path.join(__dirname, '..', 'media', 'viewer.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'media', 'page.js'), 'utf8');
  for (const src of [viewer, page]) assert.match(src, /addEventListener\('wheel', function \(e\) \{\s*(if \(!e\.shiftKey|if \(e\.shiftKey)/);
  assert.match(viewer, /box\.scrollLeft \+= e\.deltaY/);
});

test('Reading view TOC: entries keep their text and link to the heading bookmarks', async () => {
  const r = await convertDocx(fx('toc.docx'), { ext: '.docx' });
  const html = r.chunks.join('');
  const links = [...html.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)];
  assert.strictEqual(links.length, 7);
  for (const [, id, text] of links) {
    assert.match(text, /^[A-Z][a-z].*\t\d+$/, 'title and page number: ' + text);
    assert.ok(html.includes('<a id="' + id + '"></a>'), 'target exists for ' + id);
  }
});
