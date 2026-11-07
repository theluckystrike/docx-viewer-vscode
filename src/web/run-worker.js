'use strict';
// VS Code for the Web version of src/run-worker.js (the web build swaps it in). Each conversion runs
// in its own Web Worker with a time limit, so a huge or hostile file cannot hang the extension host.
// The browser has no per-worker memory cap; a worker that runs out of memory fails and is reported.
// VS Code for the Web supports workers started from an extension (it polyfills them where the
// browser lacks nested workers), so there is no in-process copy of the converter here: that would
// add 460 KB to the download. If a worker still cannot start, the user gets a clear notice.

let workerUrl = null;
let blobUrl = null; // blob: URL of the fetched worker script
let inProcess = null; // optional converter for the no-worker case (tests inject one)
let lastMode = null; // 'worker' | 'inline', for tests and the web gate

function configure(opts) {
  if ((opts.workerUrl || null) !== workerUrl) blobUrl = null;
  workerUrl = opts.workerUrl || null;
  if ('inProcess' in opts) inProcess = opts.inProcess;
}

function errorResult(title, detail) {
  return { ok: false, notice: { kind: 'error', title, detail } };
}

const NO_WORKER = ['DOCX Viewer could not start its converter in this browser', 'The browser refused to start a worker for the converter. Reload the window, or open the file in desktop VS Code.'];

async function runInline(bytes, opts) {
  lastMode = 'inline';
  if (!inProcess) { lastMode = 'none'; return errorResult(NO_WORKER[0], NO_WORKER[1]); }
  try {
    return await inProcess(bytes, opts);
  } catch (err) {
    return errorResult('DOCX Viewer could not read this file', String((err && err.message) || err).slice(0, 500));
  }
}

// A cross-origin script cannot be a Worker URL, so the worker code is fetched once and started
// from a blob: URL.
async function workerScriptUrl(fetchImpl) {
  if (blobUrl) return blobUrl;
  const res = await (fetchImpl || fetch)(workerUrl);
  if (!res.ok) throw new Error('worker script ' + res.status);
  const code = await res.text();
  blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  return blobUrl;
}

function convertInWorker(bytes, opts, limits) {
  const timeoutMs = (limits && limits.timeoutMs) || 60000;
  const WorkerImpl = (limits && limits.Worker) || (typeof Worker !== 'undefined' ? Worker : null);
  if (!WorkerImpl || !workerUrl) return runInline(bytes, opts);
  return new Promise((resolve) => {
    let done = false;
    let worker = null;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (worker) try { worker.terminate(); } catch (_) {}
      resolve(value);
    };
    workerScriptUrl(limits && limits.fetch).then((url) => {
      worker = new WorkerImpl(url);
      lastMode = 'worker';
      timer = setTimeout(() => finish(errorResult('This document took too long to open', 'DOCX Viewer stopped after ' + Math.round(timeoutMs / 1000) + ' seconds. The file may be very large or damaged.')), timeoutMs);
      worker.onmessage = (e) => { const m = e.data || {}; finish(m.error ? errorResult('DOCX Viewer could not read this file', m.error) : m.result); };
      worker.onerror = (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const text = String((e && (e.message || e.error)) || 'worker error');
        const oom = /out of memory|allocation failed|RangeError: Array buffer allocation/i.test(text);
        finish(errorResult(oom ? 'This document needs too much memory to show' : 'DOCX Viewer could not read this file', text.slice(0, 500)));
      };
      const copy = Uint8Array.from(bytes);
      worker.postMessage({ bytes: copy, opts }, [copy.buffer]);
    }).catch(() => {
      // No worker here (or its script could not be read).
      if (done) return;
      done = true;
      runInline(bytes, opts).then(resolve);
    });
  });
}

module.exports = { convertInWorker, configure, lastMode: () => lastMode };
