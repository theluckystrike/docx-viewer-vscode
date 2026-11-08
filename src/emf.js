'use strict';
// EMF (Enhanced Metafile) to SVG text, without a DOM. Plays the plain GDI records of the file:
// mapping modes, world transforms, pens, brushes, fonts, lines, shapes, paths, text, bitmaps,
// gradient fills and rectangular or path clipping. EMF+ records (in GDI comments) are skipped; Office
// writes "EMF+ dual" files that carry the same drawing as plain records, and those are drawn.
// The caller (src/pictures.js) checks the record structure and limits first (preflightEmf).
// Written for DOCX Viewer; the record layouts follow Microsoft's [MS-EMF] specification.

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function i16(b, o) { const v = u16(b, o); return v > 0x7fff ? v - 0x10000 : v; }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function i32(b, o) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24); }
function f32(dv, o) { return dv.getFloat32(o, true); }

const KAPPA = 0.5522847498;
const STOCK = {
  0: { kind: 'brush', style: 0, color: 'ffffff' }, 1: { kind: 'brush', style: 0, color: 'c0c0c0' },
  2: { kind: 'brush', style: 0, color: '808080' }, 3: { kind: 'brush', style: 0, color: '404040' },
  4: { kind: 'brush', style: 0, color: '000000' }, 5: { kind: 'brush', style: 1 },
  6: { kind: 'pen', style: 0, width: 0, color: 'ffffff' }, 7: { kind: 'pen', style: 0, width: 0, color: '000000' },
  8: { kind: 'pen', style: 5 }, 18: { kind: 'brush', style: 0, color: 'ffffff' }, 19: { kind: 'pen', style: 0, width: 0, color: '000000' }
};
const DEFAULT_FONT = { kind: 'font', height: -12, weight: 400, italic: false, underline: false, strike: false, escapement: 0, face: '' };

function hex(b, o) { return ((b[o] << 16) | (b[o + 1] << 8) | b[o + 2]).toString(16).padStart(6, '0'); }
function num(v) { return Math.round(v * 100) / 100; }
function esc(s) {
  // XML text: escape markup and drop characters XML 1.0 does not allow.
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/g, '$1')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mul(m, n) { // apply m first, then n
  return [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
}

// bytes: Uint8Array of a checked EMF (ending in an EOF record). box: device-unit view box {x,y,w,h}.
// size: {width,height} in CSS pixels. opts.base64(Uint8Array) -> string. Returns SVG text.
function emfToSvgText(b, box, size, opts) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  const defs = [];
  const clipIds = new Map();
  let outLen = 0;
  const maxOut = (opts && opts.maxChars) || 64 * 1024 * 1024;
  const base64 = opts.base64;
  const dev = { cx: i32(b, 64) || 1, cy: i32(b, 68) || 1 };
  const mm = { cx: i32(b, 72) || 1, cy: i32(b, 76) || 1 };
  const pxPerMm = { x: dev.cx / mm.cx, y: dev.cy / mm.cy };
  const objects = [];
  let s = {
    mapMode: 1, wox: 0, woy: 0, wex: 1, wey: 1, vox: 0, voy: 0, vex: 1, vey: 1,
    world: [1, 0, 0, 1, 0, 0],
    pen: STOCK[7], brush: STOCK[0], font: DEFAULT_FONT,
    textColor: '000000', bkColor: 'ffffff', bkMode: 2, textAlign: 0, fillRule: 'evenodd',
    x: 0, y: 0, clip: null, arcDir: 1
  };
  const stack = [];
  let path = null; // path being recorded between BeginPath and EndPath
  let lastPath = null; // finished path, for FillPath/StrokePath/SelectClipPath
  let matrix = null;

  function emit(str) {
    outLen += str.length;
    if (outLen > maxOut) throw new Error('the drawing is too large');
    out.push(str);
  }
  // Page (window/viewport) mapping as a matrix, from the map mode.
  function pageMatrix() {
    let sx;
    let sy;
    const units = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 }[s.mapMode];
    if (units) { sx = units * pxPerMm.x; sy = -units * pxPerMm.y; }
    else if (s.mapMode === 7 || s.mapMode === 8) {
      sx = s.wex ? s.vex / s.wex : 1;
      sy = s.wey ? s.vey / s.wey : 1;
      if (s.mapMode === 7) { // isotropic: same scale on both axes, signs kept
        const k = Math.min(Math.abs(sx), Math.abs(sy));
        sx = Math.sign(sx || 1) * k;
        sy = Math.sign(sy || 1) * k;
      }
    } else { sx = 1; sy = 1; }
    return [sx, 0, 0, sy, s.vox - s.wox * sx, s.voy - s.woy * sy];
  }
  function M() { if (!matrix) matrix = mul(s.world, pageMatrix()); return matrix; }
  function changed() { matrix = null; }
  function tx(x, y) { const m = M(); return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  function scale() { const m = M(); return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }

  // ---------- paths in device units ----------
  function newPath() { return { d: [], open: false, cx: 0, cy: 0 }; }
  function moveTo(p, x, y) { const q = tx(x, y); p.d.push('M' + num(q[0]) + ' ' + num(q[1])); p.open = true; }
  function lineTo(p, x, y) { const q = tx(x, y); if (!p.open) { p.d.push('M' + num(q[0]) + ' ' + num(q[1])); p.open = true; } else p.d.push('L' + num(q[0]) + ' ' + num(q[1])); }
  function bezTo(p, x1, y1, x2, y2, x3, y3) {
    const a = tx(x1, y1); const c = tx(x2, y2); const d = tx(x3, y3);
    p.d.push('C' + num(a[0]) + ' ' + num(a[1]) + ' ' + num(c[0]) + ' ' + num(c[1]) + ' ' + num(d[0]) + ' ' + num(d[1]));
  }
  function close(p) { if (p.open) p.d.push('Z'); p.open = false; }
  function ellipsePath(p, l, t, r, bt) {
    const cx = (l + r) / 2; const cy = (t + bt) / 2; const rx = (r - l) / 2; const ry = (bt - t) / 2;
    const kx = rx * KAPPA; const ky = ry * KAPPA;
    moveTo(p, cx + rx, cy);
    bezTo(p, cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry);
    bezTo(p, cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy);
    bezTo(p, cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry);
    bezTo(p, cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy);
    close(p);
  }
  function rectPath(p, l, t, r, bt) { moveTo(p, l, t); lineTo(p, r, t); lineTo(p, r, bt); lineTo(p, l, bt); close(p); }
  function roundRectPath(p, l, t, r, bt, w, h) {
    const rx = Math.min(Math.abs(w) / 2, Math.abs(r - l) / 2); const ry = Math.min(Math.abs(h) / 2, Math.abs(bt - t) / 2);
    if (!rx || !ry) return rectPath(p, l, t, r, bt);
    const kx = rx * KAPPA; const ky = ry * KAPPA;
    moveTo(p, l + rx, t); lineTo(p, r - rx, t); bezTo(p, r - rx + kx, t, r, t + ry - ky, r, t + ry);
    lineTo(p, r, bt - ry); bezTo(p, r, bt - ry + ky, r - rx + kx, bt, r - rx, bt);
    lineTo(p, l + rx, bt); bezTo(p, l + rx - kx, bt, l, bt - ry + ky, l, bt - ry);
    lineTo(p, l, t + ry); bezTo(p, l, t + ry - ky, l + rx - kx, t, l + rx, t);
    close(p);
  }
  // Arc points along the ellipse in box (l,t,r,bt) from the ray through (x1,y1) to the ray through (x2,y2).
  function arcPoints(l, t, r, bt, x1, y1, x2, y2) {
    const cx = (l + r) / 2; const cy = (t + bt) / 2; const rx = Math.abs(r - l) / 2; const ry = Math.abs(bt - t) / 2;
    let a1 = Math.atan2((y1 - cy) / (ry || 1), (x1 - cx) / (rx || 1));
    let a2 = Math.atan2((y2 - cy) / (ry || 1), (x2 - cx) / (rx || 1));
    // GDI's default direction is counterclockwise on screen (y down): the angle decreases.
    const ccw = s.arcDir === 1;
    if (ccw) { while (a2 >= a1) a2 -= Math.PI * 2; } else { while (a2 <= a1) a2 += Math.PI * 2; }
    const n = Math.max(4, Math.min(64, Math.ceil(Math.abs(a2 - a1) / (Math.PI / 16))));
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = a1 + (a2 - a1) * i / n; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return { pts, cx, cy };
  }

  // ---------- paint ----------
  function strokeAttrs() {
    const p = s.pen;
    if (!p || p.style === 5) return ' stroke="none"';
    let w = p.width ? p.width * scale() : 1;
    if (!(w > 0) || !isFinite(w)) w = 1;
    let a = ' stroke="#' + p.color + '" stroke-width="' + num(Math.max(w, 0.5)) + '"';
    const st = p.style & 0xf;
    const dash = { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] }[st];
    if (dash) a += ' stroke-dasharray="' + dash.map((v) => num(v * Math.max(w, 1) * 1.5)).join(' ') + '"';
    const cap = p.style & 0xf00; const join = p.style & 0xf000;
    a += ' stroke-linecap="' + (cap === 0x100 ? 'square' : cap === 0x200 ? 'butt' : 'round') + '"';
    a += ' stroke-linejoin="' + (join === 0x1000 ? 'bevel' : join === 0x2000 ? 'miter' : 'round') + '"';
    return a;
  }
  function fillAttrs(brush) {
    const br = brush || s.brush;
    if (!br || br.style === 1) return ' fill="none"';
    if (br.style === 2) return ' fill="#' + br.color + '" fill-opacity="0.35"'; // hatched: a light tint
    return ' fill="#' + (br.color || 'c0c0c0') + '"';
  }
  function clipAttr() {
    if (!s.clip) return '';
    let id = clipIds.get(s.clip);
    if (!id) {
      id = 'c' + (clipIds.size + 1);
      clipIds.set(s.clip, id);
      defs.push('<clipPath id="' + id + '"><path d="' + s.clip + '"/></clipPath>');
    }
    return ' clip-path="url(#' + id + ')"';
  }
  function draw(p, fill, stroke) {
    if (!p.d.length) return;
    emit('<path d="' + p.d.join('') + '"' + (fill ? fillAttrs() + (fill && s.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '') : ' fill="none"') + (stroke ? strokeAttrs() : '') + clipAttr() + '/>');
  }
  // Shapes inside BeginPath/EndPath go to the path; outside they are drawn at once.
  function shape(build, fill) {
    if (path) { build(path); return; }
    const p = newPath();
    build(p);
    draw(p, fill, true);
  }

  // ---------- points ----------
  function points(off, n, small) {
    const pts = [];
    const step = small ? 4 : 8;
    for (let i = 0; i < n; i++) {
      const o = off + i * step;
      pts.push(small ? [i16(b, o), i16(b, o + 2)] : [i32(b, o), i32(b, o + 4)]);
    }
    return pts;
  }
  function polyline(pts, p, from) {
    if (!pts.length) return;
    if (from) lineTo(p, pts[0][0], pts[0][1]); else moveTo(p, pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) lineTo(p, pts[i][0], pts[i][1]);
  }
  function beziers(pts, p, start) {
    let i = 0;
    if (!start) { moveTo(p, pts[0][0], pts[0][1]); i = 1; }
    for (; i + 2 < pts.length; i += 3) bezTo(p, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], pts[i + 2][0], pts[i + 2][1]);
  }

  // ---------- bitmaps ----------
  // A DIB (BITMAPINFO + bits) inside the record, as a data: URL. JPEG and PNG DIBs go as they are;
  // the rest become a .bmp file. 32-bit pixels with alpha get a V5 header so the alpha counts.
  function dibUrl(rec, offBmi, cbBmi, offBits, cbBits, alpha) {
    if (!cbBmi || offBmi + cbBmi > rec.size || offBits + cbBits > rec.size || cbBmi < 12) return null;
    const bmi = b.subarray(rec.pos + offBmi, rec.pos + offBmi + cbBmi);
    const bits = b.subarray(rec.pos + offBits, rec.pos + offBits + cbBits);
    const hsize = u32(bmi, 0);
    let w; let h; let bpp; let comp = 0;
    if (hsize === 12) { w = u16(bmi, 4); h = i16(bmi, 6); bpp = u16(bmi, 10); }
    else { w = i32(bmi, 4); h = i32(bmi, 8); bpp = u16(bmi, 14); comp = u32(bmi, 16); }
    if (!w || !h) return null;
    if (comp === 4) return { url: 'data:image/jpeg;base64,' + base64(bits), w: Math.abs(w), h: Math.abs(h) };
    if (comp === 5) return { url: 'data:image/png;base64,' + base64(bits), w: Math.abs(w), h: Math.abs(h) };
    let head = bmi;
    if (alpha && bpp === 32 && (comp === 0 || comp === 3) && hsize >= 40) {
      head = new Uint8Array(124);
      const hv = new DataView(head.buffer);
      hv.setUint32(0, 124, true); hv.setInt32(4, w, true); hv.setInt32(8, h, true); hv.setUint16(12, 1, true); hv.setUint16(14, 32, true);
      hv.setUint32(16, 3, true); hv.setUint32(20, cbBits, true);
      hv.setUint32(40, 0x00ff0000, true); hv.setUint32(44, 0x0000ff00, true); hv.setUint32(48, 0x000000ff, true); hv.setUint32(52, 0xff000000, true);
      hv.setUint32(56, 0x73524742, true); // 'sRGB'
    }
    const file = new Uint8Array(14 + head.length + bits.length);
    file[0] = 0x42; file[1] = 0x4d;
    const fv = new DataView(file.buffer);
    fv.setUint32(2, file.length, true);
    fv.setUint32(10, 14 + head.length, true);
    file.set(head, 14);
    file.set(bits, 14 + head.length);
    return { url: 'data:image/bmp;base64,' + base64(file), w: Math.abs(w), h: Math.abs(h) };
  }
  function image(img, x, y, w, h, sx, sy, sw, sh, opacity) {
    const a = tx(x, y); const c = tx(x + w, y + h);
    const dx = Math.min(a[0], c[0]); const dy = Math.min(a[1], c[1]);
    const dw = Math.abs(c[0] - a[0]); const dh = Math.abs(c[1] - a[1]);
    if (!(dw > 0 && dh > 0)) return;
    const op = opacity < 1 ? ' opacity="' + num(opacity) + '"' : '';
    const crop = sw > 0 && sh > 0 && (sx || sy || sw !== img.w || sh !== img.h);
    const vb = crop ? [sx, sy, sw, sh] : [0, 0, img.w, img.h];
    emit('<svg x="' + num(dx) + '" y="' + num(dy) + '" width="' + num(dw) + '" height="' + num(dh) + '" viewBox="' + vb.join(' ') + '" preserveAspectRatio="none"' + op + clipAttr() + '>' +
      '<image width="' + img.w + '" height="' + img.h + '" preserveAspectRatio="none"' + ' href="' + img.url + '"/></svg>');
  }

  // ---------- text ----------
  function text(rec, wide) {
    const p = rec.pos;
    const refX = i32(b, p + 36); const refY = i32(b, p + 40);
    const n = u32(b, p + 44); const offStr = u32(b, p + 48); const options = u32(b, p + 52);
    const offDx = u32(b, p + 72);
    if (options & 0x2) { // ETO_OPAQUE: fill the rectangle with the background color
      const l = i32(b, p + 56); const t = i32(b, p + 60); const r = i32(b, p + 64); const bt = i32(b, p + 68);
      if (r > l && bt > t) { const q = newPath(); rectPath(q, l, t, r, bt); emit('<path d="' + q.d.join('') + '" fill="#' + s.bkColor + '"' + clipAttr() + '/>'); }
    }
    if (!n || options & 0x10) return; // ETO_GLYPH_INDEX: glyph numbers, not characters
    const count = Math.min(n, 4000);
    if (offStr + count * (wide ? 2 : 1) > rec.size) return;
    let str = '';
    for (let i = 0; i < count; i++) str += String.fromCharCode(wide ? u16(b, p + offStr + i * 2) : b[p + offStr + i]);
    if (!str.replace(/[\s\u0000]/g, '')) return;
    const f = s.font;
    const update = s.textAlign & 1;
    let x = update ? s.x : refX; let y = update ? s.y : refY;
    // Advances: one per character (two with ETO_PDY), in logical units.
    const pdy = options & 0x2000;
    let adv = null;
    if (offDx && offDx + count * (pdy ? 8 : 4) <= rec.size) { adv = []; for (let i = 0; i < count; i++) adv.push(i32(b, p + offDx + i * (pdy ? 8 : 4))); }
    const total = adv ? adv.reduce((t, v) => t + v, 0) : 0;
    const h = s.textAlign & 6;
    if (adv) { if (h === 2) x -= total; else if (h === 6) x -= total / 2; }
    if (update && adv) s.x += total;
    const sc = scale();
    const m = M();
    const fontPx = Math.max(1, Math.abs(f.height || 12) * Math.abs(m[3] || sc) * (f.height > 0 ? 0.8 : 1));
    const start = tx(x, y);
    const v = s.textAlign & 24;
    const baseline = v === 24 ? 'alphabetic' : v === 8 ? 'text-after-edge' : 'text-before-edge';
    let attrs = ' font-size="' + num(fontPx) + '" fill="#' + s.textColor + '"';
    if (f.face) attrs += ' font-family="' + esc(f.face.replace(/["']/g, '')) + ', sans-serif"';
    else attrs += ' font-family="sans-serif"';
    if (f.weight >= 600) attrs += ' font-weight="bold"';
    if (f.italic) attrs += ' font-style="italic"';
    if (f.underline || f.strike) attrs += ' text-decoration="' + (f.underline ? 'underline' : 'line-through') + '"';
    if (v !== 24) attrs += ' dominant-baseline="' + baseline + '"';
    if (!adv && h) attrs += ' text-anchor="' + (h === 6 ? 'middle' : 'end') + '"';
    attrs += ' xml:space="preserve"';
    let xs = num(start[0]);
    if (adv) {
      const list = [];
      let cx = x;
      for (let i = 0; i < count; i++) { list.push(num(tx(cx, y)[0])); cx += adv[i]; }
      // Keep the list short for long runs of plain text: every 1 in 8 is enough when advances are even.
      xs = list.join(' ');
    }
    const rot = f.escapement ? ' transform="rotate(' + num(-f.escapement / 10) + ' ' + num(start[0]) + ' ' + num(start[1]) + ')"' : '';
    const ys = num(start[1]);
    emit('<text x="' + xs + '" y="' + ys + '"' + attrs + rot + clipAttr() + '>' + esc(str) + '</text>');
  }

  // ---------- clipping ----------
  function rectD(l, t, r, bt) { return 'M' + num(l) + ' ' + num(t) + 'H' + num(r) + 'V' + num(bt) + 'H' + num(l) + 'Z'; }
  function intersectRect(l, t, r, bt) {
    // Exact for a single rectangle clip; otherwise the new rectangle replaces the clip.
    const m = s.clip && /^M(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)V(-?[\d.]+)H-?[\d.]+Z$/.exec(s.clip);
    if (m) { l = Math.max(l, +m[1]); t = Math.max(t, +m[2]); r = Math.min(r, +m[3]); bt = Math.min(bt, +m[4]); if (r < l) r = l; if (bt < t) bt = t; }
    s.clip = rectD(l, t, r, bt);
  }

  // ---------- objects ----------
  function brushAt(o) { return { kind: 'brush', style: u32(b, o), color: hex(b, o + 4), hatch: u32(b, o + 8) }; }
  function colorAt(o) { return hex(b, o); }

  // ---------- play ----------
  let pos = u32(b, 4);
  while (pos + 8 <= b.length) {
    const type = u32(b, pos);
    const size = u32(b, pos + 4);
    if (size < 8 || pos + size > b.length) break;
    const rec = { pos, size };
    const p = pos;
    pos += size;
    if (type === 14) break;
    switch (type) {
      case 9: s.wex = i32(b, p + 8); s.wey = i32(b, p + 12); changed(); break;
      case 10: s.wox = i32(b, p + 8); s.woy = i32(b, p + 12); changed(); break;
      case 11: s.vex = i32(b, p + 8); s.vey = i32(b, p + 12); changed(); break;
      case 12: s.vox = i32(b, p + 8); s.voy = i32(b, p + 12); changed(); break;
      case 31: { const xn = i32(b, p + 8), xd = i32(b, p + 12) || 1, yn = i32(b, p + 16), yd = i32(b, p + 20) || 1; s.vex = s.vex * xn / xd; s.vey = s.vey * yn / yd; changed(); break; }
      case 32: { const xn = i32(b, p + 8), xd = i32(b, p + 12) || 1, yn = i32(b, p + 16), yd = i32(b, p + 20) || 1; s.wex = s.wex * xn / xd; s.wey = s.wey * yn / yd; changed(); break; }
      case 17: s.mapMode = u32(b, p + 8); changed(); break;
      case 18: s.bkMode = u32(b, p + 8); break;
      case 19: s.fillRule = u32(b, p + 8) === 2 ? 'nonzero' : 'evenodd'; break;
      case 22: s.textAlign = u32(b, p + 8); break;
      case 24: s.textColor = colorAt(p + 8); break;
      case 25: s.bkColor = colorAt(p + 8); break;
      case 57: s.arcDir = u32(b, p + 8); break;
      case 27: s.x = i32(b, p + 8); s.y = i32(b, p + 12); if (path) moveTo(path, s.x, s.y); break;
      case 33: stack.push(Object.assign({}, s, { world: s.world.slice() })); if (stack.length > 1000) stack.shift(); break;
      case 34: {
        let n = i32(b, p + 8);
        if (n < 0) { while (n++ < 0 && stack.length) s = stack.pop(); } else if (n > 0 && n <= stack.length) { s = stack[n - 1]; stack.length = n - 1; }
        changed();
        break;
      }
      case 35: s.world = [f32(dv, p + 8), f32(dv, p + 12), f32(dv, p + 16), f32(dv, p + 20), f32(dv, p + 24), f32(dv, p + 28)]; changed(); break;
      case 36: {
        const x = [f32(dv, p + 8), f32(dv, p + 12), f32(dv, p + 16), f32(dv, p + 20), f32(dv, p + 24), f32(dv, p + 28)];
        const mode = u32(b, p + 32);
        if (mode === 1) s.world = [1, 0, 0, 1, 0, 0];
        else if (mode === 2) s.world = mul(x, s.world);
        else if (mode === 3) s.world = mul(s.world, x);
        else if (mode === 4) s.world = x;
        if (!s.world.every(isFinite)) s.world = [1, 0, 0, 1, 0, 0];
        changed();
        break;
      }
      case 38: objects[u32(b, p + 8)] = { kind: 'pen', style: u32(b, p + 12), width: i32(b, p + 16), color: colorAt(p + 24) }; break;
      case 95: objects[u32(b, p + 8)] = { kind: 'pen', style: u32(b, p + 28), width: u32(b, p + 28) & 0x10000 ? u32(b, p + 32) : 0, color: colorAt(p + 40) }; if (u32(b, p + 36) === 1) objects[u32(b, p + 8)].style = 5; break;
      case 39: objects[u32(b, p + 8)] = brushAt(p + 12); break;
      case 93: case 94: objects[u32(b, p + 8)] = { kind: 'brush', style: 3, color: '808080' }; break;
      case 82: {
        const o = p + 12;
        let face = '';
        for (let i = 0; i < 32; i++) { const c = u16(b, o + 28 + i * 2); if (!c) break; face += String.fromCharCode(c); }
        objects[u32(b, p + 8)] = { kind: 'font', height: i32(b, o), escapement: i32(b, o + 8), weight: i32(b, o + 16), italic: !!b[o + 20], underline: !!b[o + 21], strike: !!b[o + 22], face };
        break;
      }
      case 37: {
        const idx = u32(b, p + 8);
        const obj = idx & 0x80000000 ? (STOCK[idx & 0x7fffffff] || ((idx & 0x7fffffff) >= 10 && (idx & 0x7fffffff) <= 17 ? DEFAULT_FONT : null)) : objects[idx];
        if (obj) s[obj.kind] = obj;
        break;
      }
      case 40: { const idx = u32(b, p + 8); if (!(idx & 0x80000000)) objects[idx] = undefined; break; }
      // lines and shapes
      case 54: { const x = i32(b, p + 8), y = i32(b, p + 12); if (path) lineTo(path, x, y); else { const q = newPath(); moveTo(q, s.x, s.y); lineTo(q, x, y); draw(q, false, true); } s.x = x; s.y = y; break; }
      case 4: case 87: case 3: case 86: case 2: case 85: {
        const small = type >= 85;
        const n = u32(b, p + 24);
        if (28 + n * (small ? 4 : 8) > size || !n) break;
        const pts = points(p + 28, n, small);
        const poly = type === 3 || type === 86;
        const bez = type === 2 || type === 85;
        shape((q) => { if (bez) beziers(pts, q, false); else polyline(pts, q, false); if (poly) close(q); }, poly);
        break;
      }
      case 6: case 89: case 5: case 88: {
        const small = type >= 85;
        const n = u32(b, p + 24);
        if (28 + n * (small ? 4 : 8) > size || !n) break;
        const pts = points(p + 28, n, small);
        const bez = type === 5 || type === 88;
        shape((q) => { if (!path) moveTo(q, s.x, s.y); else if (!q.open) moveTo(q, s.x, s.y); if (bez) beziers(pts, q, true); else polyline(pts, q, true); }, false);
        const last = pts[pts.length - 1];
        s.x = last[0]; s.y = last[1];
        break;
      }
      case 7: case 90: case 8: case 91: {
        const small = type >= 90;
        const nPolys = u32(b, p + 24); const total = u32(b, p + 28);
        if (32 + nPolys * 4 + total * (small ? 4 : 8) > size || !nPolys) break;
        const all = points(p + 32 + nPolys * 4, total, small);
        const poly = type === 8 || type === 91;
        shape((q) => {
          let at = 0;
          for (let i = 0; i < nPolys; i++) {
            const c = u32(b, p + 32 + i * 4);
            if (at + c > total) break;
            polyline(all.slice(at, at + c), q, false);
            if (poly) close(q);
            at += c;
          }
        }, poly);
        break;
      }
      case 43: { const l = i32(b, p + 8), t = i32(b, p + 12), r = i32(b, p + 16), bt = i32(b, p + 20); shape((q) => rectPath(q, l, t, r, bt), true); break; }
      case 44: { const l = i32(b, p + 8), t = i32(b, p + 12), r = i32(b, p + 16), bt = i32(b, p + 20); shape((q) => roundRectPath(q, l, t, r, bt, i32(b, p + 24), i32(b, p + 28)), true); break; }
      case 42: { const l = i32(b, p + 8), t = i32(b, p + 12), r = i32(b, p + 16), bt = i32(b, p + 20); shape((q) => ellipsePath(q, l, t, r, bt), true); break; }
      case 45: case 46: case 47: case 55: {
        const a = arcPoints(i32(b, p + 8), i32(b, p + 12), i32(b, p + 16), i32(b, p + 20), i32(b, p + 24), i32(b, p + 28), i32(b, p + 32), i32(b, p + 36));
        shape((q) => {
          if (type === 55) { if (!q.open) moveTo(q, s.x, s.y); lineTo(q, a.pts[0][0], a.pts[0][1]); } else if (type === 47) { moveTo(q, a.cx, a.cy); lineTo(q, a.pts[0][0], a.pts[0][1]); } else moveTo(q, a.pts[0][0], a.pts[0][1]);
          for (let i = 1; i < a.pts.length; i++) lineTo(q, a.pts[i][0], a.pts[i][1]);
          if (type === 46 || type === 47) close(q);
        }, type === 46 || type === 47);
        if (type === 55) { const last = a.pts[a.pts.length - 1]; s.x = last[0]; s.y = last[1]; }
        break;
      }
      case 15: { const q = newPath(); rectPath(q, i32(b, p + 8), i32(b, p + 12), i32(b, p + 8) + 1, i32(b, p + 12) + 1); emit('<path d="' + q.d.join('') + '" fill="#' + colorAt(p + 16) + '"' + clipAttr() + '/>'); break; }
      // paths
      case 59: path = newPath(); break;
      case 60: if (path) { lastPath = path; path = null; } break;
      case 61: if (path) close(path); break;
      case 68: path = null; lastPath = null; break;
      case 62: case 63: case 64: {
        const q = path || lastPath;
        if (q) draw(q, type !== 64, type !== 62);
        path = null; lastPath = null;
        break;
      }
      case 67: { const q = path || lastPath; if (q && q.d.length) s.clip = q.d.join(''); path = null; lastPath = null; break; }
      // clipping
      case 30: { const a = tx(i32(b, p + 8), i32(b, p + 12)); const c = tx(i32(b, p + 16), i32(b, p + 20)); intersectRect(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[0], c[0]), Math.max(a[1], c[1])); break; }
      case 75: {
        const cb = u32(b, p + 8); const mode = u32(b, p + 12);
        if (!cb || cb < 32) { if (mode === 5) s.clip = null; break; }
        const n = u32(b, p + 16 + 8);
        if (32 + n * 16 > cb || 16 + cb > size) break;
        let d = '';
        for (let i = 0; i < Math.min(n, 5000); i++) { const o = p + 16 + 32 + i * 16; d += rectD(i32(b, o), i32(b, o + 4), i32(b, o + 8), i32(b, o + 12)); }
        if (mode === 1 && n === 1) { const o = p + 48; intersectRect(i32(b, o), i32(b, o + 4), i32(b, o + 8), i32(b, o + 12)); } else s.clip = d || null;
        break;
      }
      // regions filled with a brush
      case 71: case 74: {
        const cb = u32(b, p + 24);
        const at = type === 71 ? p + 32 : p + 28;
        const br = type === 71 ? (objects[u32(b, p + 28)] || s.brush) : s.brush;
        if (cb < 32 || at + cb > p + size) break;
        const n = u32(b, at + 8);
        if (32 + n * 16 > cb) break;
        const q = newPath();
        for (let i = 0; i < Math.min(n, 5000); i++) { const o = at + 32 + i * 16; rectPath(q, i32(b, o), i32(b, o + 4), i32(b, o + 8), i32(b, o + 12)); }
        if (q.d.length) emit('<path d="' + q.d.join('') + '"' + fillAttrs(br) + clipAttr() + '/>');
        break;
      }
      // gradients: rectangles get a linear gradient, triangles the average color
      case 118: {
        const nV = u32(b, p + 24); const nT = u32(b, p + 28); const mode = u32(b, p + 32);
        if (36 + nV * 16 + nT * (mode === 2 ? 12 : 8) > size || nV > 100000) break;
        const vx = [];
        for (let i = 0; i < nV; i++) { const o = p + 36 + i * 16; vx.push({ x: i32(b, o), y: i32(b, o + 4), c: [b[o + 9], b[o + 11], b[o + 13]] }); }
        const col = (c) => ((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0');
        const at = p + 36 + nV * 16;
        for (let i = 0; i < Math.min(nT, 10000); i++) {
          if (mode === 2) {
            const a = vx[u32(b, at + i * 12)], c = vx[u32(b, at + i * 12 + 4)], d = vx[u32(b, at + i * 12 + 8)];
            if (!a || !c || !d) continue;
            const q = newPath(); moveTo(q, a.x, a.y); lineTo(q, c.x, c.y); lineTo(q, d.x, d.y); close(q);
            const avg = [0, 1, 2].map((k) => Math.round((a.c[k] + c.c[k] + d.c[k]) / 3));
            emit('<path d="' + q.d.join('') + '" fill="#' + col(avg) + '"' + clipAttr() + '/>');
          } else {
            const a = vx[u32(b, at + i * 8)], c = vx[u32(b, at + i * 8 + 4)];
            if (!a || !c) continue;
            const id = 'g' + (defs.length + 1);
            const p1 = tx(a.x, a.y); const p2 = tx(c.x, c.y);
            const horiz = mode === 0;
            defs.push('<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="' + num(p1[0]) + '" y1="' + num(p1[1]) + '" x2="' + num(horiz ? p2[0] : p1[0]) + '" y2="' + num(horiz ? p1[1] : p2[1]) + '"><stop offset="0" stop-color="#' + col(a.c) + '"/><stop offset="1" stop-color="#' + col(c.c) + '"/></linearGradient>');
            const q = newPath(); rectPath(q, a.x, a.y, c.x, c.y);
            emit('<path d="' + q.d.join('') + '" fill="url(#' + id + ')"' + clipAttr() + '/>');
          }
        }
        break;
      }
      // bitmaps
      case 81: { // STRETCHDIBITS
        const img = dibUrl(rec, u32(b, p + 48), u32(b, p + 52), u32(b, p + 56), u32(b, p + 60), false);
        if (img) image(img, i32(b, p + 24), i32(b, p + 28), i32(b, p + 72), i32(b, p + 76), i32(b, p + 32), i32(b, p + 36), i32(b, p + 40), i32(b, p + 44), 1);
        break;
      }
      case 80: { // SETDIBITSTODEVICE
        const img = dibUrl(rec, u32(b, p + 48), u32(b, p + 52), u32(b, p + 56), u32(b, p + 60), false);
        if (img) image(img, i32(b, p + 24), i32(b, p + 28), i32(b, p + 40), i32(b, p + 44), 0, 0, 0, 0, 1);
        break;
      }
      case 76: case 77: case 78: case 114: case 116: { // BITBLT, STRETCHBLT, MASKBLT, ALPHABLEND, TRANSPARENTBLT
        const x = i32(b, p + 24), y = i32(b, p + 28), w = i32(b, p + 32), h = i32(b, p + 36);
        const cbBmi = size >= 100 ? u32(b, p + 88) : 0;
        if (!cbBmi) { // no source: a pattern fill with the brush (or black/white)
          if (type !== 76) break;
          const rop = u32(b, p + 40);
          const q = newPath(); rectPath(q, x, y, x + w, y + h);
          const fill = rop === 0x00000042 ? ' fill="#000000"' : rop === 0x00ff0062 ? ' fill="#ffffff"' : rop === 0x00f00021 ? fillAttrs() : null;
          if (fill) emit('<path d="' + q.d.join('') + '"' + fill + clipAttr() + '/>');
          break;
        }
        const alpha = type === 114 && b[p + 43] === 1;
        const img = dibUrl(rec, u32(b, p + 84), cbBmi, u32(b, p + 92), u32(b, p + 96), alpha);
        const sw = type === 76 || type === 78 ? w : i32(b, p + 100);
        const sh = type === 76 || type === 78 ? h : i32(b, p + 104);
        const opacity = type === 114 ? b[p + 42] / 255 : 1;
        if (img) image(img, x, y, w, h, i32(b, p + 44), i32(b, p + 48), sw, sh, opacity);
        break;
      }
      case 83: text(rec, false); break;
      case 84: text(rec, true); break;
      default: break; // palettes, color management, EMF+ comments and other records that do not draw
    }
  }
  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size.width + '" height="' + size.height + '" viewBox="' + [num(box.x), num(box.y), num(box.w), num(box.h)].join(' ') + '" preserveAspectRatio="none" overflow="hidden">';
  return head + (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + out.join('') + '</svg>';
}

module.exports = { emfToSvgText };
