'use strict';
// The 500-page pair for the speed gate: about 3,800 paragraphs, 250 headings and 200 tables, with scattered
// edits in the second version (changed words, deleted and added paragraphs, 3 moves, table cells, bold runs).
const F = require('./redline-fixtures');

// Deterministic pseudo-random words.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const VOCAB = ('agreement party supplier client service delivery schedule payment invoice notice period term clause section liability ' +
  'warranty data record report review approval change request scope budget risk issue owner date month year quarter plan policy standard ' +
  'member staff process system access security control audit evidence finding action response time cost value quality support training').split(' ');

function sentence(r, n) {
  const w = [];
  for (let i = 0; i < n; i++) w.push(VOCAB[Math.floor(r() * VOCAB.length)]);
  w[0] = w[0][0].toUpperCase() + w[0].slice(1);
  return w.join(' ') + '.';
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const run = (t, rPr) => '<w:r>' + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
const para = (runs, style) => '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + runs + '</w:p>';
const tbl = (rows) => '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>' + rows[0].map(() => '<w:gridCol w:w="2200"/>').join('') + '</w:tblGrid>' +
  rows.map((r) => '<w:tr>' + r.map((c) => '<w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr>' + para(run(c)) + '</w:tc>').join('') + '</w:tr>').join('') + '</w:tbl>';

// 500 pages: about 3,800 paragraphs of 60 words, 250 headings and 200 tables of 6 x 4.
function largePair() {
  const r = rng(42);
  const blocks = [];
  let t = 0;
  for (let i = 0; i < 3800; i++) {
    if (i % 15 === 0) blocks.push({ k: 'h', text: 'Section ' + (i / 15 + 1) + ' ' + sentence(r, 3).replace(/\.$/, '') });
    blocks.push({ k: 'p', text: 'Paragraph ' + (i + 1) + '. ' + sentence(r, 14) + ' ' + sentence(r, 16) + ' ' + sentence(r, 15) + ' ' + sentence(r, 14) });
    if (i % 19 === 0 && t < 200) {
      t++;
      blocks.push({ k: 't', rows: [['Table ' + t, 'Owner', 'Due', 'Cost']].concat(Array.from({ length: 5 }, (_, j) => ['Item ' + t + '.' + (j + 1), VOCAB[Math.floor(r() * VOCAB.length)], '2026-' + String(1 + (j % 12)).padStart(2, '0') + '-15', (100 + Math.floor(r() * 900)) + ' USD'])) });
    }
  }
  // Edits for v2.
  const v2 = blocks.map((b) => JSON.parse(JSON.stringify(b)));
  let pi = 0;
  const moved = [];
  const outB = [];
  for (const b of v2) {
    if (b.k === 'p') {
      pi++;
      if (pi % 300 === 0) continue; // deleted
      if (pi % 50 === 0) b.text = b.text.replace(/ (\w+) (\w+) /, ' revised $2 wording ');
      if (pi % 100 === 0) b.bold = true;
      if (pi === 701 || pi === 2701 || pi === 3101) { moved.push(b); continue; }
      outB.push(b);
      if (pi % 400 === 0) outB.push({ k: 'p', text: 'New paragraph added after paragraph ' + pi + ' in the second version.' });
      continue;
    }
    if (b.k === 't') {
      const n = parseInt(b.rows[0][0].split(' ')[1], 10);
      if (n % 10 === 0) b.rows[2][3] = 'changed ' + b.rows[2][3];
      if (n % 25 === 0) b.rows.push(['Item ' + n + '.6', 'added', '2026-12-15', '1 USD']);
    }
    outB.push(b);
  }
  outB.splice(Math.floor(outB.length / 2), 0, ...moved);
  const xml = (list) => list.map((b) => {
    if (b.k === 'h') return para(run(b.text), 'Heading1');
    if (b.k === 't') return tbl(b.rows);
    if (b.bold) { const i = b.text.indexOf(' ', 30); return para(run(b.text.slice(0, i)) + run(b.text.slice(i), '<w:b/>')); }
    return para(run(b.text));
  }).join('') + F.SECT;
  return [xml(blocks), xml(outB)];
}

module.exports = { largePair, sentence, rng };
