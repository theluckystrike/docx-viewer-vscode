'use strict';
// Document model for the redline compare. A document becomes a list of blocks:
//   paragraph: { t: 'p', text, segs: [{ s, e, f }], style, lvl, list, node }
//   table:     { t: 'tbl', text, rows: [{ node, cells: [{ node, items, blocks }] }], node }
//   opaque:    { t: 'x', text, node }   (a table nested deeper than MAX_DEPTH: compared as text only)
// Word packages are read from word/document.xml directly (formatting, styles and the XML nodes the
// DOCX export needs). OpenDocument and Word 97-2003 files go through the existing converter and are
// read back from its sanitized HTML (text, headings, lists, tables, bold/italic/underline).
// Tracked changes already in a file are accepted first, so a compare is always final against final.

const X = require('./xml');

const MAX_DEPTH = 40; // nested tables deeper than this are compared as plain text
const OBJ = '￼'; // one character for a picture, chart, object or note reference

// ---------- formatting ----------
const FMT_CACHE = new Map();
function fmtOf(o) {
  const key = (o.cs ? 'cs=' + o.cs + ';' : '') + (o.b ? 'b;' : '') + (o.i ? 'i;' : '') + (o.u ? 'u;' : '') + (o.s ? 's;' : '') + (o.sz ? 'sz=' + o.sz + ';' : '') + (o.va ? 'va=' + o.va + ';' : '') + (o.m ? 'm;' : '');
  let f = FMT_CACHE.get(key);
  if (!f) { f = Object.freeze(Object.assign({ key }, o)); FMT_CACHE.set(key, f); }
  return f;
}
const PLAIN = fmtOf({});

function toggle(el) {
  const v = X.attr(el, el.n.split(':')[0] + ':val') || X.attr(el, 'w:val') || X.attr(el, 'val');
  return v === null || !/^(0|false|off|none)$/i.test(v);
}

// ---------- namespace ----------
const W_URIS = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
const M_URIS = ['http://schemas.openxmlformats.org/officeDocument/2006/math', 'http://purl.oclc.org/ooxml/officeDocument/math'];

function prefixFor(rootEl, uris, fallback) {
  const re = /\sxmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(rootEl.a))) {
    const uri = m[2] !== undefined ? m[2] : m[3];
    if (uris.includes(uri)) return m[1] ? m[1] + ':' : '';
  }
  return fallback;
}

function namer(wp) {
  return (el) => {
    if (!el || typeof el === 'string') return null;
    if (wp === '') return el.n.indexOf(':') === -1 ? el.n : null;
    return el.n.startsWith(wp) ? el.n.slice(wp.length) : null;
  };
}

// ---------- accept existing tracked changes ----------
const DROP_ALWAYS = new Set(['rPrChange', 'pPrChange', 'sectPrChange', 'tblPrChange', 'trPrChange', 'tcPrChange', 'tblGridChange', 'tblPrExChange', 'numberingChange',
  'moveFromRangeStart', 'moveFromRangeEnd', 'moveToRangeStart', 'moveToRangeEnd', 'customXmlInsRangeStart', 'customXmlInsRangeEnd', 'customXmlDelRangeStart',
  'customXmlDelRangeEnd', 'customXmlMoveFromRangeStart', 'customXmlMoveFromRangeEnd', 'customXmlMoveToRangeStart', 'customXmlMoveToRangeEnd', 'cellIns', 'cellDel', 'cellMerge']);
const MARK_PARENTS = new Set(['rPr', 'trPr']);

// Accepts every revision in place. Returns the number of revisions found.
function acceptAll(root, wp) {
  const L = namer(wp);
  let found = 0;
  const visit = (el, parentLocal) => {
    if (!el.c) return [el];
    const out = [];
    for (const c of el.c) {
      if (typeof c === 'string') { out.push(c); continue; }
      const l = L(c);
      if (l === 'del' || l === 'moveFrom') { found++; continue; }
      if (l === 'ins' || l === 'moveTo') {
        found++;
        if (MARK_PARENTS.has(L(el))) continue;
        visit(c, l);
        if (c.c) out.push(...c.c); // unwrap: the inserted content stays
        continue;
      }
      if (l && DROP_ALWAYS.has(l)) { found++; continue; }
      if (l === 'tr' && rowMarked(c, L, 'del')) { found++; continue; }
      if (l === 'p') {
        const markDeleted = paragraphMarkDeleted(c, L);
        const r = visit(c, l);
        if (markDeleted && !hasContent(r[0], L)) { found++; continue; }
        out.push(...r);
        continue;
      }
      out.push(...visit(c, l));
    }
    el.c = out;
    return [el];
  };
  visit(root, null);
  return found;
}

function rowMarked(tr, L, kind) {
  for (const c of X.kids(tr)) if (L(c) === 'trPr') for (const m of X.kids(c)) if (L(m) === kind) return true;
  return false;
}

function paragraphMarkDeleted(p, L) {
  for (const c of X.kids(p)) {
    if (L(c) !== 'pPr') continue;
    for (const r of X.kids(c)) if (L(r) === 'rPr') for (const m of X.kids(r)) if (L(m) === 'del' || L(m) === 'moveFrom') return true;
  }
  return false;
}

function hasContent(p, L) {
  let any = false;
  const walk = (el) => {
    if (any || !el.c) return;
    for (const c of el.c) {
      if (typeof c === 'string') continue;
      const l = L(c);
      if (l === 'pPr') continue;
      if (l === 't' || l === 'drawing' || l === 'pict' || l === 'object' || l === 'tab' || l === 'br') { any = true; return; }
      walk(c);
    }
  };
  walk(p);
  return any;
}

// ---------- styles ----------
function readStyles(stylesXml) {
  const styles = { para: {}, ids: new Set(), charIds: new Set() };
  if (!stylesXml) return styles;
  let root;
  try { root = X.parse(stylesXml); } catch (_) { return styles; }
  const top = X.kids(root)[0];
  if (!top) return styles;
  const wp = prefixFor(top, W_URIS, 'w:');
  const L = namer(wp);
  for (const s of X.kids(top)) {
    if (L(s) !== 'style') continue;
    const id = X.attr(s, wp + 'styleId');
    if (!id) continue;
    styles.ids.add(id);
    const type = X.attr(s, wp + 'type');
    if (type === 'character') styles.charIds.add(id);
    if (type && type !== 'paragraph') continue;
    let name = '';
    let outline = null;
    for (const c of X.kids(s)) {
      if (L(c) === 'name') name = X.attr(c, wp + 'val') || '';
      if (L(c) === 'pPr') for (const o of X.kids(c)) if (L(o) === 'outlineLvl') outline = parseInt(X.attr(o, wp + 'val'), 10);
    }
    styles.para[id] = { name, outline: Number.isFinite(outline) ? outline : null };
  }
  return styles;
}

function headingLevel(styleId, styles, ownOutline) {
  if (Number.isFinite(ownOutline) && ownOutline >= 0 && ownOutline < 9) return Math.min(6, ownOutline + 1);
  if (!styleId) return 0;
  const s = styles.para[styleId];
  const name = (s && s.name) || styleId;
  let m = /^heading\s*([1-9])$/i.exec(name) || /^Heading([1-9])$/.exec(styleId);
  if (m) return Math.min(6, parseInt(m[1], 10));
  if (/^title$/i.test(name)) return 1;
  if (s && Number.isFinite(s.outline) && s.outline >= 0 && s.outline < 9) return Math.min(6, s.outline + 1);
  return 0;
}

// ---------- paragraph text ----------
// The text each run child stands for. The DOCX export splits runs with the same function, so the
// offsets of the model and the export always agree.
function runChildText(el, l, wp) {
  switch (l) {
    case 't': return el.c ? X.decode(el.c.join('')) : '';
    case 'tab': case 'ptab': return '\t';
    case 'br': case 'cr': return '\n';
    case 'noBreakHyphen': return '-';
    case 'sym': case 'drawing': case 'pict': case 'object': case 'footnoteReference': case 'endnoteReference': return OBJ;
    default: return '';
  }
}

function mathText(el) {
  const parts = [];
  const walk = (n) => {
    if (!n.c) return;
    for (const c of n.c) {
      if (typeof c === 'string') continue;
      if (/(^|:)t$/.test(c.n) && c.c) parts.push(X.decode(c.c.join('')));
      else walk(c);
    }
  };
  walk(el);
  return parts.join('') || OBJ;
}

function runFmt(rPr, L, wp) {
  if (!rPr) return PLAIN;
  const o = {};
  for (const c of X.kids(rPr)) {
    switch (L(c)) {
      case 'rStyle': o.cs = X.attr(c, wp + 'val') || ''; break;
      case 'b': if (toggle(c)) o.b = 1; break;
      case 'i': if (toggle(c)) o.i = 1; break;
      case 'u': { const v = X.attr(c, wp + 'val'); if (v !== 'none') o.u = 1; break; }
      case 'strike': case 'dstrike': if (toggle(c)) o.s = 1; break;
      case 'sz': { const v = parseInt(X.attr(c, wp + 'val'), 10); if (Number.isFinite(v)) o.sz = v; break; }
      case 'vertAlign': { const v = X.attr(c, wp + 'val'); if (v === 'superscript' || v === 'subscript') o.va = v === 'superscript' ? 'sup' : 'sub'; break; }
    }
  }
  return fmtOf(o);
}

const CONTAINERS = new Set(['hyperlink', 'smartTag', 'fldSimple', 'customXml', 'dir', 'bdo', 'ins', 'moveTo']);

// Text and formatting segments of one paragraph.
function paragraphText(p, L, wp) {
  let text = '';
  const segs = [];
  const push = (s, f) => {
    if (!s) return;
    const last = segs[segs.length - 1];
    if (last && last.f === f && last.e === text.length) last.e += s.length;
    else segs.push({ s: text.length, e: text.length + s.length, f });
    text += s;
  };
  const walk = (el) => {
    for (const c of el.c || []) {
      if (typeof c === 'string') continue;
      const l = L(c);
      if (l === 'r') {
        let rPr = null;
        for (const k of X.kids(c)) if (L(k) === 'rPr') { rPr = k; break; }
        const f = runFmt(rPr, L, wp);
        for (const k of X.kids(c)) { const kl = L(k); if (kl && kl !== 'rPr') push(runChildText(k, kl, wp), f); }
      } else if (l && CONTAINERS.has(l)) walk(c);
      else if (l === 'sdt') { for (const k of X.kids(c)) if (L(k) === 'sdtContent') walk(k); }
      else if (/(^|:)oMath(Para)?$/.test(c.n)) push(mathText(c), fmtOf({ m: 1 }));
    }
  };
  walk(p);
  return { text, segs };
}

function paragraphBlock(p, L, wp, styles) {
  let style = '';
  let outline = null;
  let list = 0;
  for (const c of X.kids(p)) {
    if (L(c) !== 'pPr') continue;
    for (const k of X.kids(c)) {
      const l = L(k);
      if (l === 'pStyle') style = X.attr(k, wp + 'val') || '';
      else if (l === 'numPr') list = 1;
      else if (l === 'outlineLvl') outline = parseInt(X.attr(k, wp + 'val'), 10);
    }
  }
  const { text, segs } = paragraphText(p, L, wp);
  return { t: 'p', text, segs, style, lvl: headingLevel(style, styles, outline), list, node: p };
}

function flatText(el, L, wp) {
  const parts = [];
  const walk = (n) => {
    for (const c of n.c || []) {
      if (typeof c === 'string') continue;
      const l = L(c);
      if (l === 'p') { parts.push(paragraphText(c, L, wp).text); continue; }
      walk(c);
    }
  };
  walk(el);
  return parts.join('\n');
}

// Block-level children of a body, cell or content control. Returns { items, blocks }; items keep the
// original order (for the export), blocks are the comparable units.
function readItems(container, ctx, depth, blocks) {
  const { L, wp, styles } = ctx;
  const items = [];
  for (const c of container.c || []) {
    if (typeof c === 'string') continue;
    const l = L(c);
    if (l === 'p') {
      blocks.push(paragraphBlock(c, L, wp, styles));
      items.push({ b: blocks.length - 1 });
    } else if (l === 'tbl') {
      blocks.push(depth >= MAX_DEPTH ? { t: 'x', text: flatText(c, L, wp), node: c } : tableBlock(c, ctx, depth + 1));
      items.push({ b: blocks.length - 1 });
    } else if (l === 'sdt' || l === 'customXml') {
      let content = c;
      if (l === 'sdt') { content = null; for (const k of X.kids(c)) if (L(k) === 'sdtContent') content = k; }
      if (!content) { items.push({ raw: c }); continue; }
      items.push({ group: c, kind: l, items: readItems(content, ctx, depth, blocks).items });
    } else items.push({ raw: c, sect: l === 'sectPr' });
  }
  return { items, blocks };
}

function tableRows(tbl, L) {
  const rows = [];
  const walk = (el) => {
    for (const c of X.kids(el)) {
      const l = L(c);
      if (l === 'tr') rows.push(c);
      else if (l === 'sdt') { for (const k of X.kids(c)) if (L(k) === 'sdtContent') walk(k); }
      else if (l === 'customXml') walk(c);
    }
  };
  walk(tbl);
  return rows;
}

function rowCells(tr, L) {
  const cells = [];
  const walk = (el) => {
    for (const c of X.kids(el)) {
      const l = L(c);
      if (l === 'tc') cells.push(c);
      else if (l === 'sdt') { for (const k of X.kids(c)) if (L(k) === 'sdtContent') walk(k); }
      else if (l === 'customXml') walk(c);
    }
  };
  walk(tr);
  return cells;
}

function tableBlock(tbl, ctx, depth) {
  const rows = tableRows(tbl, ctx.L).map((tr) => ({
    node: tr,
    cells: rowCells(tr, ctx.L).map((tc) => { const r = readItems(tc, ctx, depth, []); return { node: tc, items: r.items, blocks: r.blocks }; })
  }));
  return { t: 'tbl', rows, node: tbl, text: tableText(rows) };
}

function tableText(rows) {
  return rows.map((r) => r.cells.map((c) => c.blocks.map((b) => b.text).join('\n')).join('\t')).join('\n');
}

// documentXml (string), stylesXml (string or ''). Returns the model; throws XmlError on bad XML.
function fromDocx(documentXml, stylesXml) {
  const root = X.parse(documentXml);
  const top = X.kids(root)[0];
  if (!top) throw new X.XmlError('word/document.xml is empty');
  const wp = prefixFor(top, W_URIS, 'w:');
  const L = namer(wp);
  const accepted = acceptAll(root, wp);
  let body = null;
  for (const c of X.kids(top)) if (L(c) === 'body') body = c;
  if (!body) throw new X.XmlError('word/document.xml has no body');
  const styles = readStyles(stylesXml);
  const ctx = { L, wp, styles };
  const { items, blocks } = readItems(body, ctx, 0, []);
  return { kind: 'docx', root, body, wp, mp: prefixFor(top, M_URIS, 'm:'), styles, items, blocks, accepted };
}

// ---------- OpenDocument and Word 97-2003, from the converter's sanitized HTML tree ----------
const H_BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'dt', 'dd', 'caption']);
const H_CONTAINER = new Set(['div', 'blockquote', 'ul', 'ol', 'dl', 'thead', 'tbody', 'tfoot', 'section', 'root']);

function inlineSegs(nodes, fmt, acc) {
  for (const n of nodes) {
    if (n.type === 'text') { pushSeg(acc, n.text.replace(/\s+/g, ' '), fmt); continue; }
    if (n.type !== 'el') continue;
    const t = n.tag;
    if (t === 'br') { pushSeg(acc, '\n', fmt); continue; }
    if (t === 'img') { pushSeg(acc, OBJ, fmt); continue; }
    if (t === 'ul' || t === 'ol' || t === 'table') continue; // handled as blocks
    const f = Object.assign({}, fmt);
    if (t === 'strong' || t === 'b') f.b = 1;
    else if (t === 'em' || t === 'i') f.i = 1;
    else if (t === 'u' || t === 'ins') f.u = 1;
    else if (t === 's' || t === 'del') f.s = 1;
    else if (t === 'sup') f.va = 'sup';
    else if (t === 'sub') f.va = 'sub';
    inlineSegs(n.children || [], f, acc);
  }
}

function pushSeg(acc, s, fmtObj) {
  if (!s) return;
  const f = fmtOf(fmtObj);
  const last = acc.segs[acc.segs.length - 1];
  if (last && last.f === f && last.e === acc.text.length) last.e += s.length;
  else acc.segs.push({ s: acc.text.length, e: acc.text.length + s.length, f });
  acc.text += s;
}

function htmlParagraph(nodes, lvl, list) {
  const acc = { text: '', segs: [] };
  inlineSegs(nodes, {}, acc);
  // Trim the edges the HTML adds; keep offsets right.
  const lead = acc.text.length - acc.text.replace(/^\s+/, '').length;
  const text = acc.text.trim();
  const segs = [];
  for (const s of acc.segs) {
    const a = Math.max(0, s.s - lead);
    const b = Math.min(text.length, s.e - lead);
    if (b > a) segs.push({ s: a, e: b, f: s.f });
  }
  return { t: 'p', text, segs, style: '', lvl, list, node: null };
}

function htmlBlocks(nodes, blocks, depth, list) {
  let inline = [];
  const flush = () => {
    if (inline.some((n) => n.type !== 'text' || n.text.trim())) blocks.push(htmlParagraph(inline, 0, 0));
    inline = [];
  };
  for (const n of nodes) {
    if (n.type === 'text' || (n.type === 'el' && !H_BLOCK.has(n.tag) && !H_CONTAINER.has(n.tag) && !['li', 'table', 'tr', 'hr'].includes(n.tag))) { inline.push(n); continue; }
    flush();
    if (n.type !== 'el') continue;
    if (H_BLOCK.has(n.tag)) {
      const m = /^h([1-6])$/.exec(n.tag);
      const p = htmlParagraph(n.children || [], m ? parseInt(m[1], 10) : 0, list);
      if (p.text) blocks.push(p);
    } else if (n.tag === 'li') {
      const own = (n.children || []).filter((k) => !(k.type === 'el' && (k.tag === 'ul' || k.tag === 'ol' || k.tag === 'table')));
      const p = htmlParagraph(own, 0, 1);
      if (p.text) blocks.push(p);
      htmlBlocks((n.children || []).filter((k) => k.type === 'el' && (k.tag === 'ul' || k.tag === 'ol' || k.tag === 'table')), blocks, depth, 1);
    } else if (n.tag === 'table') {
      if (depth >= MAX_DEPTH) { blocks.push({ t: 'x', text: htmlTextOf(n), node: null }); continue; }
      const rows = [];
      const walkRows = (el) => {
        for (const k of el.children || []) {
          if (k.type !== 'el') continue;
          if (k.tag === 'tr') rows.push({ node: null, cells: (k.children || []).filter((c) => c.type === 'el' && (c.tag === 'td' || c.tag === 'th')).map((c) => ({ node: null, items: null, blocks: htmlBlocks(c.children || [], [], depth + 1, 0) })) });
          else if (k.tag === 'thead' || k.tag === 'tbody' || k.tag === 'tfoot') walkRows(k);
        }
      };
      walkRows(n);
      blocks.push({ t: 'tbl', rows, node: null, text: tableText(rows) });
    } else if (n.tag !== 'hr') htmlBlocks(n.children || [], blocks, depth, n.tag === 'ul' || n.tag === 'ol' ? 1 : list);
  }
  flush();
  return blocks;
}

function htmlTextOf(n) {
  if (n.type === 'text') return n.text;
  return (n.children || []).map(htmlTextOf).join(' ');
}

// chunks: sanitized HTML strings from convert.js. parse: html.js parse().
function fromHtmlChunks(chunks, parse) {
  const blocks = [];
  for (const chunk of chunks) htmlBlocks(parse(chunk).children, blocks, 0, 0);
  return { kind: 'html', blocks, items: null };
}

module.exports = { fromDocx, fromHtmlChunks, acceptAll, readStyles, paragraphText, runChildText, mathText, runFmt, fmtOf, namer, prefixFor, PLAIN, OBJ, MAX_DEPTH, W_URIS, CONTAINERS };
