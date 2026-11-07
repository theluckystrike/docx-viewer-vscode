'use strict';
// Converter worker for VS Code for the Web: a Web Worker started by src/web/run-worker.js.
// Receives { bytes, opts } once and replies { result } or { error }, like src/worker.js does
// with worker_threads on the desktop.
const { convertDocx } = require('../convert');

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    const result = await convertDocx(Buffer.from(msg.bytes), msg.opts || {});
    const transfer = Array.isArray(result.images) ? [...new Set(result.images.map((im) => im.data.buffer))] : [];
    self.postMessage({ result }, transfer);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err).slice(0, 500) });
  }
};
