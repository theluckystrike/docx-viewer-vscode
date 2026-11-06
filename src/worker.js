'use strict';
// Worker thread entry. Receives { bytes, opts } once, replies { result } or { error }, then exits.
const { parentPort } = require('worker_threads');
const { convertDocx } = require('./convert');

parentPort.once('message', async (msg) => {
  try {
    const result = await convertDocx(Buffer.from(msg.bytes), msg.opts || {});
    parentPort.postMessage({ result });
  } catch (err) {
    parentPort.postMessage({ error: String((err && err.message) || err).slice(0, 500) });
  }
});
