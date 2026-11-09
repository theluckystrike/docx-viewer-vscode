'use strict';
// Turns compare rows into HTML for the redline webview (inline and side-by-side) and for the HTML
// export. All document text is escaped here; the only markup is what this file writes.

const E = require('./engine');
const { OBJ } = require('./model');

const MAX_LIST = 5000; // change list entries sent to the webview (the counts always cover everything)

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textHtml(s) {
  let out = '';
  for (const part of s.split(/(\n|￼)/)) {
    if (part === '\n') out += '<br>';
    else if (part === OBJ) out += '<span class="rl-obj" title="Picture, chart, symbol or note reference">&#9635;</span>';
    else if (part) out += esc(part);
  }
  return out;
}

function fmtWrap(html, f) {
  if (!f || f === undefined) return html;
  const cls = [];
  if (f.b) cls.push('f-b');
  if (f.i) cls.push('f-i');
  if (f.u) cls.push('f-u');
  if (f.s) cls.push('f-s');
  if (f.m) cls.push('f-m');
  let h = cls.length ? '<span class="' + cls.join(' ') + '">' + html + '</span>' : html;
  if (f.va === 'sup') h = '<sup>' + h + '</sup>';
  else if (f.va === 'sub') h = '<sub>' + h + '</sub>';
  return h;
}

// HTML of block text [s, e) with its formatting.
function span(block, s, e) {
  if (e <= s) return '';
  const segs = block.segs || [];
  if (!segs.length) return textHtml(block.text.slice(s, e));
  let out = '';
  let pos = s;
  for (const g of segs) {
    if (g.e <= pos) continue;
    if (g.s >= e) break;
    const a = Math.max(pos, g.s);
    const b = Math.min(e, g.e);
    if (a > pos) out += textHtml(block.text.slice(pos, a));
    out += fmtWrap(textHtml(block.text.slice(a, b)), g.f);
    pos = b;
  }
  if (pos < e) out += textHtml(block.text.slice(pos, e));
  return out;
}

function snippet(s) {
  const t = s.replace(/￼/g, '[picture]').replace(/\s+/g, ' ').trim();
  return t.length > 70 ? t.slice(0, 67) + '...' : t;
}

class Renderer {
  // st: shared state { n, changes, listed } so nested cell renderers number changes in one sequence.
  constructor(A, B, opts, st) {
    this.A = A;
    this.B = B;
    this.opts = opts || {};
    this.st = st || { n: 0, changes: [], listed: 0 };
  }

  sub(A, B) { return new Renderer(A, B, this.opts, this.st); }

  change(type, text, extra) {
    const st = this.st;
    const id = 'c' + (++st.n);
    if (st.listed < MAX_LIST) { st.listed++; st.changes.push(Object.assign({ id, type, text: snippet(text) }, extra || {})); }
    return id;
  }

  tagFor(block) {
    if (block.lvl) return ['h' + block.lvl, ''];
    return ['p', block.list ? ' class="rl-li"' : ''];
  }

  // A whole block without change marks.
  plain(block) {
    if (block.t === 'tbl') return '<table class="rl-tbl"><tbody>' + block.rows.map((r) => '<tr>' + r.cells.map((c) => '<td>' + this.cellPlain(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    if (block.t === 'x') return '<p class="rl-x">' + textHtml(block.text) + '</p>';
    const [tag, cls] = this.tagFor(block);
    return '<' + tag + cls + '>' + (span(block, 0, block.text.length) || '<br>') + '</' + tag + '>';
  }

  cellPlain(c) { return c.blocks.map((blk) => this.plain(blk)).join('') || '<br>'; }

  wrapBlock(kind, id, inner) {
    return '<div class="rl-blk rl-' + kind + '" data-c="' + id + '">' + inner + '</div>';
  }

  // One paragraph with word changes. side: 'i' inline, 'l' old only, 'r' new only.
  modPara(a, b, row, side, ids) {
    let out = '';
    let k = 0;
    const fmt = (row.fmt || []).filter((f) => !f.para);
    for (const o of row.ops) {
      if (o.t === '=') {
        if (side === 'l') out += span(a, o.as, o.ae);
        else out += this.withFmt(b, o.bs, o.be, fmt, ids);
      } else if (o.t === '-') {
        const id = ids.ops[k++];
        if (side !== 'r') out += '<del class="rl-del" data-c="' + id + '">' + span(a, o.as, o.ae) + '</del>';
      } else {
        const id = ids.ops[k++];
        if (side !== 'l') out += '<ins class="rl-ins" data-c="' + id + '">' + span(b, o.bs, o.be) + '</ins>';
      }
    }
    const blk = side === 'l' ? a : b;
    const [tag, cls] = this.tagFor(blk);
    const para = (row.fmt || []).find((f) => f.para);
    if (para && side !== 'l') {
      const klass = cls ? cls.replace('class="', 'class="rl-pfmt ') : ' class="rl-pfmt"';
      return '<' + tag + klass + ' data-c="' + ids.para + '" title="' + esc(para.desc) + '">' + (out || '<br>') + '</' + tag + '>';
    }
    return '<' + tag + cls + '>' + (out || '<br>') + '</' + tag + '>';
  }

  withFmt(b, s, e, fmt, ids) {
    if (!fmt.length) return span(b, s, e);
    let out = '';
    let pos = s;
    fmt.forEach((f, i) => {
      if (f.e <= pos || f.s >= e) return;
      const a = Math.max(pos, f.s);
      const z = Math.min(e, f.e);
      if (a > pos) out += span(b, pos, a);
      out += '<span class="rl-fmt" data-c="' + ids.fmt[i] + '" title="' + esc(f.desc) + '">' + span(b, a, z) + '</span>';
      pos = z;
    });
    if (pos < e) out += span(b, pos, e);
    return out;
  }

  // Change ids for a paragraph row, in reading order.
  paraIds(a, b, row) {
    const ids = { ops: [], fmt: [], para: null };
    const para = (row.fmt || []).find((f) => f.para);
    if (para) ids.para = this.change('fmt', b.text, { desc: para.desc });
    if (row.ops) for (const o of row.ops) {
      if (o.t === '-') ids.ops.push(this.change('del', a.text.slice(o.as, o.ae)));
      else if (o.t === '+') ids.ops.push(this.change('ins', b.text.slice(o.bs, o.be)));
    }
    for (const f of (row.fmt || []).filter((x) => !x.para)) ids.fmt.push(this.change('fmt', b.text.slice(f.s, f.e), { desc: f.desc }));
    return ids;
  }

  // Returns { k, i, l, r, same } for one row.
  row(r) {
    const A = this.A;
    const B = this.B;
    switch (r.k) {
      case 'eq': {
        const b = B[r.b];
        if (!r.fmt) return { k: 'eq', i: this.plain(b), same: true };
        const a = A[r.a];
        const ids = this.paraIds(a, b, r);
        const rr = Object.assign({}, r, { ops: [{ t: '=', as: 0, ae: a.text.length, bs: 0, be: b.text.length }] });
        return { k: 'fmt', i: this.modPara(a, b, rr, 'i', ids), l: this.plain(a), r: this.modPara(a, b, rr, 'r', ids) };
      }
      case 'mod': {
        const a = A[r.a];
        const b = B[r.b];
        const ids = this.paraIds(a, b, r);
        return { k: 'mod', i: this.modPara(a, b, r, 'i', ids), l: this.modPara(a, b, r, 'l', ids), r: this.modPara(a, b, r, 'r', ids) };
      }
      case 'ins': {
        const b = B[r.b];
        const h = this.wrapBlock('ins', this.change('ins', b.t === 'tbl' ? 'Table: ' + b.text : b.text), this.plain(b));
        return { k: 'ins', i: h, l: '', r: h };
      }
      case 'del': {
        const a = A[r.a];
        const h = this.wrapBlock('del', this.change('del', a.t === 'tbl' ? 'Table: ' + a.text : a.text), this.plain(a));
        return { k: 'del', i: h, l: h, r: '' };
      }
      case 'mf': {
        const h = '<div class="rl-blk rl-mf" data-c="m' + r.mv + 'f" data-mv="' + r.mv + '"><span class="rl-tag">Moved away (move ' + r.mv + ')</span>' + this.plain(A[r.a]) + '</div>';
        return { k: 'mf', i: h, l: h, r: '' };
      }
      case 'mt': {
        const b = B[r.b];
        const id = this.change('move', b.text, { mv: r.mv });
        const h = '<div class="rl-blk rl-mt" data-c="' + id + '" data-mv="' + r.mv + '"><span class="rl-tag">Moved here (move ' + r.mv + ')</span>' + this.plain(b) + '</div>';
        return { k: 'mt', i: h, l: '', r: h };
      }
      case 'tbl': {
        const a = A[r.a];
        const b = B[r.b];
        const meta = this.prepTable(a, b, r);
        return { k: 'tbl', i: this.tableSide(a, b, r, meta, 'i'), l: this.tableSide(a, b, r, meta, 'l'), r: this.tableSide(a, b, r, meta, 'r') };
      }
      default:
        return { k: 'eq', i: '', same: true };
    }
  }

  // Change ids and sub-renders for the rows and cells of a changed table, in reading order.
  prepTable(a, b, r) {
    const meta = new Map();
    for (const tr of r.rows) {
      if (tr.k === 'ins') meta.set(tr, this.change('ins', 'Table row: ' + rowText(b.rows[tr.b])));
      else if (tr.k === 'del') meta.set(tr, this.change('del', 'Table row: ' + rowText(a.rows[tr.a])));
      else if (tr.k === 'mod') {
        tr.cells.forEach((c, ci) => {
          if (!c.changed) return;
          const ca = c.a === null ? null : a.rows[tr.a].cells[c.a];
          const cb = b.rows[tr.b].cells[ci];
          const cid = this.change('cell', 'Table cell: ' + cellText(cb));
          const sub = this.sub(ca ? ca.blocks : [], cb.blocks);
          meta.set(c, { cid, parts: c.rows.map((x) => sub.row(x)) });
        });
      }
    }
    return meta;
  }

  tableSide(a, b, r, meta, side) {
    let out = '<table class="rl-tbl"><tbody>';
    const cells = (row) => row.cells.map((c) => '<td>' + this.cellPlain(c) + '</td>').join('');
    for (const tr of r.rows) {
      if (tr.k === 'eq') out += '<tr>' + cells(side === 'l' ? a.rows[tr.a] : b.rows[tr.b]) + '</tr>';
      else if (tr.k === 'ins') { if (side !== 'l') out += '<tr class="rl-tr-ins" data-c="' + meta.get(tr) + '">' + cells(b.rows[tr.b]) + '</tr>'; }
      else if (tr.k === 'del') { if (side !== 'r') out += '<tr class="rl-tr-del" data-c="' + meta.get(tr) + '">' + cells(a.rows[tr.a]) + '</tr>'; }
      else {
        const ra = a.rows[tr.a];
        const rb = b.rows[tr.b];
        out += '<tr>';
        tr.cells.forEach((c, ci) => {
          const m = meta.get(c);
          if (side === 'l') {
            if (c.a === null) return;
            const ca = ra.cells[c.a];
            out += m ? '<td class="rl-cell" data-c="' + m.cid + '">' + m.parts.map((x) => (x.same ? x.i : x.l)).join('') + '</td>' : '<td>' + this.cellPlain(ca) + '</td>';
            return;
          }
          if (!m) { out += '<td>' + this.cellPlain(rb.cells[ci]) + '</td>'; return; }
          const key = side === 'r' ? 'r' : 'i';
          out += '<td class="rl-cell" data-c="' + m.cid + '">' + m.parts.map((x) => (x.same ? x.i : x[key])).join('') + '</td>';
        });
        out += '</tr>';
      }
    }
    return out + '</tbody></table>';
  }
}

function rowText(r) { return r.cells.map((c) => cellText(c)).join(' | '); }
function cellText(c) { return c.blocks.map((b) => b.text).join(' '); }

// Main entry: rows from engine.compare. Returns the payload for the webview and the HTML export.
function renderAll(A, B, result, opts) {
  const R = new Renderer(A, B, opts);
  const rows = result.rows.map((r) => R.row(r));
  return { rows, changes: R.st.changes, total: R.st.n, counts: E.summarize(result.rows), listed: R.st.listed };
}

module.exports = { renderAll, esc, textHtml, span, snippet, MAX_LIST };
