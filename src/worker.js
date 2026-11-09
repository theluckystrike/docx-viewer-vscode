'use strict';
// Worker thread entry. Receives { bytes, opts } once, replies { result } or { error }, then exits.
// { task: 'redline', ... } runs one redline job (src/redline/job.js) and may send { progress } first.
const { parentPort } = require('worker_threads');
const { convertDocx } = require('./convert');

parentPort.once('message', async (msg) => {
  try {
    if (msg && msg.task === 'redline') {
      const job = require('./redline/job');
      const result = await job.run(msg.job, (p) => parentPort.postMessage({ progress: p }));
      const transfer = result && result.bytes ? [result.bytes.buffer] : [];
      parentPort.postMessage({ result }, transfer);
      return;
    }
    const result = await convertDocx(Buffer.from(msg.bytes), msg.opts || {});
    // Move the image bytes instead of copying them.
    const transfer = Array.isArray(result.images) ? result.images.map((im) => im.data.buffer) : [];
    parentPort.postMessage({ result }, transfer);
  } catch (err) {
    parentPort.postMessage({ error: String((err && err.message) || err).slice(0, 500) });
  }
});
