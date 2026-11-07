'use strict';
// Tracked changes and comments (read-only): Markup, Final and Original views, comments section,
// escaping, the no-cost path for plain files, robustness and speed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { convertDocx, STYLE_MAP } = require('../src/convert');
const { convertInWorker } = require('../src/run-worker');
const Rev = require('../src/revisions');
const H = require('../src/html');
const { makeDocx, p, sectPr } = require('./helpers/make-docx');

const text = (r) => r.chunks.join('').replace(/<\/p>/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const del = (id, who, date, inner) => `<w:del w:id="${id}" w:author="${who}" w:date="${date}T09:00:00Z">${inner}</w:del>`;
const ins = (id, who, date, inner) => `<w:ins w:id="${id}" w:author="${who}" w:date="${date}T09:00:00Z">${inner}</w:ins>`;
const delRun = (t) => `<w:r><w:delText xml:space="preserve">${t}</w:delText></w:r>`;
const COMMENTS_REL = [{ id: 'rIdC', type: 'comments', target: 'comments.xml' }];
const commentsXml = (items) => '<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + items.join('') + '</w:comments>';

function trackedDocx() {
  return makeDocx({ body: `<w:p>${run('The fee is ')}${del(1, 'Alice', '2026-10-01', delRun('100'))}${ins(2, 'Bob', '2026-10-02', run('120'))}${run(' EUR')}</w:p>` + sectPr(false) });
}

test('tracked.docx: Final is today\'s output, Original restores, Markup marks each author', async () => {
  const buf = await trackedDocx();
  const final = await convertDocx(buf, { ext: '.docx' });
  assert.strictEqual(text(final), 'The fee is 120 EUR');
  // Byte for byte the same chunks as the 0.2.x path (mammoth with the same options, then finish).
  const plain = await mammoth.convertToHtml({ buffer: buf }, { styleMap: STYLE_MAP, includeDefaultStyleMap: true, ignoreEmptyParagraphs: true });
  assert.deepStrictEqual(final.chunks, H.chunkBlocks(H.sanitize(H.parse(plain.value)).tree, 200000));
  assert.strictEqual(final.revisions.label, '2 changes by 2 people');
  assert.strictEqual(final.revisions.mode, 'final');
  const original = await convertDocx(buf, { ext: '.docx', revisionMode: 'original' });
  assert.strictEqual(text(original), 'The fee is 100 EUR');
  const markup = await convertDocx(buf, { ext: '.docx', revisionMode: 'markup' });
  const html = markup.chunks.join('');
  const d = html.match(/<del class="dv-del dv-a1 (dv-c\d+)">100<\/del>/);
  const i = html.match(/<ins class="dv-ins dv-a2 (dv-c\d+)">120<\/ins>/);
  assert.ok(d && i, html);
  assert.deepStrictEqual(markup.changeTable[d[1].slice(3)], { author: 'Alice', date: '2026-10-01', kind: 'del' });
  assert.deepStrictEqual(markup.changeTable[i[1].slice(3)], { author: 'Bob', date: '2026-10-02', kind: 'ins' });
  assert.deepStrictEqual(markup.revisions.authors, ['Alice', 'Bob']);
  assert.ok(!markup.warnings.some((w) => /Zovo/.test(w)), markup.warnings.join('\n'));
});

test('moved text: struck through at the old place, underlined at the new place; Final shows only the new place', async () => {
  const buf = await makeDocx({ body:
    `<w:p><w:moveFrom w:id="1" w:author="Ana" w:date="2026-10-05T09:00:00Z"><w:r><w:delText>Moved sentence.</w:delText></w:r></w:moveFrom>${run('Start.')}</w:p>` +
    `<w:p>${run('End. ')}<w:moveTo w:id="2" w:author="Ana" w:date="2026-10-05T09:00:00Z">${run('Moved sentence.')}</w:moveTo></w:p>` + sectPr(false) });
  const markup = await convertDocx(buf, { ext: '.docx', revisionMode: 'markup' });
  const html = markup.chunks.join('');
  assert.match(html, /<del class="dv-del dv-a1 dv-c0">Moved sentence\.<\/del>Start\./);
  assert.match(html, /End\. <ins class="dv-ins dv-a1 dv-c1">Moved sentence\.<\/ins>/);
  assert.strictEqual(markup.changeTable.c0.kind, 'moveFrom');
  const final = await convertDocx(buf, { ext: '.docx' });
  assert.strictEqual(text(final), 'Start. End. Moved sentence.');
});

async function commentsDocx(c2) {
  return makeDocx({
    body: `<w:p><w:commentRangeStart w:id="0"/>${run('Payment terms')}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>${run(' and ')}${run('delivery')}<w:r><w:commentReference w:id="1"/></w:r></w:p>` + sectPr(false),
    rels: COMMENTS_REL,
    extraParts: { 'word/comments.xml': commentsXml([
      '<w:comment w:id="0" w:author="Alice Smith" w:date="2026-10-01T09:00:00Z" w:initials="AS"><w:p><w:r><w:t>First paragraph of the note.</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph of the note.</w:t></w:r></w:p></w:comment>',
      `<w:comment w:id="1" w:author="王芳" w:date="2026-10-03T10:00:00Z" w:initials="WF"><w:p><w:r><w:t>${c2 || 'Please check the date.'}</w:t></w:r></w:p></w:comment>`
    ]) }
  });
}

test('comments: numbered markers, a Comments section with authors and every paragraph, links both ways, outline entry', async () => {
  const r = await convertDocx(await commentsDocx(), { ext: '.docx', revisionMode: 'markup' });
  const html = r.chunks.join('');
  assert.strictEqual((html.match(/<sup><a id="d-comment-ref-\d" href="#d-comment-\d">/g) || []).length, 2);
  assert.match(html, /href="#d-comment-0"/);
  assert.match(html, /href="#d-comment-1"/);
  assert.match(html, /<dt id="d-comment-0">Alice Smith · 2026-10-01 \[AS1\]<\/dt>/);
  assert.match(html, /<dt id="d-comment-1">王芳 · 2026-10-03 \[WF2\]<\/dt>/);
  assert.match(html, /First paragraph of the note\.[\s\S]*Second paragraph of the note\./);
  assert.match(html, /href="#d-comment-ref-0"/);
  assert.match(html, /href="#d-comment-ref-1"/);
  assert.deepStrictEqual(r.outline.map((o) => o.text), ['Comments (2)']);
  assert.strictEqual(r.revisions.label, '2 comments');
  const final = await convertDocx(await commentsDocx(), { ext: '.docx' });
  assert.ok(!/comment/.test(final.chunks.join('')), 'Final has no comment markers');
});

test('comment text is escaped; no element id outside the safe pattern', async () => {
  const r = await convertDocx(await commentsDocx('&lt;img src=x onerror=alert(1)&gt;'), { ext: '.docx', revisionMode: 'markup' });
  const html = r.chunks.join('');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!/<img/.test(html));
  assert.ok(!/onerror=/.test(html.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')));
  for (const [, id] of html.matchAll(/ id="([^"]*)"/g)) assert.match(id, /^(d-comment(-ref)?-\d+|h-\d+)$/);
  assert.strictEqual(H.sanitize(H.parse('<p class="dv-ins dv-a9 dv-c1 evil" id="x">t</p>')).tree.children[0].attrs.class, 'dv-ins dv-c1');
});

test('a plain file never runs the pre-pass', async () => {
  const calls = { rewrite: 0, summarize: 0 };
  const orig = { rewrite: Rev.rewrite, summarize: Rev.summarize };
  Rev.rewrite = (...a) => { calls.rewrite++; return orig.rewrite(...a); };
  Rev.summarize = (...a) => { calls.summarize++; return orig.summarize(...a); };
  try {
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.docx'));
    for (const mode of ['final', 'markup', 'original']) {
      const r = await convertDocx(sample, { ext: '.docx', revisionMode: mode });
      assert.ok(r.ok);
      assert.strictEqual(r.revisions, undefined);
    }
    assert.deepStrictEqual(calls, { rewrite: 0, summarize: 0 });
    await convertDocx(await trackedDocx(), { ext: '.docx', revisionMode: 'markup' });
    assert.deepStrictEqual(calls, { rewrite: 1, summarize: 1 });
  } finally { Object.assign(Rev, orig); }
});

test('Markdown and text stay on Final for a file with changes', async () => {
  const r = await convertDocx(await trackedDocx(), { ext: '.docx' });
  assert.strictEqual(r.markdown.trim(), 'The fee is 120 EUR');
  assert.strictEqual(r.text.trim(), 'The fee is 120 EUR');
});

test('a deletion around a hyperlink and a field converts, and the link text is struck through', async () => {
  const body = `<w:p>${run('See ')}${del(5, 'Carl', '2026-10-07', '<w:hyperlink r:id="rIdL"><w:r><w:delText>the old page</w:delText></w:r></w:hyperlink><w:fldSimple w:instr="DATE"><w:r><w:delText>2026</w:delText></w:r></w:fldSimple>')}${run(' today.')}</w:p>` + sectPr(false);
  const buf = await makeDocx({ body, rels: [{ id: 'rIdL', type: 'hyperlink', target: 'https://example.com/old', external: true }] });
  const r = await convertDocx(buf, { ext: '.docx', revisionMode: 'markup' });
  assert.ok(r.ok);
  const html = r.chunks.join('');
  assert.match(html, /<a href="https:\/\/example\.com\/old"><del class="dv-del dv-a1 dv-c0">the old page<\/del><\/a>|<del class="dv-del dv-a1 dv-c0"><a href="https:\/\/example\.com\/old">the old page<\/a><\/del>/);
  // mammoth leaves out simple field results (here a DATE field), with or without changes.
  const original = await convertDocx(buf, { ext: '.docx', revisionMode: 'original' });
  assert.ok(original.ok);
  assert.match(text(original), /^See the old page/);
});

test('1,000 changes by 12 authors convert in under 3 s and use at most 8 author classes', async () => {
  const parts = [];
  for (let i = 0; i < 500; i++) {
    const a = 'Author ' + (i % 12);
    const b = 'Author ' + ((i + 5) % 12);
    parts.push(`<w:p>${run('Clause ' + i + ' costs ')}${del(2 * i, a, '2026-10-01', delRun(String(i)))}${ins(2 * i + 1, b, '2026-10-02', run(String(i + 1)))}${run(' EUR.')}</w:p>`);
  }
  const buf = await makeDocx({ body: parts.join('') + sectPr(false) });
  const t0 = Date.now();
  const r = await convertInWorker(buf, { ext: '.docx', revisionMode: 'markup' }, { workerFile: path.join(__dirname, '..', 'src', 'worker.js') });
  const ms = Date.now() - t0;
  console.log('# 1,000 changes: ' + ms + ' ms');
  assert.ok(r.ok, JSON.stringify(r.notice));
  assert.ok(ms < 3000, ms + ' ms');
  assert.strictEqual(r.revisions.changes, 1000);
  assert.strictEqual(r.revisions.authors.length, 12);
  const html = r.chunks.join('');
  const classes = new Set(html.match(/dv-a\d+/g));
  assert.ok(classes.size <= 8, [...classes].join(','));
  assert.strictEqual((html.match(/<ins class/g) || []).length, 500);
  assert.strictEqual((html.match(/<del class/g) || []).length, 500);
});

test('label wording', () => {
  assert.strictEqual(Rev.label({ changes: 1, authors: ['A'], comments: 0 }), '1 change by 1 person');
  assert.strictEqual(Rev.label({ changes: 12, authors: ['A', 'B'], comments: 4 }), '12 changes by 2 people · 4 comments');
  assert.strictEqual(Rev.label({ changes: 0, authors: [], comments: 1 }), '1 comment');
});

module.exports = { trackedDocx };
