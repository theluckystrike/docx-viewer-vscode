'use strict';
// Runs one redline job in a worker thread with a memory cap, a time limit, progress and Cancel.
// The worker file is the converter worker (out/worker.js in the package, src/worker.js in tests).
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

function defaultWorkerFile() {
  const bundled = path.join(__dirname, 'worker.js');
  return fs.existsSync(bundled) ? bundled : path.join(__dirname, '..', 'worker.js');
}

// job: { task, a: { bytes, name, label }, b: {...}, opts }. o: { onProgress, token (vscode.CancellationToken), timeoutMs, maxHeapMb, workerFile }
// Resolves { ok, ... } from the job, { ok: false, cancelled: true } or { ok: false, notice }.
function runRedline(job, o) {
  o = o || {};
  const timeoutMs = o.timeoutMs || 180000;
  const maxHeapMb = o.maxHeapMb || 2048;
  return new Promise((resolve) => {
    let done = false;
    const worker = new Worker(o.workerFile || defaultWorkerFile(), { resourceLimits: { maxOldGenerationSizeMb: maxHeapMb, stackSizeMb: 64 } });
    let sub = null;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (sub) sub.dispose();
      worker.terminate().catch(() => {});
      resolve(v);
    };
    const timer = setTimeout(() => finish({ ok: false, notice: { kind: 'error', title: 'The compare took too long', detail: 'DOCX Viewer stopped it after ' + Math.round(timeoutMs / 1000) + ' seconds.' } }), timeoutMs);
    if (o.token) {
      if (o.token.isCancellationRequested) return finish({ ok: false, cancelled: true });
      sub = o.token.onCancellationRequested(() => finish({ ok: false, cancelled: true }));
    }
    worker.on('message', (m) => {
      if (m && m.progress) { if (o.onProgress) o.onProgress(m.progress); return; }
      if (m && m.error) return finish({ ok: false, notice: { kind: 'error', title: 'DOCX Viewer could not compare these files', detail: m.error } });
      finish(m.result);
    });
    worker.once('error', (err) => {
      const oom = /ERR_WORKER_OUT_OF_MEMORY|out of memory/i.test(String(err && (err.code || err.message)));
      finish({ ok: false, notice: { kind: 'error', title: oom ? 'These documents need too much memory to compare' : 'DOCX Viewer could not compare these files', detail: oom ? 'The compare stopped at ' + maxHeapMb + ' MB of memory.' : String((err && err.message) || err).slice(0, 400) } });
    });
    worker.once('exit', (code) => finish({ ok: false, notice: { kind: 'error', title: 'DOCX Viewer could not compare these files', detail: 'The compare worker exited with code ' + code + '.' } }));
    const copy = (d) => { const u = Uint8Array.from(d.bytes); return Object.assign({}, d, { bytes: u }); };
    const a = copy(job.a);
    const b = copy(job.b);
    worker.postMessage({ task: 'redline', job: Object.assign({}, job, { a, b }) }, [a.bytes.buffer, b.bytes.buffer]);
  });
}

module.exports = { runRedline, defaultWorkerFile };
