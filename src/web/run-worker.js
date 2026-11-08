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

// The browser has no per-worker memory cap (desktop stops its worker at 1,536 MB). A zip-bomb part, such as a
// word/document.xml that unpacks to hundreds of MB, can take the browser process that hosts the extensions past
// 4 GB and take it down before the time limit fires. So before the worker starts, read the ZIP central directory
// and refuse XML parts that unpack past the limits below. Real documents are far smaller (the 49 MB JNCC report
// has under 10 MB of XML). Sizes of 0xFFFFFFFF (ZIP64) count as too large.
const MAX_XML_PART = 128 * 1024 * 1024;
const MAX_XML_TOTAL = 384 * 1024 * 1024;
function zipXmlTooLarge(bytes) {
  const b = bytes; const n = b.length;
  if (n < 22 || b[0] !== 0x50 || b[1] !== 0x4b) return null;
  const u16 = (i) => b[i] | (b[i + 1] << 8);
  const u32 = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 5 && b[i + 3] === 6) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = u32(eocd + 16); const count = u16(eocd + 10); let total = 0;
  for (let k = 0; k < count && p + 46 <= n; k++) {
    if (u32(p) !== 0x02014b50) break;
    const size = u32(p + 24), nameLen = u16(p + 28), extraLen = u16(p + 30), commentLen = u16(p + 32);
    let name = ''; for (let j = 0; j < nameLen && p + 46 + j < n; j++) name += String.fromCharCode(b[p + 46 + j]);
    if (/\.(xml|rels)$/i.test(name)) {
      if (size === 0xffffffff || size > MAX_XML_PART) return { name, size };
      total += size;
      if (total > MAX_XML_TOTAL) return { name: 'the XML parts together', size: total };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function convertInWorker(bytes, opts, limits) {
  const big = zipXmlTooLarge(bytes);
  if (big) {
    const mb = big.size === 0xffffffff ? 'more than 4,096' : String(Math.round(big.size / 1048576));
    return Promise.resolve(errorResult('This document needs too much memory to show', `${big.name} unpacks to ${mb} MB. In the browser DOCX Viewer reads XML parts up to ${MAX_XML_PART / 1048576} MB, because a browser cannot cap the converter's memory. Open the file in desktop VS Code.`));
  }
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

module.exports = { convertInWorker, configure, lastMode: () => lastMode, zipXmlTooLarge };
