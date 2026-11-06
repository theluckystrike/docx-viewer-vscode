'use strict';
// Converts .docx/.dotx/.docm bytes to sanitized HTML chunks, outline, Markdown and text.
// Runs inside a worker thread (see worker.js) so a big file never blocks the extension host.

const mammoth = require('mammoth');
const H = require('./html');
const { detectFormat, noticeFor } = require('./detect');

const DEFAULTS = {
  maxImageBytes: 5 * 1024 * 1024,
  maxTotalImageBytes: 40 * 1024 * 1024,
  maxChunkChars: 200000
};

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/webp']);

// Mammoth ignores Word's Title, Subtitle, Quote and Caption styles by default.
const STYLE_MAP = [
  "p[style-name='Title'] => h1.dv-title:fresh",
  "p[style-name='Subtitle'] => p.dv-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Caption'] => p.dv-caption:fresh",
  "r[style-name='Strong'] => strong",
  "p[style-name='Code'] => pre:separator('\\n')",
  'u => u',
  'strike => s'
];

function makeImageConverter(opts, stats) {
  return mammoth.images.imgElement(async (image) => {
    const type = (image.contentType || '').toLowerCase();
    if (!IMAGE_TYPES.has(type)) {
      stats.skipped++;
      const fmt = (type.split('/')[1] || 'unknown').replace(/^x-/, '').toUpperCase();
      return { src: '', 'data-dv-skipped': fmt + ' images are not supported' };
    }
    const buf = await image.read();
    if (buf.length > opts.maxImageBytes) {
      stats.skipped++;
      return { src: '', 'data-dv-skipped': H.formatBytes(buf.length) + ' is over the ' + H.formatBytes(opts.maxImageBytes) + ' image limit' };
    }
    if (stats.totalBytes + buf.length > opts.maxTotalImageBytes) {
      stats.skipped++;
      return { src: '', 'data-dv-skipped': 'the document is over the ' + H.formatBytes(opts.maxTotalImageBytes) + ' total image limit' };
    }
    stats.totalBytes += buf.length;
    return { src: 'data:' + (type === 'image/jpg' ? 'image/jpeg' : type) + ';base64,' + Buffer.from(buf).toString('base64') };
  });
}

// buf: Buffer/Uint8Array of a .docx. Returns a plain, structured-clone-safe object.
async function convertDocx(buf, options) {
  const opts = Object.assign({}, DEFAULTS, options || {});
  const t0 = Date.now();
  const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const format = detectFormat(buffer);
  if (format !== 'zip') return { ok: false, notice: noticeFor(format, opts.ext || '') };
  const imgStats = { totalBytes: 0, skipped: 0 };
  let result;
  try {
    result = await mammoth.convertToHtml({ buffer }, {
      styleMap: STYLE_MAP,
      convertImage: makeImageConverter(opts, imgStats),
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: true
    });
  } catch (err) {
    const msg = String((err && err.message) || err);
    const corrupt = /end of central directory|corrupted zip|Can't find end|Could not find file in options|word\/document\.xml|is this a zip/i.test(msg);
    return {
      ok: false,
      notice: corrupt
        ? { kind: 'notDocx', title: 'This file is not a readable Word document', detail: 'The ZIP package has no Word document part or is damaged. Details: ' + msg.slice(0, 300) }
        : { kind: 'error', title: 'DOCX Viewer could not read this file', detail: msg.slice(0, 500) }
    };
  }
  const clean = H.sanitize(H.parse(result.value));
  const chunks = H.chunkBlocks(clean.tree, opts.maxChunkChars);
  const warnings = [];
  const seen = new Set();
  for (const m of result.messages || []) {
    const text = String(m.message || '').slice(0, 300);
    if (!seen.has(text) && warnings.length < 50) { seen.add(text); warnings.push(text); }
  }
  const text = H.toPlainText(clean.tree);
  return {
    ok: true,
    chunks,
    outline: clean.outline,
    warnings,
    markdown: H.toMarkdown(clean.tree),
    text,
    stats: {
      words: (text.match(/\S+/g) || []).length,
      headings: clean.outline.length,
      images: clean.images,
      skippedImages: clean.skippedImages,
      footnotes: clean.footnotes,
      tables: (result.value.match(/<table/g) || []).length,
      htmlChars: chunks.reduce((n, c) => n + c.length, 0),
      ms: Date.now() - t0
    }
  };
}

module.exports = { convertDocx, detectFormat, noticeFor, DEFAULTS, STYLE_MAP };
