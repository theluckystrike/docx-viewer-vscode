'use strict';
// Compares two block lists (see model.js) and returns aligned rows:
//   { k: 'eq', a, b, fmt? }        same text; fmt lists formatting-only changes
//   { k: 'mod', a, b, ops, fmt? }  changed paragraph; ops from diff.words()
//   { k: 'del', a } / { k: 'ins', b }
//   { k: 'mf', a, mv } / { k: 'mt', b, mv }   moved paragraph (move id mv)
//   { k: 'tbl', a, b, rows: [ { k, a, b, cells: [ { a, b, rows } ] } ] }   changed table, per row and cell
// a and b are block indexes in the old and the new list. Rows are in reading order of the new document,
// with old-only rows at the place they had.

const D = require('./diff');

const MOVE_MIN_CHARS = 12;
const PAIR_MIN_SIMILARITY = 0.45;
const PAIR_WINDOW = 8;

function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
function keyOf(b) { return (b.t === 'tbl' ? 'T\u0001' : b.t === 'x' ? 'X\u0001' : 'P\u0001') + norm(b.text); }

function compare(A, B, opts) {
  const ctx = { opts: opts || {}, moves: 0 };
  const rows = compareBlocks(A, B, ctx, 0, true);
  return { rows, moves: ctx.moves };
}

function compareBlocks(A, B, ctx, depth, allowMoves) {
  const ka = A.map(keyOf);
  const kb = B.map(keyOf);
  const ops = D.diff(ka, kb);
  // Rows with placeholders for the gaps (runs of '-' and '+').
  const parts = [];
  let gap = null;
  for (const o of ops) {
    if (o.t === '=') {
      gap = null;
      for (let i = 0; i < o.n; i++) parts.push(eqRow(A[o.a + i], B[o.b + i], o.a + i, o.b + i, ctx, depth));
      continue;
    }
    if (!gap) { gap = { gap: true, dels: [], inss: [] }; parts.push(gap); }
    for (let i = 0; i < o.n; i++) (o.t === '-' ? gap.dels : gap.inss).push(o.t === '-' ? o.a + i : o.b + i);
  }
  const gaps = parts.filter((p) => p.gap);
  const moved = allowMoves ? findMoves(gaps, A, B, ctx) : { from: new Map(), to: new Map() };
  const rows = [];
  for (const p of parts) {
    if (!p.gap) { rows.push(p); continue; }
    fillGap(p, A, B, ctx, depth, moved, rows);
  }
  return rows;
}

function eqRow(a, b, ai, bi, ctx, depth) {
  if (a.t === 'tbl' && b.t === 'tbl') {
    // Same text. Formatting inside cells can still differ.
    if (!ctx.opts.formatting) return { k: 'eq', a: ai, b: bi };
    const t = tableRows(a, b, ctx, depth);
    return t.changed ? { k: 'tbl', a: ai, b: bi, rows: t.rows } : { k: 'eq', a: ai, b: bi };
  }
  const row = { k: 'eq', a: ai, b: bi };
  if (a.t === 'p' && b.t === 'p') {
    const fmt = fmtChanges(a, b, [{ t: '=', as: 0, ae: a.text.length, bs: 0, be: b.text.length }], styleChanged(a, b, ctx), ctx.opts.cross);
    if (fmt.length) row.fmt = fmt;
  }
  return row;
}

// Exact-text paragraphs deleted in one place and inserted in another.
function findMoves(gaps, A, B, ctx) {
  const from = new Map(); // old index -> move id
  const to = new Map(); // new index -> move id
  const byText = new Map();
  for (const g of gaps) for (const ai of g.dels) {
    const blk = A[ai];
    if (blk.t !== 'p') continue;
    const k = norm(blk.text);
    if (k.length < MOVE_MIN_CHARS || !/\s/.test(k)) continue;
    if (!byText.has(k)) byText.set(k, []);
    byText.get(k).push(ai);
  }
  if (!byText.size) return { from, to };
  for (const g of gaps) for (const bi of g.inss) {
    const blk = B[bi];
    if (blk.t !== 'p') continue;
    const list = byText.get(norm(blk.text));
    if (!list || !list.length) continue;
    const ai = list.shift();
    const id = ++ctx.moves;
    from.set(ai, id);
    to.set(bi, id);
  }
  return { from, to };
}

function fillGap(g, A, B, ctx, depth, moved, rows) {
  const dels = g.dels;
  const inss = g.inss;
  let j = 0;
  const emitIns = (upTo) => {
    for (; j < upTo; j++) {
      const bi = inss[j];
      if (moved.to.has(bi)) rows.push({ k: 'mt', b: bi, mv: moved.to.get(bi) });
      else rows.push({ k: 'ins', b: bi });
    }
  };
  const big = dels.length * inss.length > 40000;
  for (const ai of dels) {
    if (moved.from.has(ai)) { rows.push({ k: 'mf', a: ai, mv: moved.from.get(ai) }); continue; }
    const a = A[ai];
    let best = -1;
    let bestSim = PAIR_MIN_SIMILARITY;
    const end = Math.min(inss.length, j + (big ? 3 : PAIR_WINDOW));
    for (let k = j; k < end; k++) {
      const bi = inss[k];
      if (moved.to.has(bi)) continue;
      const b = B[bi];
      if (b.t !== a.t) continue;
      if (a.t === 'tbl') { best = k; break; } // tables in the same gap pair up and compare per cell
      const s = D.similarity(a.text, b.text);
      if (s > bestSim) { bestSim = s; best = k; }
    }
    if (best === -1) { rows.push({ k: 'del', a: ai }); continue; }
    emitIns(best);
    const bi = inss[best];
    j = best + 1;
    rows.push(pairRow(a, B[bi], ai, bi, ctx, depth));
  }
  emitIns(inss.length);
}

function pairRow(a, b, ai, bi, ctx, depth) {
  if (a.t === 'tbl') {
    const t = tableRows(a, b, ctx, depth);
    return { k: 'tbl', a: ai, b: bi, rows: t.rows };
  }
  if (a.t === 'x') return { k: 'mod', a: ai, b: bi, ops: D.words(a.text, b.text) };
  const ops = D.words(a.text, b.text);
  const row = { k: 'mod', a: ai, b: bi, ops };
  const fmt = fmtChanges(a, b, ops, styleChanged(a, b, ctx), ctx.opts.cross);
  if (fmt.length) row.fmt = fmt;
  return row;
}

// ---------- tables ----------
function rowKey(r) { return r.cells.map((c) => norm(c.blocks.map((b) => b.text).join('\n'))).join('\u0002'); }

function tableRows(a, b, ctx, depth) {
  const ops = D.diff(a.rows.map(rowKey), b.rows.map(rowKey));
  const rows = [];
  let changed = false;
  let dels = [];
  let inss = [];
  const flush = () => {
    // Pair deleted and inserted rows in order when they have the same number of cells.
    let j = 0;
    for (const ai of dels) {
      let k = j;
      while (k < inss.length && k < j + 4 && b.rows[inss[k]].cells.length !== a.rows[ai].cells.length) k++;
      if (k < inss.length && k < j + 4 && b.rows[inss[k]].cells.length === a.rows[ai].cells.length) {
        for (; j < k; j++) rows.push({ k: 'ins', b: inss[j] });
        rows.push(cellRow(a.rows[ai], b.rows[inss[k]], ai, inss[k], ctx, depth));
        j = k + 1;
      } else rows.push({ k: 'del', a: ai });
    }
    for (; j < inss.length; j++) rows.push({ k: 'ins', b: inss[j] });
    if (dels.length || inss.length) changed = true;
    dels = [];
    inss = [];
  };
  for (const o of ops) {
    if (o.t === '=') {
      flush();
      for (let i = 0; i < o.n; i++) {
        const ra = a.rows[o.a + i];
        const rb = b.rows[o.b + i];
        if (ctx.opts.formatting) {
          const r = cellRow(ra, rb, o.a + i, o.b + i, ctx, depth);
          if (r.k !== 'eq') { changed = true; rows.push(r); continue; }
        }
        rows.push({ k: 'eq', a: o.a + i, b: o.b + i });
      }
    } else if (o.t === '-') for (let i = 0; i < o.n; i++) dels.push(o.a + i);
    else for (let i = 0; i < o.n; i++) inss.push(o.b + i);
  }
  flush();
  return { rows, changed };
}

function cellRow(ra, rb, ai, bi, ctx, depth) {
  const cells = [];
  let any = false;
  for (let c = 0; c < rb.cells.length; c++) {
    const ca = ra.cells[c];
    const cb = rb.cells[c];
    const sub = compareBlocks(ca ? ca.blocks : [], cb.blocks, ctx, depth + 1, false);
    const chg = sub.some(rowChanged);
    if (chg) any = true;
    cells.push({ a: ca ? c : null, b: c, rows: sub, changed: chg });
  }
  return any ? { k: 'mod', a: ai, b: bi, cells } : { k: 'eq', a: ai, b: bi };
}

function rowChanged(r) {
  return r.k !== 'eq' || !!(r.fmt && r.fmt.length);
}

// ---------- formatting ----------
// Paragraph styles only compare between two Word files: OpenDocument and .doc files carry headings only.
function styleChanged(a, b, ctx) {
  if (ctx.opts.cross) return a.lvl !== b.lvl;
  return a.style !== b.style || a.lvl !== b.lvl;
}

// The properties both readers know (bold, italic, underline, strike, super/subscript) for a mixed pair.
function sameFmt(fa, fb, cross) {
  if (fa === fb) return true;
  if (!cross) return false;
  return !!fa.b === !!fb.b && !!fa.i === !!fb.i && !!fa.u === !!fb.u && !!fa.s === !!fb.s && (fa.va || '') === (fb.va || '');
}

const FMT_NAMES = { b: 'bold', i: 'italic', u: 'underline', s: 'strikethrough' };

function fmtAt(segs, pos) {
  // segs are sorted; binary search
  let lo = 0;
  let hi = segs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segs[mid];
    if (pos < s.s) hi = mid - 1; else if (pos >= s.e) lo = mid + 1; else return s.f;
  }
  return null;
}

function describe(fa, fb) {
  const parts = [];
  for (const k of ['b', 'i', 'u', 's']) {
    if (!!fa[k] !== !!fb[k]) parts.push(FMT_NAMES[k] + (fb[k] ? ' on' : ' off'));
  }
  if ((fa.sz || 0) !== (fb.sz || 0)) parts.push('size ' + (fa.sz ? fa.sz / 2 + ' pt' : 'default') + ' to ' + (fb.sz ? fb.sz / 2 + ' pt' : 'default'));
  if ((fa.va || '') !== (fb.va || '')) parts.push(fb.va ? (fb.va === 'sup' ? 'superscript' : 'subscript') : 'normal position');
  if ((fa.cs || '') !== (fb.cs || '')) parts.push('character style ' + (fb.cs || 'none'));
  return parts.join(', ');
}

// Formatting-only changes inside the equal ranges of ops. Returns [{ s, e, was, desc }] in new offsets,
// plus one { para: true, desc } entry when the paragraph style changed.
function fmtChanges(a, b, ops, styleChanged, cross) {
  const out = [];
  if (styleChanged && (a.style || b.style || a.lvl || b.lvl)) {
    const name = (blk) => (blk.lvl ? 'Heading ' + blk.lvl : blk.style || 'Normal');
    if (name(a) !== name(b)) out.push({ para: true, s: 0, e: b.text.length, desc: 'paragraph style ' + name(a) + ' to ' + name(b), wasStyle: a.style || '' });
  }
  if (!a.segs || !b.segs || (a.segs.length === 1 && b.segs.length === 1 && a.segs[0].f === b.segs[0].f)) return out;
  for (const o of ops) {
    if (o.t !== '=') continue;
    let run = null;
    const len = o.be - o.bs;
    for (let i = 0; i < len; i++) {
      const ch = b.text.charCodeAt(o.bs + i);
      const fa = fmtAt(a.segs, o.as + i);
      const fb = fmtAt(b.segs, o.bs + i);
      const diff = fa && fb && !sameFmt(fa, fb, cross) && !(ch === 32 || ch === 9);
      if (diff && run && run.was === fa && run.now === fb && run.e === o.bs + i) { run.e++; continue; }
      if (diff && run && run.was === fa && run.now === fb) { run.e = o.bs + i + 1; continue; }
      if (diff) { run = { s: o.bs + i, e: o.bs + i + 1, was: fa, now: fb }; out.push(run); } else if (run && !(ch === 32 || ch === 9)) run = null;
    }
  }
  for (const r of out) if (!r.para) { r.desc = describe(r.was, r.now); delete r.now; }
  return out.filter((r) => r.para || r.desc);
}

// ---------- counts ----------
function summarize(rows) {
  const s = { insertions: 0, deletions: 0, moves: 0, cells: 0, formatting: 0 };
  const walk = (list, inCell) => {
    for (const r of list) {
      if (r.k === 'ins') s.insertions++;
      else if (r.k === 'del') s.deletions++;
      else if (r.k === 'mt') s.moves++;
      else if (r.k === 'mod' && r.ops) for (const o of r.ops) { if (o.t === '+') s.insertions++; else if (o.t === '-') s.deletions++; }
      if (r.fmt) s.formatting += r.fmt.length;
      if (r.k === 'tbl') {
        for (const tr of r.rows) {
          if (tr.k === 'ins' || tr.k === 'del') { s[tr.k === 'ins' ? 'insertions' : 'deletions']++; continue; }
          if (tr.cells) for (const c of tr.cells) if (c.changed) { s.cells++; walk(c.rows, true); }
        }
      }
    }
  };
  walk(rows, false);
  return s;
}

function summaryText(s, withFormatting) {
  const p = (n, one, many) => n.toLocaleString('en-US') + ' ' + (n === 1 ? one : many);
  const parts = [p(s.insertions, 'insertion', 'insertions'), p(s.deletions, 'deletion', 'deletions'), p(s.moves, 'move', 'moves'), p(s.cells, 'table cell', 'table cells')];
  if (withFormatting) parts.push(p(s.formatting, 'formatting change', 'formatting changes'));
  return parts.join(', ');
}

module.exports = { compare, summarize, summaryText, keyOf, norm, fmtAt, describe };
