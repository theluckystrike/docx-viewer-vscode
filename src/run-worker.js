'use strict';
// Runs one conversion in a worker thread with a memory cap and a time limit,
// so a huge or hostile file (zip bomb) cannot freeze or crash the extension host.
const path = require('path');
const { Worker } = require('worker_threads');

function convertInWorker(bytes, opts, limits) {
  const timeoutMs = (limits && limits.timeoutMs) || 60000;
  const maxOldGenerationSizeMb = (limits && limits.maxHeapMb) || 1536;
  const workerFile = (limits && limits.workerFile) || path.join(__dirname, 'worker.js');
  return new Promise((resolve) => {
    let done = false;
    const worker = new Worker(workerFile, { resourceLimits: { maxOldGenerationSizeMb } });
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(value);
    };
    const timer = setTimeout(() => finish({ ok: false, notice: { kind: 'error', title: 'This document took too long to open', detail: 'DOCX Viewer stopped after ' + Math.round(timeoutMs / 1000) + ' seconds. The file may be very large or damaged.' } }), timeoutMs);
    worker.once('message', (m) => finish(m.error ? { ok: false, notice: { kind: 'error', title: 'DOCX Viewer could not read this file', detail: m.error } } : m.result));
    worker.once('error', (err) => {
      const oom = /ERR_WORKER_OUT_OF_MEMORY|out of memory/i.test(String(err && (err.code || err.message)));
      finish({ ok: false, notice: { kind: 'error', title: oom ? 'This document needs too much memory to show' : 'DOCX Viewer could not read this file', detail: oom ? 'The converter stopped at ' + maxOldGenerationSizeMb + ' MB of memory. The file may contain a very large or compressed part.' : String((err && err.message) || err).slice(0, 500) } });
    });
    worker.once('exit', (code) => finish({ ok: false, notice: { kind: 'error', title: 'DOCX Viewer could not read this file', detail: 'The converter exited with code ' + code + '.' } }));
    const copy = Uint8Array.from(bytes);
    worker.postMessage({ bytes: copy, opts }, [copy.buffer]);
  });
}

module.exports = { convertInWorker };
