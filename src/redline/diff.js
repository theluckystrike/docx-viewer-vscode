'use strict';
// Sequence diff for the redline. Myers O(ND) for small ranges, patience anchors (lines unique in both
// sides) to split big ranges, and a plain "replace" when nothing anchors. Every step has a budget, so two
// unrelated 500-page documents finish quickly instead of hanging.
// Ops: { t: '=', a: i, b: j, n } | { t: '-', a: i, n } | { t: '+', b: j, n }  (index ranges)

const MYERS_MAX_PRODUCT = 4e6; // n * m above this goes to patience anchors first
const MYERS_MAX_D = 1200;

function diff(a, b) {
  const out = [];
  range(a, b, 0, a.length, 0, b.length, out, 0);
  return merge(out);
}

function push(out, t, i, j, n) {
  if (n <= 0) return;
  out.push(t === '=' ? { t, a: i, b: j, n } : t === '-' ? { t, a: i, n } : { t, b: j, n });
}

function merge(ops) {
  const out = [];
  for (const o of ops) {
    const p = out[out.length - 1];
    if (p && p.t === o.t && (o.t === '+' || p.a + p.n === o.a) && (o.t === '-' || p.b + p.n === o.b)) p.n += o.n;
    else out.push(Object.assign({}, o));
  }
  // Group each change run as all deletions first, then all insertions.
  const res = [];
  let dels = [];
  let ins = [];
  const flush = () => { res.push(...dels, ...ins); dels = []; ins = []; };
  for (const o of out) {
    if (o.t === '=') { flush(); res.push(o); } else if (o.t === '-') dels.push(o); else ins.push(o);
  }
  flush();
  // Merge neighbours again after regrouping.
  const fin = [];
  for (const o of res) {
    const p = fin[fin.length - 1];
    if (p && p.t === o.t && o.t !== '=' && (o.t === '+' ? p.b + p.n === o.b : p.a + p.n === o.a)) p.n += o.n;
    else fin.push(o);
  }
  return fin;
}

function range(a, b, alo, ahi, blo, bhi, out, depth) {
  // Common prefix and suffix.
  let pre = 0;
  while (alo + pre < ahi && blo + pre < bhi && a[alo + pre] === b[blo + pre]) pre++;
  let suf = 0;
  while (ahi - suf > alo + pre && bhi - suf > blo + pre && a[ahi - suf - 1] === b[bhi - suf - 1]) suf++;
  push(out, '=', alo, blo, pre);
  const a0 = alo + pre;
  const a1 = ahi - suf;
  const b0 = blo + pre;
  const b1 = bhi - suf;
  middle(a, b, a0, a1, b0, b1, out, depth);
  push(out, '=', a1, b1, suf);
}

function middle(a, b, a0, a1, b0, b1, out, depth) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (!n && !m) return;
  if (!n) return push(out, '+', 0, b0, m);
  if (!m) return push(out, '-', a0, 0, n);
  if (n * m <= MYERS_MAX_PRODUCT) {
    const r = myers(a, b, a0, a1, b0, b1, Math.min(MYERS_MAX_D, n + m));
    if (r) { out.push(...r); return; }
  }
  if (depth < 60) {
    const anchors = patienceAnchors(a, b, a0, a1, b0, b1);
    if (anchors.length) {
      let i = a0;
      let j = b0;
      for (const [ai, bj] of anchors) {
        range(a, b, i, ai, j, bj, out, depth + 1);
        push(out, '=', ai, bj, 1);
        i = ai + 1;
        j = bj + 1;
      }
      range(a, b, i, a1, j, b1, out, depth + 1);
      return;
    }
  }
  push(out, '-', a0, 0, n);
  push(out, '+', 0, b0, m);
}

// Keys that appear exactly once on each side, longest increasing run of their positions.
function patienceAnchors(a, b, a0, a1, b0, b1) {
  const ca = new Map();
  for (let i = a0; i < a1; i++) { const k = a[i]; const v = ca.get(k); ca.set(k, v === undefined ? i : -1); }
  const cb = new Map();
  for (let j = b0; j < b1; j++) { const k = b[j]; if (!ca.has(k)) continue; const v = cb.get(k); cb.set(k, v === undefined ? j : -1); }
  const pairs = [];
  for (let i = a0; i < a1; i++) {
    const ai = ca.get(a[i]);
    if (ai !== i) continue;
    const bj = cb.get(a[i]);
    if (bj !== undefined && bj >= 0) pairs.push([i, bj]);
  }
  if (!pairs.length) return pairs;
  // Longest increasing subsequence on bj (pairs are sorted by ai).
  const tails = [];
  const prev = new Array(pairs.length);
  for (let k = 0; k < pairs.length; k++) {
    const v = pairs[k][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < v) lo = mid + 1; else hi = mid; }
    prev[k] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = k;
  }
  const res = [];
  for (let k = tails[tails.length - 1]; k >= 0; k = prev[k]) res.push(pairs[k]);
  return res.reverse();
}

// Myers with a D budget. Returns ops or null when the budget runs out.
function myers(a, b, a0, a1, b0, b1, maxD) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (Math.abs(n - m) > maxD) return null;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  for (let d = 0; d <= maxD; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, n, m, a0, b0);
    }
  }
  return null;
}

function backtrack(trace, dEnd, n, m, a0, b0) {
  const ops = [];
  let x = n;
  let y = m;
  for (let d = dEnd; d >= 0; d--) {
    const arr = trace[d]; // v before step d, window k = -d-1 .. d+1
    const get = (k) => arr[k + d + 1];
    const k = x - y;
    let pk = 0;
    let px = 0;
    let py = 0;
    let sx = 0;
    if (d > 0) {
      pk = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
      px = get(pk);
      py = px - pk;
      sx = pk === k + 1 ? px : px + 1;
    }
    while (x > sx) { ops.push({ t: '=', a: a0 + x - 1, b: b0 + y - 1, n: 1 }); x--; y--; }
    if (d > 0) {
      if (pk === k + 1) ops.push({ t: '+', b: b0 + y - 1, n: 1 }); else ops.push({ t: '-', a: a0 + x - 1, n: 1 });
      x = px;
      y = py;
    }
  }
  return ops.reverse();
}

// ---------- words ----------
const TOKEN = /\s+|[\p{L}\p{N}\p{M}_'’]+|[^\s\p{L}\p{N}\p{M}_]/gu;

function tokenize(text) {
  const toks = [];
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(text))) toks.push({ s: m.index, e: m.index + m[0].length, k: /^\s/.test(m[0]) ? ' ' : m[0] });
  return toks;
}

// Word diff of two strings. Returns char-range ops { t, as, ae, bs, be }.
// Whitespace-only equal runs between two changes join the change, so "a b" -> "c d" reads as one edit.
function words(aText, bText) {
  const ta = tokenize(aText);
  const tb = tokenize(bText);
  const ops = diff(ta.map((t) => t.k), tb.map((t) => t.k));
  const res = [];
  for (const o of ops) {
    if (o.t === '=') res.push({ t: '=', as: ta[o.a].s, ae: ta[o.a + o.n - 1].e, bs: tb[o.b].s, be: tb[o.b + o.n - 1].e, ws: o.n === 1 && ta[o.a].k === ' ' });
    else if (o.t === '-') res.push({ t: '-', as: ta[o.a].s, ae: ta[o.a + o.n - 1].e });
    else res.push({ t: '+', bs: tb[o.b].s, be: tb[o.b + o.n - 1].e });
  }
  // Absorb lone whitespace between changes.
  const out = [];
  for (let i = 0; i < res.length; i++) {
    const o = res[i];
    if (o.t === '=' && o.ws && out.length && out[out.length - 1].t !== '=' && res[i + 1] && res[i + 1].t !== '=') {
      addTo(out, { t: '-', as: o.as, ae: o.ae });
      addTo(out, { t: '+', bs: o.bs, be: o.be });
      continue;
    }
    addTo(out, o);
  }
  // Order each change group as deletion then insertion.
  const fin = [];
  let d = null;
  let p = null;
  const flush = () => { if (d) fin.push(d); if (p) fin.push(p); d = null; p = null; };
  for (const o of out) {
    if (o.t === '=') { flush(); fin.push(o); continue; }
    if (o.t === '-') { if (d) d.ae = o.ae; else d = Object.assign({}, o); } else if (p) p.be = o.be; else p = Object.assign({}, o);
  }
  flush();
  return fin;
}

function addTo(out, o) {
  const last = out[out.length - 1];
  if (last && last.t === o.t && o.t !== '=') {
    if (o.t === '-' && last.ae === o.as) { last.ae = o.ae; return; }
    if (o.t === '+' && last.be === o.bs) { last.be = o.be; return; }
  }
  // A '-' after a '+' (or the reverse) in one change group: keep both; words() regroups them.
  out.push(Object.assign({}, o));
}

// Similarity 0..1 of two texts by shared word counts (Dice).
function similarity(aText, bText) {
  if (aText === bText) return 1;
  const wa = aText.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const wb = bText.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!wa.length || !wb.length) return wa.length === wb.length ? 0.5 : 0;
  const m = new Map();
  for (const w of wa) m.set(w, (m.get(w) || 0) + 1);
  let common = 0;
  for (const w of wb) { const c = m.get(w); if (c) { common++; m.set(w, c - 1); } }
  return (2 * common) / (wa.length + wb.length);
}

module.exports = { diff, words, tokenize, similarity, patienceAnchors, myers };
