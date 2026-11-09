'use strict';
// One redline job, run inside the converter worker thread (src/worker.js), so a 500-page pair or a
// hostile file never blocks the extension host. Tasks:
//   'view'  -> { ok, payload }       payload for the redline webview
//   'docx'  -> { ok, bytes, check }  tracked-changes .docx built on the newer document
//   'html'  -> { ok, html }          self-contained HTML redline
// msg: { task, a: { bytes, name, label }, b: { bytes, name, label }, opts: { formatting, author, date } }
// a is the older document, b the newer one.

const JSZip = require('jszip');
const path = require('path');
const M = require('./model');
const E = require('./engine');
const R = require('./render');
const XD = require('./export-docx');
const XH = require('./export-html');
const H = require('../html');
const { detectFormat, noticeFor } = require('../detect');
const { convertDocx } = require('../convert');

const MAX_PART_BYTES = 200 * 1024 * 1024; // word/document.xml unpacked; real 1,000-page files are far below

function fail(title, detail) { return { ok: false, notice: { kind: 'error', title, detail: detail || '' } }; }

async function mainPartName(zip) {
  const rels = zip.file('_rels/.rels');
  if (rels) {
    try {
      const xml = await rels.async('string');
      const m = /<Relationship\b[^>]*Type="[^"]*\/officeDocument"[^>]*>/.exec(xml);
      const t = m && /Target="([^"]+)"/.exec(m[0]);
      if (t) return t[1].replace(/^\//, '');
    } catch (_) { /* default below */ }
  }
  return 'word/document.xml';
}

// Returns { model, zip, xml } or { notice }.
async function load(doc, which) {
  const buffer = Buffer.from(doc.bytes.buffer ? doc.bytes : new Uint8Array(doc.bytes));
  const ext = path.extname(doc.name || '').toLowerCase();
  const format = detectFormat(buffer);
  if (format === 'zip') {
    let zip = null;
    try { zip = await JSZip.loadAsync(buffer); } catch (err) {
      return { notice: { kind: 'notDocx', title: doc.name + ' is not a readable document', detail: 'The ZIP package is damaged. ' + String((err && err.message) || err).slice(0, 200) } };
    }
    const partName = await mainPartName(zip);
    const part = zip.file(partName) || zip.file('word/document.xml');
    if (part) {
      // JSZip reads the 32-bit size field as a signed number: a part that claims 2 GB or more comes back negative.
      const sizeOf = (f) => (f && f._data && typeof f._data.uncompressedSize === 'number' ? f._data.uncompressedSize >>> 0 : 0);
      const size = sizeOf(part);
      if (size > MAX_PART_BYTES) return { notice: { kind: 'tooLarge', title: doc.name + ' unpacks to ' + Math.round(size / 1048576) + ' MB of text', detail: 'The compare stops above ' + MAX_PART_BYTES / 1048576 + ' MB, so a damaged or hostile file (a zip bomb) cannot take all memory.' } };
      let xml;
      let stylesXml = '';
      try {
        xml = await part.async('string');
        const sp = zip.file(partName.replace(/[^/]+$/, 'styles.xml')) || zip.file('word/styles.xml');
        if (sp && sizeOf(sp) < 50 * 1048576) stylesXml = await sp.async('string');
      } catch (err) {
        return { notice: { kind: 'notDocx', title: doc.name + ' is damaged', detail: 'The Word part could not be unpacked: ' + String((err && err.message) || err).slice(0, 200) } };
      }
      try {
        return { model: M.fromDocx(xml, stylesXml), zip, xml, partName };
      } catch (err) {
        return { notice: { kind: 'error', title: doc.name + ' could not be read', detail: String((err && err.message) || err).slice(0, 300) } };
      }
    }
  }
  // OpenDocument text, Word 97-2003 and RTF-as-.doc: the viewer's own converter, read back as blocks.
  const r = await convertDocx(buffer, { ext }); // pictures become one OBJ character each
  if (!r.ok) return { notice: r.notice || noticeFor(format, ext, buffer) };
  return { model: M.fromHtmlChunks(r.chunks, H.parse), banner: r.banner || '' };
}

async function run(msg, progress) {
  const t0 = Date.now();
  const opts = Object.assign({ formatting: true }, msg.opts || {});
  const say = (stage, pct) => { if (progress) progress({ stage, pct }); };
  say('Reading ' + msg.a.name, 5);
  const A = await load(msg.a, 'a');
  if (A.notice) return { ok: false, notice: A.notice, which: 'a' };
  say('Reading ' + msg.b.name, 30);
  const B = await load(msg.b, 'b');
  if (B.notice) return { ok: false, notice: B.notice, which: 'b' };
  say('Comparing', 55);
  if (A.model.kind !== B.model.kind) opts.cross = true;
  const result = E.compare(A.model.blocks, B.model.blocks, opts);
  const tCompare = Date.now() - t0;
  if (msg.task === 'docx') {
    if (B.model.kind !== 'docx') return fail('Export as DOCX needs a Word file as the newer document', msg.b.name + ' is not a .docx or .docm file. Export as HTML works for every format.');
    say('Writing tracked changes', 75);
    const expectNew = XD.flatText(B.model.blocks);
    const expectOld = XD.flatText(A.model.blocks);
    const out = XD.documentXml(B.model, A.model, result, opts, B.xml);
    B.zip.file(B.partName, out.xml);
    say('Checking the result', 88);
    const check = { accept: null, reject: null };
    try {
      check.accept = XD.squash(XD.textAfter(out.xml, 'accept')) === expectNew;
      check.reject = XD.squash(XD.textAfter(out.xml, 'reject')) === expectOld;
    } catch (err) {
      check.error = String((err && err.message) || err).slice(0, 200);
    }
    const bytes = await B.zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { ok: true, bytes, check, revisions: out.revisions, counts: E.summarize(result.rows), ms: Date.now() - t0 };
  }
  say('Rendering', 80);
  const payload = R.renderAll(A.model.blocks, B.model.blocks, result, opts);
  payload.summary = E.summaryText(payload.counts, opts.formatting);
  payload.ms = Date.now() - t0;
  payload.compareMs = tCompare;
  payload.blocks = { a: A.model.blocks.length, b: B.model.blocks.length };
  payload.banners = [A.banner, B.banner].filter(Boolean);
  payload.exportDocx = B.model.kind === 'docx';
  if (msg.task === 'html') return { ok: true, html: XH.build(payload, msg.a, msg.b, opts), total: payload.total, summary: payload.summary, counts: payload.counts };
  return { ok: true, payload };
}

module.exports = { run, load, MAX_PART_BYTES };
