'use strict';
// EMF, WMF and TIFF pictures inside Word files. Browsers cannot show these formats, so both
// webviews (Reading view and Page view) turn them into something they can show:
//   EMF -> SVG text, by src/emf.js (no DOM needed);
//   WMF -> SVG, drawn by WMFJS from rtf.js (MIT), which needs a DOM;
//   TIFF -> PNG, decoded by UTIF.js (MIT), first page only.
// Bundled into media/pictures.js (window.DocxPictures) by scripts/build.js; also loaded by the
// unit tests in Node with jsdom.
//
// Every picture is checked before a decoder sees it: record sizes, record count, embedded bitmap
// sizes, TIFF pixel count, strip bounds. LZW and Deflate run with an end-of-input and an output
// limit. A picture that fails a check is refused with a short reason instead of a hang.

const WMFJS = require('rtf.js/dist/WMFJS.bundle.js');
const UTIF = require('utif');
const pako = require('pako');
const { sniff, kindOfType } = require('./picture-kind');
const { emfToSvgText } = require('./emf');

WMFJS.loggingEnabled(false);

const LIMITS = {
  maxBytes: 20 * 1024 * 1024, // docxViewer.maxImageSizeMB
  maxRecords: 200000, // EMF/WMF records in one picture
  maxBitmapPixels: 40000000, // a bitmap inside an EMF/WMF
  maxPixels: 40000000, // a TIFF page (40 MP is 160 MB as RGBA)
  maxSide: 4000 // CSS pixels for the drawn SVG; bigger declared sizes are scaled down
};

const SVGNS = 'http://www.w3.org/2000/svg';
const NAMES = { emf: 'EMF', wmf: 'WMF', tiff: 'TIFF' };

class PictureError extends Error {}
function fail(msg) { throw new PictureError(msg); }

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function i32(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); }
function i16(b, o) { const v = u16(b, o); return v > 0x7fff ? v - 0x10000 : v; }

// ---------- EMF ----------
// Records with a DIB inside, and where its BITMAPINFOHEADER offset field sits in the record.
const EMF_BMI = { 76: 84, 77: 84, 78: 84, 79: 96, 80: 48, 81: 48, 114: 84, 116: 84, 93: 16, 94: 16 };

function dibPixels(b, at, end) {
  if (at < 0 || at + 12 > end) return 0;
  const size = u32(b, at);
  if (size === 12) return u16(b, at + 4) * u16(b, at + 6);
  if (size < 16 || at + 12 > end) return 0;
  return Math.abs(i32(b, at + 4)) * Math.abs(i32(b, at + 8));
}

// Walks the records once. Returns what the renderer needs, or throws PictureError.
function preflightEmf(b, limits) {
  const L = Object.assign({}, LIMITS, limits || {});
  if (b.length < 88) fail('the file is too short');
  const hdr = u32(b, 4);
  if (hdr < 88 || hdr > b.length || hdr % 4) fail('the header is damaged');
  let pos = hdr;
  let count = 0;
  let draw = 0;
  let plus = 0;
  let eof = false;
  while (pos + 8 <= b.length) {
    const type = u32(b, pos);
    const size = u32(b, pos + 4);
    if (size < 8 || size % 4 || pos + size > b.length) break; // damaged or cut off: draw what came before
    if (++count > L.maxRecords) fail('it has more than ' + L.maxRecords + ' drawing records');
    if (type === 14) { eof = true; pos += size; break; }
    if (type === 70) {
      if (size >= 16 && u32(b, pos + 12) === 0x2b464d45) plus++; // "EMF+" comment
    } else if (type !== 1 && type >= 2 && type <= 122) {
      draw++;
      if (EMF_BMI[type] && pos + EMF_BMI[type] + 4 <= pos + size) {
        const off = u32(b, pos + EMF_BMI[type]);
        if (off && dibPixels(b, pos + off, pos + size) > L.maxBitmapPixels) fail('a bitmap inside it is too large');
      }
    } else if (type > 122) {
      fail('it has an unknown record type');
    }
    pos += size;
  }
  if (!draw) fail(plus ? 'it has only EMF+ records, without the plain EMF copy' : 'it has nothing to draw');
  const bounds = { left: i32(b, 8), top: i32(b, 12), right: i32(b, 16), bottom: i32(b, 20) };
  const frame = { left: i32(b, 24), top: i32(b, 28), right: i32(b, 32), bottom: i32(b, 36) };
  const dev = { cx: i32(b, 64), cy: i32(b, 68) };
  const mm = { cx: i32(b, 72), cy: i32(b, 76) };
  // The picture box in device units: rclFrame (0.01 mm) through the reference device, like Word.
  let box = null;
  if (frame.right > frame.left && frame.bottom > frame.top && dev.cx > 0 && dev.cy > 0 && mm.cx > 0 && mm.cy > 0) {
    const sx = dev.cx / (mm.cx * 100);
    const sy = dev.cy / (mm.cy * 100);
    box = { x: frame.left * sx, y: frame.top * sy, w: (frame.right - frame.left) * sx, h: (frame.bottom - frame.top) * sy };
  }
  if (!box || !(box.w >= 1 && box.h >= 1) || !isFinite(box.w + box.h + box.x + box.y)) {
    if (bounds.right < bounds.left || bounds.bottom < bounds.top) fail('its size is missing');
    box = { x: bounds.left, y: bounds.top, w: bounds.right - bounds.left + 1, h: bounds.bottom - bounds.top + 1 };
  }
  // Display size: the frame in CSS pixels (96 per inch), or the device box when there is no frame.
  let w = frame.right > frame.left ? (frame.right - frame.left) / 2540 * 96 : box.w;
  let h = frame.bottom > frame.top ? (frame.bottom - frame.top) / 2540 * 96 : box.h;
  const size = fitSize(w, h, L.maxSide);
  return { end: pos, eof, records: count, emfPlus: plus, box, width: size.w, height: size.h };
}

// Keeps the aspect ratio, at most maxSide on the long side, at least 1 px.
function fitSize(w, h, maxSide) {
  if (!(w > 0) || !(h > 0) || !isFinite(w) || !isFinite(h)) return { w: 300, h: 150 };
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// A copy that ends in a proper EOF record: cut-off files draw what they have.
function withEof(b, end) {
  const out = new Uint8Array(end + 20);
  out.set(b.subarray(0, end));
  const dv = new DataView(out.buffer);
  dv.setUint32(end, 14, true);
  dv.setUint32(end + 4, 20, true);
  dv.setUint32(end + 12, 16, true);
  dv.setUint32(end + 16, 20, true);
  dv.setUint32(48, end + 20, true); // nBytes in the header
  return out;
}

function emfToSvg(b, limits) {
  const p = preflightEmf(b, limits);
  const bytes = p.eof ? b.slice(0, p.end) : withEof(b, p.end);
  let svg;
  try {
    svg = emfToSvgText(bytes, p.box, { width: p.width, height: p.height }, { base64 });
  } catch (err) {
    fail('the drawing code stopped: ' + String((err && err.message) || err).slice(0, 120));
  }
  return { svg, width: p.width, height: p.height, records: p.records };
}

// Uint8Array -> base64 without one huge argument list.
function base64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- WMF ----------
// Records with a DIB inside: function number -> offset of the BITMAPINFOHEADER from the record start.
const WMF_DIB = { 0x0f43: 28, 0x0b41: 26, 0x0940: 22, 0x0d33: 24, 0x0142: 10 };

function preflightWmf(b, limits) {
  const L = Object.assign({}, LIMITS, limits || {});
  let at = 0;
  let placeable = null;
  if (b.length >= 22 && u32(b, 0) === 0x9ac6cdd7) {
    placeable = { left: i16(b, 6), top: i16(b, 8), right: i16(b, 10), bottom: i16(b, 12), inch: u16(b, 14) };
    at = 22;
  }
  if (b.length < at + 18) fail('the file is too short');
  if (u16(b, at + 2) !== 9) fail('the header is damaged');
  let pos = at + 18;
  let count = 0;
  let draw = 0;
  let eof = false;
  let win = null;
  let org = { x: 0, y: 0 };
  while (pos + 6 <= b.length) {
    const words = u32(b, pos);
    const fn = u16(b, pos + 4);
    if (fn === 0) { eof = true; pos += 6; break; }
    if (words < 3 || pos + words * 2 > b.length) break;
    if (++count > L.maxRecords) fail('it has more than ' + L.maxRecords + ' drawing records');
    if (fn === 0x020c && words >= 5) win = { h: i16(b, pos + 6), w: i16(b, pos + 8) };
    else if (fn === 0x020b && words >= 5) org = { y: i16(b, pos + 6), x: i16(b, pos + 8) };
    else draw++;
    const dib = WMF_DIB[fn];
    if (dib && words * 2 > dib + 12 && dibPixels(b, pos + dib, pos + words * 2) > L.maxBitmapPixels) fail('a bitmap inside it is too large');
    pos += words * 2;
  }
  if (!draw) fail('it has nothing to draw');
  let win2 = null;
  let w;
  let h;
  if (placeable && placeable.right !== placeable.left && placeable.bottom !== placeable.top) {
    win2 = { x: Math.min(placeable.left, placeable.right), y: Math.min(placeable.top, placeable.bottom), w: Math.abs(placeable.right - placeable.left), h: Math.abs(placeable.bottom - placeable.top) };
    const inch = placeable.inch > 0 ? placeable.inch : 1440;
    w = win2.w / inch * 96;
    h = win2.h / inch * 96;
  } else if (win && win.w && win.h) {
    win2 = { x: org.x, y: org.y, w: Math.abs(win.w), h: Math.abs(win.h) };
    // No physical size in the file: assume twips when the numbers are big, else pixels.
    const k = Math.max(win2.w, win2.h) > 2000 ? 96 / 1440 : 1;
    w = win2.w * k;
    h = win2.h * k;
  } else {
    fail('its size is missing');
  }
  const size = fitSize(w, h, L.maxSide);
  return { end: pos, eof, records: count, window: win2, width: size.w, height: size.h };
}

function wmfToSvg(b, limits) {
  const p = preflightWmf(b, limits);
  let bytes = b.slice(0, p.end);
  if (!p.eof) { // cut off: add the end record
    const out = new Uint8Array(p.end + 6);
    out.set(bytes);
    out[p.end] = 3;
    bytes = out;
  }
  let svg;
  try {
    const r = new WMFJS.Renderer(bytes.buffer);
    // The placeable header (or the first SetWindowExt) sets the logical window; records may change it.
    const img = r._img;
    if (img && typeof img.render === 'function') {
      const play = img.render.bind(img);
      img.render = function (gdi) {
        gdi.setWindowOrg(p.window.x, p.window.y);
        gdi.setWindowExt(p.window.w, p.window.h);
        play(gdi);
      };
    }
    svg = r.render({ width: p.width + 'px', height: p.height + 'px', xExt: p.width, yExt: p.height, mapMode: 8 });
  } catch (err) {
    fail('the drawing code stopped: ' + String((err && err.message) || err).slice(0, 120));
  }
  return { svg: serialize(svg), width: p.width, height: p.height, records: p.records };
}

function serialize(svg) {
  const s = new XMLSerializer().serializeToString(svg);
  if (s.length > 64 * 1024 * 1024) fail('the drawing is too large');
  return s;
}

// ---------- TIFF ----------
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8 };
// Tags UTIF needs to decode one page. Everything else (EXIF, maker notes, sub-IFDs) is skipped.
const TIFF_TAGS = new Set([254, 256, 257, 258, 259, 262, 266, 273, 277, 278, 279, 284, 317, 320, 322, 323, 324, 325, 338, 339, 347, 512, 513, 514, 529, 530, 531, 532]);
const COMPRESSIONS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 32773, 32946]);

// Reads the first IFD (page 1) into UTIF's { tNNN: [...] } shape, with every count and offset checked.
function readFirstIfd(b, limits) {
  const L = Object.assign({}, LIMITS, limits || {});
  if (b.length < 8) fail('the file is too short');
  const le = b[0] === 0x49;
  const r16 = le ? (o) => b[o] | (b[o + 1] << 8) : (o) => (b[o] << 8) | b[o + 1];
  const r32 = le ? (o) => u32(b, o) : (o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const ifd0 = r32(4);
  if (ifd0 < 8 || ifd0 + 2 > b.length) fail('the first page is missing');
  const n = r16(ifd0);
  if (!n || ifd0 + 2 + n * 12 > b.length) fail('the first page is damaged');
  const img = {};
  for (let i = 0; i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    const tag = r16(e);
    if (!TIFF_TAGS.has(tag)) continue;
    const type = r16(e + 2);
    const num = r32(e + 4);
    const sz = TYPE_SIZE[type];
    if (!sz || num > 4000000) fail('a page field is damaged');
    const bytes = sz * num;
    const off = bytes <= 4 ? e + 8 : r32(e + 8);
    if (off + bytes > b.length) fail('a page field points past the end of the file');
    let arr;
    if (type === 1 || type === 7 || type === 6) arr = b.subarray(off, off + num);
    else if (type === 2) arr = [String.fromCharCode.apply(null, Array.from(b.subarray(off, off + Math.min(num, 1000)))).replace(/\0+$/, '')];
    else {
      arr = new Array(num);
      for (let j = 0; j < num; j++) {
        const o = off + j * sz;
        if (type === 3) arr[j] = r16(o);
        else if (type === 8) { const v = r16(o); arr[j] = v > 0x7fff ? v - 0x10000 : v; }
        else if (type === 4 || type === 13) arr[j] = r32(o);
        else if (type === 9) arr[j] = r32(o) | 0;
        else if (type === 5) arr[j] = r32(o) / (r32(o + 4) || 1);
        else if (type === 10) arr[j] = (r32(o) | 0) / ((r32(o + 4) | 0) || 1);
        else arr[j] = 0;
      }
    }
    img['t' + tag] = arr;
  }
  const w = img.t256 && img.t256[0];
  const h = img.t257 && img.t257[0];
  if (!w || !h) fail('the page has no size');
  if (w * h > L.maxPixels) fail('the page is ' + w + ' x ' + h + ' pixels, more than the ' + Math.round(L.maxPixels / 1e6) + ' megapixel limit');
  const cmpr = img.t259 ? img.t259[0] : 1;
  if (!COMPRESSIONS.has(cmpr)) fail('compression type ' + cmpr + ' is not supported');
  const bps = img.t258 ? img.t258.reduce((s, v) => s + v, 0) : 1;
  if (!(bps >= 1 && bps <= 64)) fail('the bit depth is not supported');
  const offs = img.t273 || img.t324;
  const cnts = img.t279 || img.t325;
  if (!offs || !offs.length) fail('the page has no image data');
  if (img.t322) {
    const tw = img.t322[0];
    const th = img.t323 && img.t323[0];
    if (!tw || !th || tw * th > L.maxPixels) fail('the tiles are damaged');
    if (offs.length < Math.ceil(w / tw) * Math.ceil(h / th)) fail('tiles are missing');
  }
  if (cnts && cnts.length < offs.length && cmpr !== 1) fail('the strip table is damaged');
  // Strips that start past the end are dropped; strips that run past the end are shortened.
  if (cnts) for (let i = 0; i < offs.length; i++) {
    if (offs[i] >= b.length) { offs[i] = 0; cnts[i] = 0; } else if (offs[i] + (cnts[i] || 0) > b.length) cnts[i] = b.length - offs[i];
  }
  img.isLE = le;
  return img;
}

// LZW (TIFF flavour) with an end-of-input check and an output limit. Same table logic as
// UTIF.decode._decodeLZW, which has neither and can spin forever on a damaged strip.
let lzwTables = null;
function lzw(data, off, len, tgt, toff) {
  if (!lzwTables) {
    lzwTables = [new Uint32Array(4096), new Uint16Array(4096), new Uint8Array(4096 * 4096 / 2 + 65536)];
    for (let i = 0; i < 256; i++) { lzwTables[2][i << 2] = i; lzwTables[0][i] = i << 2; lzwTables[1][i] = 1; }
  }
  const [tab, tln, chr] = lzwTables;
  let totl = 258;
  let chrl = 258 << 2;
  let bits = 9;
  let boff = off << 3;
  const endBits = (off + len) << 3;
  const tEnd = tgt.length;
  let old = 0;
  const rd = () => {
    const v = ((data[boff >>> 3] | 0) << 16) | ((data[(boff + 8) >>> 3] | 0) << 8) | (data[(boff + 16) >>> 3] | 0);
    const c = (v >> (24 - (boff & 7) - bits)) & ((1 << bits) - 1);
    boff += bits;
    return c;
  };
  const put = (src, so, l) => { for (let i = 0; i < l && toff < tEnd; i++) tgt[toff++] = src[so + i]; };
  while (boff + bits <= endBits && toff < tEnd) {
    let code = rd();
    if (code === 257) break;
    if (code === 256) {
      bits = 9; totl = 258; chrl = 258 << 2;
      if (boff + bits > endBits) break;
      code = rd();
      if (code === 257) break;
      if (code > 255) break; // damaged: a code right after Clear must be a literal
      tgt[toff++] = code;
      old = code;
      continue;
    }
    if (totl >= 4095 || chrl + 8192 >= chr.length) break; // the encoder should have sent Clear
    if (code < totl) {
      const cd = tab[code];
      const cl = tln[code];
      put(chr, cd, cl);
      tab[totl] = chrl;
      const nit = tab[old];
      const nil = tln[old];
      for (let i = 0; i < nil; i++) chr[chrl + i] = chr[nit + i];
      chr[chrl + nil] = chr[cd];
      tln[totl] = nil + 1;
      totl++;
      chrl = (chrl + nil + 1 + 3) & ~3;
    } else {
      tab[totl] = chrl;
      const nit = tab[old];
      const nil = tln[old];
      for (let i = 0; i < nil; i++) chr[chrl + i] = chr[nit + i];
      chr[chrl + nil] = chr[chrl];
      tln[totl] = nil + 1;
      totl++;
      put(chr, chrl, nil + 1);
      chrl = (chrl + nil + 1 + 3) & ~3;
    }
    if (totl + 1 === (1 << bits) && bits < 12) bits++;
    old = code;
  }
}

// Deflate with an output limit: a small strip cannot expand past the page buffer.
function inflate(data, off, len, tgt, toff) {
  const room = tgt.length - toff;
  if (room <= 0) return;
  const inf = new pako.Inflate({ chunkSize: 65536 });
  let at = toff;
  inf.onData = function (chunk) {
    const n = Math.min(chunk.length, tgt.length - at);
    if (n > 0) tgt.set(n === chunk.length ? chunk : chunk.subarray(0, n), at);
    at += n;
    if (at >= tgt.length) throw new PictureError('full');
  };
  try { inf.push(data.subarray(off, off + len), true); } catch (err) { if (!(err instanceof PictureError)) throw err; }
}

let guarded = false;
function guardUtif() {
  if (guarded) return;
  guarded = true;
  const orig = UTIF.decode._decompress;
  UTIF.decode._decompress = function (img, ifds, data, off, len, cmpr, tgt, toff, fo) {
    if (!(off >= 0) || off >= data.length || !(len > 0)) return;
    len = Math.min(len, data.length - off);
    if (cmpr === 5 || cmpr === 8 || cmpr === 32946) {
      if (cmpr === 5) lzw(data, off, len, tgt, toff);
      else inflate(data, off, len, tgt, toff);
      // Byte order and predictor fix-ups: the original code with nothing left to copy.
      return orig.call(this, img, ifds, data, off, 0, 1, tgt, toff, fo);
    }
    return orig.call(this, img, ifds, data, off, len, cmpr, tgt, toff, fo);
  };
}

// JPEG TIFFs (compression 7, strips): each strip is a small JPEG file once the shared JPEGTables
// go in after its SOI marker. The browser's own decoder draws them; UTIF's JPEG path gets the
// colors of many such files wrong. Returns null for every other TIFF.
function tiffJpeg(b, limits) {
  const img = readFirstIfd(b, limits);
  if (!img.t259 || img.t259[0] !== 7 || img.t322) return null;
  const offs = img.t273;
  const cnts = img.t279;
  if (!offs || !cnts || cnts.length < offs.length) return null;
  const tables = img.t347;
  const mid = tables && tables.length >= 4 && tables[0] === 0xff && tables[1] === 0xd8 ? tables.subarray(2, tables.length - 2) : null;
  // Photometric RGB: the samples were not converted to YCbCr. An Adobe marker with transform 0
  // tells the decoder so; without it, it would convert them and get the colors wrong.
  const adobe = img.t262 && img.t262[0] === 2 ? Uint8Array.from([0xff, 0xee, 0, 14, 0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 0]) : new Uint8Array(0);
  const extra = (mid ? mid.length : 0) + adobe.length;
  const strips = [];
  for (let i = 0; i < offs.length; i++) {
    const strip = b.subarray(offs[i], offs[i] + cnts[i]);
    if (strip.length < 4 || strip[0] !== 0xff || strip[1] !== 0xd8) return null;
    const out = new Uint8Array(strip.length + extra);
    out.set(strip.subarray(0, 2));
    out.set(adobe, 2);
    if (mid) out.set(mid, 2 + adobe.length);
    out.set(strip.subarray(2), 2 + extra);
    strips.push(out);
  }
  const width = img.t256[0];
  const height = img.t257[0];
  return { width, height, rows: Math.min(height, img.t278 ? img.t278[0] : height), strips };
}

// First page of a TIFF as RGBA. Returns { rgba: Uint8Array, width, height, pages }.
function decodeTiff(b, limits) {
  guardUtif();
  const img = readFirstIfd(b, limits);
  try {
    UTIF.decodeImage(b.buffer.byteLength === b.length && b.byteOffset === 0 ? b.buffer : b.slice().buffer, img, [img]);
    if (!img.data) fail('the page has no image data');
    // JPEG strips come out of the JPEG decoder as RGB already; the YCbCr tag would convert them twice.
    if ((img.t259 && (img.t259[0] === 7 || img.t259[0] === 6)) && img.t262 && img.t262[0] === 6) img.t262 = [2];
    const rgba = UTIF.toRGBA8(img);
    return { rgba, width: img.width, height: img.height };
  } catch (err) {
    if (err instanceof PictureError) throw err;
    fail('the decoder stopped: ' + String((err && err.message) || err).slice(0, 120));
  }
}

// ---------- webview side ----------
// Draws one picture. kind: 'emf' | 'wmf' | 'tiff'. Resolves to a Blob the <img> can show.
function draw(bytes, kind, limits) {
  const L = Object.assign({}, LIMITS, limits || {});
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Promise(function (resolve) {
    if (b.length > L.maxBytes) fail('it is over the ' + Math.round(L.maxBytes / 1048576) + ' MB picture limit');
    const real = sniff(b); // the bytes decide; the name or type in the file may be wrong
    if (!real) fail('the bytes are not an EMF, WMF or TIFF picture');
    if (real === 'emf') return resolve(new Blob([emfToSvg(b, L).svg], { type: 'image/svg+xml' }));
    if (real === 'wmf') return resolve(new Blob([wmfToSvg(b, L).svg], { type: 'image/svg+xml' }));
    if (real === 'tiff') {
      const jpeg = tiffJpeg(b, L);
      if (jpeg) return resolve(drawJpegStrips(jpeg));
      const t = decodeTiff(b, L);
      const canvas = document.createElement('canvas');
      canvas.width = t.width;
      canvas.height = t.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) fail('the browser has no canvas');
      ctx.putImageData(new ImageData(new Uint8ClampedArray(t.rgba.buffer, t.rgba.byteOffset, t.width * t.height * 4), t.width, t.height), 0, 0);
      // toDataURL is synchronous: toBlob callbacks were slow in a webview that is still laying out.
      const url = canvas.toDataURL('image/png');
      canvas.width = 1;
      canvas.height = 1;
      return resolve(dataUrlBlob(url));
    }
    fail('the bytes are not an EMF, WMF or TIFF picture');
  }).then(function (blob) {
    if (!blob) fail('the browser could not make the picture');
    return blob;
  });
}

function dataUrlBlob(url) {
  const i = url.indexOf(',');
  if (i < 0 || url.slice(0, i).indexOf('image/png') < 0) return null;
  const bin = atob(url.slice(i + 1));
  const out = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
  return new Blob([out], { type: 'image/png' });
}

async function drawJpegStrips(j) {
  if (j.strips.length === 1) return new Blob([j.strips[0]], { type: 'image/jpeg' });
  const canvas = document.createElement('canvas');
  canvas.width = j.width;
  canvas.height = j.height;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof createImageBitmap !== 'function') fail('the browser has no canvas');
  for (let i = 0; i < j.strips.length; i++) {
    let bmp;
    try { bmp = await createImageBitmap(new Blob([j.strips[i]], { type: 'image/jpeg' })); } catch (_) { continue; } // a damaged strip stays white
    ctx.drawImage(bmp, 0, i * j.rows);
    if (bmp.close) bmp.close();
  }
  const png = dataUrlBlob(canvas.toDataURL('image/png'));
  canvas.width = 1;
  canvas.height = 1;
  return png;
}

function label(kind) { return NAMES[kind] || 'picture'; }

// Text for the placeholder: "Picture could not be drawn (EMF): <reason>".
function message(kind, err) {
  const why = err instanceof PictureError || (err && err.message) ? String(err.message) : 'unknown error';
  return 'Picture could not be drawn (' + label(kind) + '): ' + why.slice(0, 160);
}

// A small SVG box with that text, for Page view, where the slot must stay an <img>.
function placeholderSvg(kind, width, height) {
  const w = Math.max(120, Math.min(600, width || 240));
  const h = Math.max(40, Math.min(400, height || 60));
  const t = 'Picture could not be drawn (' + label(kind) + ')';
  return '<svg xmlns="' + SVGNS + '" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
    '<rect x="1" y="1" width="' + (w - 2) + '" height="' + (h - 2) + '" fill="#f3f3f3" stroke="#999" stroke-dasharray="4 3"/>' +
    '<text x="' + (w / 2) + '" y="' + (h / 2 + 4) + '" font-family="sans-serif" font-size="12" fill="#555" text-anchor="middle">' + t + '</text></svg>';
}

module.exports = { LIMITS, sniff, kindOfType, preflightEmf, preflightWmf, emfToSvg, wmfToSvg, readFirstIfd, decodeTiff, tiffJpeg, lzw, inflate, draw, message, placeholderSvg, label, PictureError };
