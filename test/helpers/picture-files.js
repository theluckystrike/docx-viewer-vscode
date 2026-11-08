'use strict';
// Builds small EMF, WMF and TIFF files for the picture tests and samples, and hostile ones
// (cut-off files, huge declared sizes, record floods, bitmap and Deflate bombs, broken LZW).
const pako = require('pako');

// ---------- EMF ----------
function rec(type, body) {
  const size = 8 + body.length + ((4 - (body.length % 4)) % 4);
  const b = Buffer.alloc(size);
  b.writeUInt32LE(type, 0);
  b.writeUInt32LE(size, 4);
  body.copy(b, 8);
  return b;
}
function ints(...v) { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeInt32LE(x, i * 4)); return b; }
function rgb(r, g, b) { return Buffer.from([r, g, b, 0]); }
function utf16(s) { return Buffer.from(s, 'utf16le'); }

function emfHeader(opts, nBytes, nRecords) {
  const h = Buffer.alloc(88);
  h.writeUInt32LE(1, 0);
  h.writeUInt32LE(88, 4);
  const bd = opts.bounds || [0, 0, 191, 95];
  const fr = opts.frame || [0, 0, 5080, 2540]; // 0.01 mm: 50.8 x 25.4 mm = 192 x 96 px
  bd.forEach((v, i) => h.writeInt32LE(v, 8 + i * 4));
  fr.forEach((v, i) => h.writeInt32LE(v, 24 + i * 4));
  h.writeUInt32LE(0x464d4520, 40);
  h.writeUInt32LE(0x10000, 44);
  h.writeUInt32LE(nBytes, 48);
  h.writeUInt32LE(nRecords, 52);
  h.writeUInt16LE(8, 56);
  h.writeInt32LE(1920, 64); h.writeInt32LE(1080, 68); // device pixels
  h.writeInt32LE(508, 72); h.writeInt32LE(286, 76); // device millimeters: 96 dpi
  return h;
}
function emf(records, opts) {
  const o = opts || {};
  const all = records.concat(o.noEof ? [] : [rec(14, ints(0, 16, 20))]);
  const body = Buffer.concat(all);
  return Buffer.concat([emfHeader(o, 88 + body.length, all.length + 1), body]);
}
function logFont(height, weight, face) {
  const f = Buffer.alloc(92);
  f.writeInt32LE(height, 0);
  f.writeInt32LE(weight, 16);
  utf16(face).copy(f, 28);
  return f;
}
function extTextOut(x, y, text, dx) {
  const n = text.length;
  const offStr = 8 + 68; // record header + fixed part
  const str = utf16(text);
  const pad = (4 - (str.length % 4)) % 4;
  const offDx = offStr + str.length + pad;
  const fixed = Buffer.concat([ints(0, 0, -1, -1), ints(1), Buffer.alloc(8), ints(x, y, n, offStr, 0, 0, 0, 0, 0, dx ? offDx : 0)]);
  return rec(84, Buffer.concat([fixed, str, Buffer.alloc(pad), dx ? ints(...text.split('').map(() => dx)) : Buffer.alloc(0)]));
}
// A 2x2 24-bit DIB: red, green / blue, yellow (bottom-up rows).
function dib2x2() {
  const bmi = Buffer.alloc(40);
  bmi.writeUInt32LE(40, 0); bmi.writeInt32LE(2, 4); bmi.writeInt32LE(2, 8); bmi.writeUInt16LE(1, 12); bmi.writeUInt16LE(24, 14);
  const bits = Buffer.from([255, 0, 0, 0, 255, 255, 0, 0, /* row 0 (bottom): blue, yellow */ 0, 0, 255, 0, 255, 0, 0, 0 /* row 1: red, green */]);
  return { bmi, bits };
}
function stretchDibits(x, y, w, h, bmiOverride) {
  const { bmi, bits } = dib2x2();
  const b = bmiOverride || bmi;
  const fixed = Buffer.concat([ints(0, 0, -1, -1), ints(x, y, 0, 0, 2, 2), ints(8 + 72, b.length, 8 + 72 + b.length, bits.length, 0, 0x00cc0020, w, h)]);
  return rec(81, Buffer.concat([fixed, b, bits]));
}

// The sample: a framed box, a circle, a zigzag, a bitmap and two lines of text, in a 2000 x 1000
// logical window shown at 192 x 96 device pixels.
function sampleEmf(opts) {
  const o = opts || {};
  const zig = Buffer.alloc(4 * 2 * 5);
  [[100, 950], [500, 700], [900, 950], [1300, 700], [1700, 950]].forEach(([x, y], i) => { zig.writeInt16LE(x, i * 4); zig.writeInt16LE(y, i * 4 + 2); });
  const records = [
    rec(17, ints(8)),
    rec(9, ints(2000, 1000)),
    rec(11, ints(192, 96)),
    rec(38, Buffer.concat([ints(1, 0, 20, 0), rgb(0x1f, 0x4e, 0x79)])),
    rec(39, Buffer.concat([ints(2, 0), rgb(0xdd, 0xeb, 0xf7), ints(0)])),
    rec(37, ints(1)), rec(37, ints(2)),
    rec(43, ints(40, 40, 1960, 960)),
    rec(39, Buffer.concat([ints(3, 0), rgb(0xf4, 0xb1, 0x83), ints(0)])),
    rec(37, ints(3)),
    rec(42, ints(1500, 100, 1900, 500)),
    rec(87, Buffer.concat([ints(0, 0, 0, 0, 5), zig])),
    stretchDibits(1550, 550, 300, 300),
    rec(82, Buffer.concat([ints(4), logFont(-110, 700, 'Arial')])),
    rec(37, ints(4)),
    rec(18, ints(1)),
    rec(22, ints(24)),
    rec(24, rgb(0x20, 0x20, 0x20)),
    extTextOut(120, 300, o.text || 'EMF picture drawn'),
    extTextOut(120, 520, 'with advances', 70)
  ];
  if (o.plus) records.unshift(rec(70, Buffer.concat([ints(24), Buffer.from('EMF+'), Buffer.from([1, 0x40, 1, 0, 28, 0, 0, 0, 16, 0, 0, 0, 2, 16, 0xc0, 0xdb, 0, 0, 0, 0, 0x60, 0, 0, 0])])));
  return emf(records, o);
}
// EMF+ only: GDI comments with EMF+ records and nothing to draw in plain EMF.
function emfPlusOnly() {
  return emf([rec(70, Buffer.concat([ints(24), Buffer.from('EMF+'), Buffer.alloc(20)])), rec(70, Buffer.concat([ints(24), Buffer.from('EMF+'), Buffer.alloc(20)]))]);
}

// ---------- hostile EMF ----------
const hostile = {
  emfTruncated: () => { const b = sampleEmf(); return b.subarray(0, Math.floor(b.length * 0.62)); },
  emfHugeBounds: () => sampleEmf({ frame: [0, 0, 2147483000, 2147483000], bounds: [0, 0, 2147483000, 2147483000] }),
  emfZeroRecord: () => { const b = Buffer.concat([emfHeader({}, 104, 2), Buffer.alloc(16)]); return b; }, // first record has size 0
  emfRecordFlood: (n) => emf(Array.from({ length: n || 250000 }, () => rec(18, ints(1))).concat([rec(43, ints(0, 0, 10, 10))])),
  emfBitmapBomb: () => {
    const bmi = Buffer.alloc(40);
    bmi.writeUInt32LE(40, 0); bmi.writeInt32LE(100000, 4); bmi.writeInt32LE(100000, 8); bmi.writeUInt16LE(1, 12); bmi.writeUInt16LE(24, 14); bmi.writeUInt32LE(1, 16); // RLE8: small data, huge picture
    return emf([rec(43, ints(0, 0, 10, 10)), stretchDibits(0, 0, 100, 100, bmi)]);
  },
  emfNotEmf: () => Buffer.from('EMF? no, just text that is long enough to look at.'),
  wmfZeroRecord: () => { const w = sampleWmf(); w.writeUInt32LE(0, 22 + 18); return w; },
  wmfTruncated: () => { const w = sampleWmf(); return w.subarray(0, Math.floor(w.length * 0.6)); },
  tiffHuge: () => tiff({ w: 100000, h: 100000, spp: 1, bps: 1, photometric: 1, data: Buffer.alloc(16), compression: 1, raw: true }),
  tiffIfdLoop: () => { const t = tiff({ w: 4, h: 4, spp: 3, bps: 8, photometric: 2, data: Buffer.alloc(48, 200) }); const ifd = t.readUInt32LE(4); const n = t.readUInt16LE(ifd); t.writeUInt32LE(ifd, ifd + 2 + n * 12); return t; },
  tiffBadIfd: () => { const t = Buffer.alloc(16); t.write('II', 0); t.writeUInt16LE(42, 2); t.writeUInt32LE(8, 4); t.writeUInt16LE(65535, 8); return t; },
  tiffLzwGarbage: () => { const g = Buffer.alloc(4096); let x = 12345; for (let i = 0; i < g.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; g[i] = x >> 16; } return tiff({ w: 512, h: 512, spp: 1, bps: 8, photometric: 1, data: g, compression: 5, raw: true }); },
  tiffDeflateBomb: () => tiff({ w: 64, h: 64, spp: 1, bps: 8, photometric: 1, data: Buffer.from(pako.deflate(new Uint8Array(64 * 1024 * 1024))), compression: 8, raw: true })
};

// ---------- WMF ----------
function wrec(fn, body) {
  const pad = body.length % 2;
  const words = 3 + (body.length + pad) / 2;
  const b = Buffer.alloc(words * 2);
  b.writeUInt32LE(words, 0);
  b.writeUInt16LE(fn, 4);
  body.copy(b, 6);
  return b;
}
function shorts(...v) { const b = Buffer.alloc(v.length * 2); v.forEach((x, i) => b.writeInt16LE(x, i * 2)); return b; }
function sampleWmf(text) {
  const font = Buffer.alloc(50);
  font.writeInt16LE(-160, 0); font.writeInt16LE(700, 8);
  Buffer.from('Arial').copy(font, 18);
  const t = Buffer.from(text || 'WMF picture drawn', 'latin1');
  const tp = t.length % 2 ? Buffer.concat([t, Buffer.alloc(1)]) : t;
  const records = [
    wrec(0x020b, shorts(0, 0)), // SetWindowOrg (y, x)
    wrec(0x020c, shorts(1000, 2000)), // SetWindowExt (y, x)
    wrec(0x02fa, Buffer.concat([shorts(0, 20, 0), rgb(0x38, 0x57, 0x23)])), // CreatePenIndirect -> 0
    wrec(0x012d, shorts(0)),
    wrec(0x02fc, Buffer.concat([shorts(0), rgb(0xe2, 0xef, 0xd9), shorts(0)])), // CreateBrushIndirect -> 1
    wrec(0x012d, shorts(1)),
    wrec(0x041b, shorts(960, 1960, 40, 40)), // Rectangle (bottom, right, top, left)
    wrec(0x0418, shorts(900, 1900, 500, 1500)), // Ellipse
    wrec(0x02fb, font), // CreateFontIndirect -> 2
    wrec(0x012d, shorts(2)),
    wrec(0x0209, rgb(0x20, 0x20, 0x20)), // SetTextColor
    wrec(0x0102, shorts(1)), // SetBkMode transparent
    wrec(0x0521, Buffer.concat([shorts(t.length), tp, shorts(400, 120)])) // TextOut
  ];
  records.push(wrec(0x0000, Buffer.alloc(0)));
  const body = Buffer.concat(records);
  const head = Buffer.alloc(18);
  head.writeUInt16LE(1, 0); head.writeUInt16LE(9, 2); head.writeUInt16LE(0x300, 4);
  head.writeUInt32LE((18 + body.length) / 2, 6); head.writeUInt16LE(3, 10); head.writeUInt32LE(30, 12);
  const pl = Buffer.alloc(22);
  pl.writeUInt32LE(0x9ac6cdd7, 0);
  shorts(0, 0, 2000, 1000).copy(pl, 6);
  pl.writeUInt16LE(1440, 14); // 2000 x 1000 twips = 133 x 67 px
  let sum = 0;
  for (let i = 0; i < 10; i++) sum ^= pl.readUInt16LE(i * 2);
  pl.writeUInt16LE(sum, 20);
  return Buffer.concat([pl, head, body]);
}

// ---------- TIFF ----------

function lzwEncode(data) {
  const out = [];
  let acc = 0; let nbits = 0;
  const put = (code, bits) => { acc = (acc << bits) | code; nbits += bits; while (nbits >= 8) { out.push((acc >>> (nbits - 8)) & 255); nbits -= 8; } acc &= (1 << nbits) - 1; };
  let dict = new Map(); let next = 258; let bits = 9;
  const reset = () => { dict = new Map(); next = 258; bits = 9; };
  put(256, 9);
  let w = '';
  for (let i = 0; i < data.length; i++) {
    const c = String.fromCharCode(data[i]);
    const wc = w + c;
    if (w === '' || dict.has(wc) || wc.length === 1) { w = wc; continue; }
    put(w.length === 1 ? w.charCodeAt(0) : dict.get(w), bits);
    if (next >= 4093) { put(256, bits); reset(); w = c; continue; } // table full: Clear
    dict.set(wc, next++);
    if (bits < 12 && next >= (1 << bits)) bits++; // the decoder adds each entry one code later
    w = c;
  }
  if (w) put(w.length === 1 ? w.charCodeAt(0) : dict.get(w), bits);
  put(257, bits);
  if (nbits) put(0, 8 - nbits);
  return Buffer.from(out);
}
function packBits(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 128) { const n = Math.min(128, data.length - i); out.push(n - 1); for (let j = 0; j < n; j++) out.push(data[i + j]); }
  return Buffer.from(out);
}
// One page, one strip, little-endian. pages: extra page objects chained after the first.
function tiff(page, more) {
  const pages = [page].concat(more || []);
  const parts = [];
  let at = 8;
  const header = Buffer.alloc(8);
  header.write('II', 0); header.writeUInt16LE(42, 2);
  const ifdOffsets = [];
  const built = pages.map((p) => {
    const raw = p.raw ? p.data : p.compression === 5 ? lzwEncode(p.data) : p.compression === 32773 ? packBits(p.data) : p.compression === 8 ? Buffer.from(pako.deflate(p.data)) : p.data;
    return { p, raw };
  });
  for (const { p, raw } of built) {
    const dataOff = at;
    parts.push(raw);
    at += raw.length + (raw.length % 2);
    if (raw.length % 2) parts.push(Buffer.alloc(1));
    const bpsOff = at;
    const bps = Buffer.alloc(p.spp * 2);
    for (let i = 0; i < p.spp; i++) bps.writeUInt16LE(p.bps, i * 2);
    if (p.spp > 2) { parts.push(bps); at += bps.length; }
    const entries = [
      [256, 4, 1, p.w], [257, 4, 1, p.h], [258, 3, p.spp, p.spp > 2 ? bpsOff : p.bps], [259, 3, 1, p.compression || 1],
      [262, 3, 1, p.photometric], [273, 4, 1, dataOff], [277, 3, 1, p.spp], [278, 4, 1, p.h], [279, 4, 1, raw.length]
    ];
    if (p.predictor) entries.push([317, 3, 1, 2]);
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    ifd.writeUInt16LE(entries.length, 0);
    entries.forEach(([tag, type, n, v], i) => {
      const o = 2 + i * 12;
      ifd.writeUInt16LE(tag, o); ifd.writeUInt16LE(type, o + 2); ifd.writeUInt32LE(n, o + 4);
      if (type === 3 && n === 1) ifd.writeUInt16LE(v, o + 8); else ifd.writeUInt32LE(v, o + 8);
    });
    ifdOffsets.push({ at, ifd });
    parts.push(ifd);
    at += ifd.length;
  }
  ifdOffsets.forEach((x, i) => { if (i + 1 < ifdOffsets.length) x.ifd.writeUInt32LE(ifdOffsets[i + 1].at, x.ifd.length - 4); });
  header.writeUInt32LE(ifdOffsets[0].at, 4);
  return Buffer.concat([header].concat(parts));
}
// An RGB test card: left half color c1, right half c2, a black bar in the middle row band.
function card(w, h, c1, c2) {
  const d = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = y > h * 0.45 && y < h * 0.55 ? [0, 0, 0] : x < w / 2 ? c1 : c2;
    d.set(c, (y * w + x) * 3);
  }
  return d;
}
function sampleTiff(compression, multi) {
  const w = 160; const h = 100;
  const first = { w, h, spp: 3, bps: 8, photometric: 2, compression, data: card(w, h, [0xc0, 0x39, 0x2b], [0x29, 0x80, 0xb9]) };
  const second = { w, h, spp: 3, bps: 8, photometric: 2, compression, data: card(w, h, [0x27, 0xae, 0x60], [0x27, 0xae, 0x60]) };
  return tiff(first, multi ? [second] : []);
}

module.exports = { emf, rec, ints, sampleEmf, emfPlusOnly, sampleWmf, sampleTiff, tiff, lzwEncode, packBits, card, hostile };
