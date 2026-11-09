'use strict';
// Writes the redline as a new Word document with real tracked changes. The base is the newer document
// (its styles, numbering, headers, footers, pictures and comments stay as they are). Changed text gets
// w:ins / w:del, moved paragraphs w:moveFrom / w:moveTo with move ranges, inserted and deleted table rows
// w:trPr/w:ins and w:del, formatting changes w:rPrChange / w:pPrChange. Deleted content is written from the
// older document's model (text and basic formatting), never copied as XML, so no relationship id, picture or
// bookmark of the older file can end up dangling in the new package.

const X = require('./xml');
const M = require('./model');

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

class Writer {
  constructor(newModel, oldModel, opts) {
    this.N = newModel;
    this.O = oldModel;
    this.wp = newModel.wp;
    this.L = M.namer(this.wp);
    this.opts = Object.assign({ author: 'Compare', date: new Date().toISOString().slice(0, 10) + 'T00:00:00Z', formatting: true }, opts || {});
    this.id = (opts && opts.firstId) || 900000;
    this.moveIds = new Map();
    this.styleIds = newModel.styles.ids;
  }

  q(l) { return this.wp + l; }

  revAttrs() {
    return ' ' + this.q('id') + '="' + (this.id++) + '" ' + this.q('author') + '="' + X.escapeAttr(this.opts.author) + '" ' + this.q('date') + '="' + this.opts.date + '"';
  }

  mark(kind) { return '<' + this.q(kind) + this.revAttrs() + '/>'; }

  // ---------- containers (body, cell, content control) ----------
  container(items, rows, A, B, inCell) {
    const out = [];
    const rowOfB = new Map();
    rows.forEach((r, i) => { if (r.b !== undefined) rowOfB.set(r.b, i); });
    let cursor = 0;
    const flushTo = (idx) => {
      for (; cursor < idx; cursor++) {
        const r = rows[cursor];
        if (r.b === undefined) out.push(this.oldRow(r, A));
      }
    };
    const walk = (list) => {
      for (const it of list) {
        if (it.b !== undefined) {
          const idx = rowOfB.get(it.b);
          if (idx === undefined) { out.push(X.serialize(B[it.b].node)); continue; }
          flushTo(idx);
          out.push(this.newRow(rows[idx], A, B));
          cursor = Math.max(cursor, idx + 1);
        } else if (it.group) {
          const g = it.group;
          if (it.kind === 'sdt') {
            out.push('<' + g.n + g.a + '>');
            for (const c of X.kids(g)) {
              if (this.L(c) === 'sdtContent') { out.push('<' + c.n + c.a + '>'); walk(it.items); out.push('</' + c.n + '>'); } else out.push(X.serialize(c));
            }
            out.push('</' + g.n + '>');
          } else { out.push('<' + g.n + g.a + '>'); walk(it.items); out.push('</' + g.n + '>'); }
        } else {
          if (it.sect) flushTo(rows.length);
          out.push(X.serialize(it.raw));
        }
      }
    };
    walk(items || []);
    flushTo(rows.length);
    let xml = out.join('');
    if (inCell && !new RegExp('(</' + this.q('p') + '>|<' + this.q('p') + '[^>]*/>)\\s*$').test(xml)) xml += '<' + this.q('p') + '/>';
    return xml;
  }

  newRow(r, A, B) {
    const b = B[r.b];
    switch (r.k) {
      case 'eq':
        if (r.fmt && this.opts.formatting && b.t === 'p') return this.para(b, this.spec(A[r.a], b, [{ t: '=', as: 0, ae: A[r.a].text.length, bs: 0, be: b.text.length }], r.fmt));
        return X.serialize(b.node);
      case 'mod':
        if (b.t !== 'p') return X.serialize(b.node); // a table nested too deep: compared as text, written as it is
        return this.para(b, this.spec(A[r.a], b, r.ops, r.fmt));
      case 'ins': return this.inserted(b);
      case 'mt': return this.para(b, { all: 'moveTo', mv: r.mv, ins: [], dels: [], fmt: [] });
      case 'tbl': return this.table(A[r.a], b, r);
      default: return X.serialize(b.node);
    }
  }

  oldRow(r, A) {
    const a = A[r.a];
    if (r.k === 'mf') return this.oldPara(a, 'moveFrom', r.mv);
    return this.old(a, 'del');
  }

  // ---------- paragraphs of the newer document ----------
  spec(a, b, ops, fmt) {
    const s = { ins: [], dels: [], fmt: [], para: null };
    let bpos = 0;
    for (const o of ops) {
      if (o.t === '=') bpos = o.be;
      else if (o.t === '+') { s.ins.push([o.bs, o.be]); bpos = o.be; } else s.dels.push({ at: bpos, a, s: o.as, e: o.ae });
    }
    if (this.opts.formatting && fmt) for (const f of fmt) { if (f.para) s.para = f; else s.fmt.push(f); }
    return s;
  }

  para(p, spec) {
    const node = p.node;
    const st = {
      off: 0,
      dels: spec.dels.slice(),
      insAt: (pos) => spec.all ? true : spec.ins.some(([s, e]) => pos >= s && pos < e),
      fmtAt: (pos) => { for (let i = 0; i < spec.fmt.length; i++) { const f = spec.fmt[i]; if (pos >= f.s && pos < f.e) return i; } return -1; },
      spec
    };
    const out = ['<' + node.n + node.a + '>'];
    let pPr = null;
    for (const c of X.kids(node)) if (this.L(c) === 'pPr') { pPr = c; break; }
    let markXml = '';
    if (spec.all === 'ins') markXml = this.mark('ins');
    else if (spec.all === 'moveTo') markXml = this.mark('moveTo');
    let changeXml = '';
    if (spec.para) {
      const was = spec.para.wasStyle && this.styleIds.has(spec.para.wasStyle) ? '<' + this.q('pStyle') + ' ' + this.q('val') + '="' + X.escapeAttr(spec.para.wasStyle) + '"/>' : '';
      changeXml = '<' + this.q('pPrChange') + this.revAttrs() + '><' + this.q('pPr') + '>' + was + '</' + this.q('pPr') + '></' + this.q('pPrChange') + '>';
    }
    out.push(this.pPr(pPr, markXml, changeXml));
    let moveName = null;
    if (spec.all === 'moveTo') {
      moveName = 'move' + spec.mv;
      const id = this.id++;
      this.moveIds.set('to' + spec.mv, id);
      out.push('<' + this.q('moveToRangeStart') + ' ' + this.q('id') + '="' + id + '" ' + this.q('author') + '="' + X.escapeAttr(this.opts.author) + '" ' + this.q('date') + '="' + this.opts.date + '" ' + this.q('name') + '="' + moveName + '"/>');
    }
    this.content(node.c || [], st, out, true);
    this.flushDels(st, Infinity, out);
    if (moveName) out.push('<' + this.q('moveToRangeEnd') + ' ' + this.q('id') + '="' + this.moveIds.get('to' + spec.mv) + '"/>');
    out.push('</' + node.n + '>');
    return out.join('');
  }

  // pPr with a paragraph-mark revision (first child of its rPr) and a pPrChange (last child).
  pPr(pPr, markXml, changeXml) {
    if (!pPr) {
      if (!markXml && !changeXml) return '';
      return '<' + this.q('pPr') + '>' + (markXml ? '<' + this.q('rPr') + '>' + markXml + '</' + this.q('rPr') + '>' : '') + changeXml + '</' + this.q('pPr') + '>';
    }
    if (!markXml && !changeXml) return X.serialize(pPr);
    const parts = [];
    let placed = !markXml;
    for (const c of pPr.c || []) {
      if (typeof c === 'string') { parts.push(c); continue; }
      const l = this.L(c);
      if (l === 'rPr' && !placed) {
        parts.push('<' + c.n + c.a + '>' + markXml + (c.c || []).map((k) => X.serialize(k)).join('') + '</' + c.n + '>');
        placed = true;
        continue;
      }
      if ((l === 'sectPr' || l === 'pPrChange') && !placed) { parts.push('<' + this.q('rPr') + '>' + markXml + '</' + this.q('rPr') + '>'); placed = true; }
      parts.push(X.serialize(c));
    }
    if (!placed) parts.push('<' + this.q('rPr') + '>' + markXml + '</' + this.q('rPr') + '>');
    if (changeXml) parts.push(changeXml);
    return '<' + pPr.n + pPr.a + '>' + parts.join('') + '</' + pPr.n + '>';
  }

  flushDels(st, upTo, out) {
    while (st.dels.length && st.dels[0].at <= upTo) {
      const d = st.dels.shift();
      out.push(this.oldRuns(d.a, d.s, d.e, 'del'));
    }
  }

  content(children, st, out, top) {
    for (const c of children) {
      if (typeof c === 'string') { out.push(c); continue; }
      const l = this.L(c);
      if (top && l === 'pPr') continue;
      if (l === 'r') { this.run(c, st, out); continue; }
      if (l && M.CONTAINERS.has(l)) {
        out.push('<' + c.n + c.a + '>');
        this.content(c.c || [], st, out, false);
        out.push('</' + c.n + '>');
        continue;
      }
      if (l === 'sdt') {
        out.push('<' + c.n + c.a + '>');
        for (const k of X.kids(c)) {
          if (this.L(k) === 'sdtContent') { out.push('<' + k.n + k.a + '>'); this.content(k.c || [], st, out, false); out.push('</' + k.n + '>'); } else out.push(X.serialize(k));
        }
        out.push('</' + c.n + '>');
        continue;
      }
      if (/(^|:)oMath(Para)?$/.test(c.n)) {
        this.flushDels(st, st.off, out);
        out.push(X.serialize(c));
        st.off += M.mathText(c).length;
        continue;
      }
      out.push(X.serialize(c));
    }
  }

  // Splits one run where the insert, formatting or deletion marks change.
  run(r, st, out) {
    let rPr = null;
    const parts = [];
    for (const c of r.c || []) {
      if (typeof c === 'string') continue;
      const l = this.L(c);
      if (l === 'rPr') { rPr = c; continue; }
      const t = l ? M.runChildText(c, l, this.wp) : '';
      if (l === 't' && t.length > 1) {
        // Split the text into single-state pieces.
        let start = 0;
        for (let i = 1; i <= t.length; i++) {
          const pos = st.off + i;
          if (i === t.length || this.stateKey(st, pos) !== this.stateKey(st, pos - 1) || st.dels.some((d) => d.at === pos)) {
            parts.push({ xml: '<' + this.q('t') + ' xml:space="preserve">' + X.escapeText(X.cleanXmlText(t.slice(start, i))) + '</' + this.q('t') + '>', s: st.off + start, len: i - start });
            start = i;
          }
        }
      } else parts.push({ xml: X.serialize(c), s: st.off, len: t.length });
      st.off += t.length;
    }
    // Group pieces by state and write them, with pending deletions before the piece they precede.
    let group = null;
    const flush = () => {
      if (!group || !group.xml.length) { group = null; return; }
      const inner = '<' + r.n + r.a + '>' + this.rPr(rPr, group.fmt, st) + group.xml.join('') + '</' + r.n + '>';
      if (group.ins) {
        const tag = st.spec.all === 'moveTo' ? 'moveTo' : 'ins';
        out.push('<' + this.q(tag) + this.revAttrs() + '>' + inner + '</' + this.q(tag) + '>');
      } else out.push(inner);
      group = null;
    };
    for (const p of parts) {
      const pos = p.s;
      if (p.len > 0 && st.dels.length && st.dels[0].at <= pos) { flush(); this.flushDels(st, pos, out); }
      const ins = p.len > 0 ? st.insAt(pos) : group ? group.ins : st.insAt(pos);
      const fmt = p.len > 0 ? st.fmtAt(pos) : group ? group.fmt : st.fmtAt(pos);
      if (group && (group.ins !== ins || group.fmt !== fmt)) flush();
      if (!group) group = { ins, fmt, xml: [] };
      group.xml.push(p.xml);
    }
    flush();
  }

  stateKey(st, pos) { return (st.insAt(pos) ? 'i' : '-') + st.fmtAt(pos); }

  rPr(rPr, fmtIdx, st) {
    if (fmtIdx === -1 || fmtIdx === undefined) return rPr ? X.serialize(rPr) : '';
    const f = st.spec.fmt[fmtIdx];
    const change = '<' + this.q('rPrChange') + this.revAttrs() + '><' + this.q('rPr') + '>' + this.fmtXml(f.was) + '</' + this.q('rPr') + '></' + this.q('rPrChange') + '>';
    if (!rPr) return '<' + this.q('rPr') + '>' + change + '</' + this.q('rPr') + '>';
    return '<' + rPr.n + rPr.a + '>' + (rPr.c || []).map((k) => X.serialize(k)).join('') + change + '</' + rPr.n + '>';
  }

  // rPr children for a formatting record, in schema order.
  fmtXml(f) {
    if (!f) return '';
    const q = (l) => this.q(l);
    let x = '';
    if (f.cs && this.styleIds.has(f.cs)) x += '<' + q('rStyle') + ' ' + q('val') + '="' + X.escapeAttr(f.cs) + '"/>';
    if (f.b) x += '<' + q('b') + '/>';
    if (f.i) x += '<' + q('i') + '/>';
    if (f.s) x += '<' + q('strike') + '/>';
    if (f.sz) x += '<' + q('sz') + ' ' + q('val') + '="' + f.sz + '"/>';
    if (f.u) x += '<' + q('u') + ' ' + q('val') + '="single"/>';
    if (f.va) x += '<' + q('vertAlign') + ' ' + q('val') + '="' + (f.va === 'sup' ? 'superscript' : 'subscript') + '"/>';
    return x;
  }

  // ---------- content from the older document, written from its model ----------
  // kind: 'del' (w:delText inside w:del) or 'moveFrom' (w:t inside w:moveFrom).
  oldRuns(block, s, e, kind) {
    if (e <= s) return '';
    const q = (l) => this.q(l);
    const tTag = kind === 'del' ? 'delText' : 't';
    const runs = [];
    const segs = block.segs && block.segs.length ? block.segs : [{ s: 0, e: block.text.length, f: M.PLAIN }];
    for (const g of segs) {
      const a = Math.max(s, g.s);
      const b = Math.min(e, g.e);
      if (b <= a) continue;
      const text = block.text.slice(a, b);
      let body = '';
      for (const part of text.split(/(\t|\n|￼)/)) {
        if (!part || part === M.OBJ) continue;
        if (part === '\t') body += '<' + q('tab') + '/>';
        else if (part === '\n') body += '<' + q('br') + '/>';
        else body += '<' + q(tTag) + ' xml:space="preserve">' + X.escapeText(X.cleanXmlText(part)) + '</' + q(tTag) + '>';
      }
      if (!body) continue;
      const rp = this.fmtXml(g.f);
      runs.push('<' + q('r') + '>' + (rp ? '<' + q('rPr') + '>' + rp + '</' + q('rPr') + '>' : '') + body + '</' + q('r') + '>');
    }
    if (!runs.length) return '';
    return '<' + q(kind) + this.revAttrs() + '>' + runs.join('') + '</' + q(kind) + '>';
  }

  oldPStyle(block) {
    let id = block.style;
    if (!id && block.lvl) id = 'Heading' + block.lvl;
    return id && this.styleIds.has(id) ? '<' + this.q('pStyle') + ' ' + this.q('val') + '="' + X.escapeAttr(id) + '"/>' : '';
  }

  oldPara(block, kind, mv) {
    const q = (l) => this.q(l);
    const text = block.t === 'p' ? block : { text: block.text, segs: null };
    let x = '<' + q('p') + '><' + q('pPr') + '>' + (block.t === 'p' ? this.oldPStyle(block) : '') + '<' + q('rPr') + '>' + this.mark(kind) + '</' + q('rPr') + '></' + q('pPr') + '>';
    if (kind === 'moveFrom') {
      const id = this.id++;
      x += '<' + q('moveFromRangeStart') + ' ' + q('id') + '="' + id + '" ' + q('author') + '="' + X.escapeAttr(this.opts.author) + '" ' + q('date') + '="' + this.opts.date + '" ' + q('name') + '="move' + mv + '"/>';
      x += this.oldRuns(text, 0, text.text.length, 'moveFrom');
      x += '<' + q('moveFromRangeEnd') + ' ' + q('id') + '="' + id + '"/>';
    } else x += this.oldRuns(text, 0, text.text.length, 'del');
    return x + '</' + q('p') + '>';
  }

  old(block, kind) {
    if (block.t === 'tbl') return this.oldTable(block);
    return this.oldPara(block, kind);
  }

  oldTable(block) {
    const q = (l) => this.q(l);
    const cols = Math.max(1, ...block.rows.map((r) => r.cells.length));
    const w = Math.max(500, Math.floor(9000 / cols));
    let x = '<' + q('tbl') + '><' + q('tblPr') + '><' + q('tblW') + ' ' + q('w') + '="0" ' + q('type') + '="auto"/></' + q('tblPr') + '><' + q('tblGrid') + '>';
    for (let i = 0; i < cols; i++) x += '<' + q('gridCol') + ' ' + q('w') + '="' + w + '"/>';
    x += '</' + q('tblGrid') + '>';
    for (const r of block.rows) x += this.oldTableRow(r, w);
    return x + '</' + q('tbl') + '>';
  }

  oldTableRow(r, w) {
    const q = (l) => this.q(l);
    let x = '<' + q('tr') + '><' + q('trPr') + '>' + this.mark('del') + '</' + q('trPr') + '>';
    for (const c of r.cells.length ? r.cells : [{ blocks: [] }]) {
      x += '<' + q('tc') + '><' + q('tcPr') + '><' + q('tcW') + ' ' + q('w') + '="' + (w || 2000) + '" ' + q('type') + '="dxa"/></' + q('tcPr') + '>';
      const inner = c.blocks.map((b) => this.old(b, 'del')).join('');
      x += inner && /<\/w:p>$|<\/[\w.-]*:?p>$/.test(inner) ? inner : inner + '<' + q('p') + '><' + q('pPr') + '><' + q('rPr') + '>' + this.mark('del') + '</' + q('rPr') + '></' + q('pPr') + '></' + q('p') + '>';
      x += '</' + q('tc') + '>';
    }
    return x + '</' + q('tr') + '>';
  }

  // ---------- inserted blocks and changed tables of the newer document ----------
  inserted(b) {
    if (b.t === 'p') return this.para(b, { all: 'ins', ins: [], dels: [], fmt: [] });
    if (b.t === 'tbl') return this.tableWith(b, b.rows.map((row, i) => ({ k: 'ins', b: i })), null);
    return X.serialize(b.node);
  }

  insertedRow(row) {
    const tr = row.node;
    const out = ['<' + tr.n + tr.a + '>'];
    let hasTrPr = false;
    for (const c of X.kids(tr)) if (this.L(c) === 'trPr') hasTrPr = true;
    let cellIdx = 0;
    for (const c of tr.c || []) {
      if (typeof c === 'string') continue;
      const l = this.L(c);
      if (l === 'trPr') {
        out.push('<' + c.n + c.a + '>' + (c.c || []).map((k) => X.serialize(k)).join('') + this.mark('ins') + '</' + c.n + '>');
        continue;
      }
      if (l === 'tc' || l === 'sdt' || l === 'customXml') {
        if (!hasTrPr) { out.push('<' + this.q('trPr') + '>' + this.mark('ins') + '</' + this.q('trPr') + '>'); hasTrPr = true; }
        // Cells (also those inside a row-level content control, written without the wrapper).
        const cells = l === 'tc' ? [c] : this.cellsIn(c);
        for (const tc of cells) {
          const cell = row.cells[cellIdx++];
          if (!cell) { out.push(X.serialize(tc)); continue; }
          const rows = cell.blocks.map((blk, i) => ({ k: 'ins', b: i }));
          out.push('<' + tc.n + tc.a + '>' + this.container(cell.items, rows, [], cell.blocks, true) + '</' + tc.n + '>');
        }
        continue;
      }
      out.push(X.serialize(c));
    }
    out.push('</' + tr.n + '>');
    return out.join('');
  }

  cellsIn(el) {
    const res = [];
    const walk = (n) => {
      for (const c of X.kids(n)) {
        const l = this.L(c);
        if (l === 'tc') res.push(c);
        else if (l === 'sdt' || l === 'sdtContent' || l === 'customXml') walk(c);
      }
    };
    walk(el);
    return res;
  }

  table(a, b, r) { return this.tableWith(b, r.rows, a); }

  // b: new table block; rows: table rows from the engine; a: old table block (null for a whole inserted table).
  tableWith(b, rows, a) {
    const node = b.node;
    const out = ['<' + node.n + node.a + '>'];
    const isRow = (c) => { const l = this.L(c); return l === 'tr' || l === 'sdt' || l === 'customXml'; };
    const kids = X.kids(node);
    const firstRow = kids.findIndex(isRow);
    const before = firstRow === -1 ? kids : kids.slice(0, firstRow);
    const after = firstRow === -1 ? [] : kids.slice(firstRow).filter((c) => !isRow(c));
    for (const c of before) out.push(X.serialize(c));
    const gridW = 2000;
    for (const tr of rows) {
      if (tr.k === 'eq') out.push(X.serialize(b.rows[tr.b].node));
      else if (tr.k === 'ins') out.push(this.insertedRow(b.rows[tr.b]));
      else if (tr.k === 'del') out.push(this.oldTableRow(a.rows[tr.a], gridW));
      else out.push(this.changedRow(a.rows[tr.a], b.rows[tr.b], tr));
    }
    for (const c of after) out.push(X.serialize(c));
    out.push('</' + node.n + '>');
    return out.join('');
  }

  changedRow(ra, rb, tr) {
    const node = rb.node;
    const out = ['<' + node.n + node.a + '>'];
    let cellIdx = 0;
    for (const c of node.c || []) {
      if (typeof c === 'string') continue;
      const l = this.L(c);
      if (l === 'tc' || l === 'sdt' || l === 'customXml') {
        const cells = l === 'tc' ? [c] : this.cellsIn(c);
        for (const tc of cells) {
          const i = cellIdx++;
          const cc = tr.cells[i];
          const cb = rb.cells[i];
          if (!cc || !cc.changed || !cb) { out.push(X.serialize(tc)); continue; }
          const ca = cc.a === null ? null : ra.cells[cc.a];
          out.push('<' + tc.n + tc.a + '>' + this.container(cb.items, cc.rows, ca ? ca.blocks : [], cb.blocks, true) + '</' + tc.n + '>');
        }
        continue;
      }
      out.push(X.serialize(c));
    }
    out.push('</' + node.n + '>');
    return out.join('');
  }
}

function maxId(xml) {
  let max = 0;
  const re = /:id="(\d{1,9})"/g;
  let m;
  while ((m = re.exec(xml))) { const v = parseInt(m[1], 10); if (v > max) max = v; }
  return max;
}

// newModel must be a 'docx' model (model.fromDocx); oldModel any model. result from engine.compare.
// Returns the new word/document.xml string.
function documentXml(newModel, oldModel, result, opts, sourceXml) {
  const firstId = Math.max(900000, (sourceXml ? maxId(sourceXml) : 0) + 1000);
  const w = new Writer(newModel, oldModel, Object.assign({ firstId }, opts || {}));
  const inner = w.container(newModel.items, result.rows, oldModel.blocks, newModel.blocks, false);
  newModel.body.c = [inner];
  return { xml: XML_DECL + X.serialize(newModel.root), revisions: w.id - firstId };
}

// ---------- reject every revision (for the self-check and the tests) ----------
function rejectAll(root, wp) {
  const L = M.namer(wp);
  const visit = (el) => {
    if (!el.c) return;
    const out = [];
    for (const c of el.c) {
      if (typeof c === 'string') { out.push(c); continue; }
      const l = L(c);
      const parent = L(el);
      if (l === 'ins' || l === 'moveTo') { if (parent === 'rPr' || parent === 'trPr') continue; continue; }
      if (l === 'del' || l === 'moveFrom') {
        if (parent === 'rPr' || parent === 'trPr') continue;
        visit(c);
        for (const k of c.c || []) out.push(k);
        continue;
      }
      if (l === 'delText') { c.n = c.n.replace(/delText$/, 't'); }
      if (l === 'delInstrText') { c.n = c.n.replace(/delInstrText$/, 'instrText'); }
      if (l === 'tr' && rowHas(c, L, 'ins')) continue;
      if (l === 'p' && markHas(c, L, 'ins')) {
        visit(c);
        if (!textIn(c, L)) continue;
        out.push(c);
        continue;
      }
      if (l === 'rPrChange' || l === 'pPrChange' || l === 'moveFromRangeStart' || l === 'moveFromRangeEnd' || l === 'moveToRangeStart' || l === 'moveToRangeEnd') continue;
      visit(c);
      out.push(c);
    }
    el.c = out;
  };
  visit(root);
}

function rowHas(tr, L, kind) {
  for (const c of X.kids(tr)) if (L(c) === 'trPr') for (const k of X.kids(c)) if (L(k) === kind) return true;
  return false;
}

function markHas(p, L, kind) {
  for (const c of X.kids(p)) if (L(c) === 'pPr') for (const r of X.kids(c)) if (L(r) === 'rPr') for (const k of X.kids(r)) if (L(k) === kind || (kind === 'ins' && L(k) === 'moveTo')) return true;
  return false;
}

function textIn(p, L) {
  let found = false;
  const walk = (n) => {
    for (const c of n.c || []) {
      if (found || typeof c === 'string') continue;
      const l = L(c);
      if (l === 'pPr') continue;
      if (l === 't' || l === 'tab' || l === 'drawing') { found = true; return; }
      walk(c);
    }
  };
  walk(p);
  return found;
}

// Text of a document after accepting or rejecting all revisions, normalized for comparison.
function textAfter(xml, how) {
  const root = X.parse(xml);
  const top = X.kids(root)[0];
  const wp = M.prefixFor(top, M.W_URIS, 'w:');
  if (how === 'reject') rejectAll(root, wp); else M.acceptAll(root, wp);
  const model = M.fromDocx(X.serialize(root), '');
  return flatText(model.blocks);
}

function flatText(blocks) {
  const out = [];
  const walk = (list) => {
    for (const b of list) {
      if (b.t === 'tbl') for (const r of b.rows) for (const c of r.cells) walk(c.blocks);
      else out.push(b.text);
    }
  };
  walk(blocks);
  return squash(out.join('\n'));
}

function squash(s) { return s.replace(/￼/g, '').replace(/\s+/g, ''); }

module.exports = { documentXml, rejectAll, textAfter, flatText, squash, Writer };
