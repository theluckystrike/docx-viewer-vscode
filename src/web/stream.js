'use strict';
// Just enough of Node's stream.Readable for word-extractor's OLE StorageStream in the web build:
// _read() may return a promise, push(chunk) emits 'data', push(null) emits 'end'. Reading starts
// when the first 'data' listener is added, in the next microtask, after 'error' and 'end' are set.
class Readable {
  constructor() { this._ev = {}; this._ended = false; this._started = false; }
  on(name, fn) {
    (this._ev[name] = this._ev[name] || []).push(fn);
    if (name === 'data' && !this._started) { this._started = true; Promise.resolve().then(() => this._pump()); }
    return this;
  }
  once(name, fn) { const w = (a) => { this._ev[name] = this._ev[name].filter((f) => f !== w); fn(a); }; return this.on(name, w); }
  emit(name, arg) { for (const f of (this._ev[name] || []).slice()) f(arg); return true; }
  push(chunk) {
    if (chunk === null) { if (!this._ended) { this._ended = true; this.emit('end'); } return false; }
    this.emit('data', chunk);
    return true;
  }
  async _pump() {
    try {
      // A _read() that neither pushes nor ends would spin; stop after a long run of empty reads.
      let idle = 0;
      while (!this._ended) {
        let pushed = false;
        const push = this.push;
        this.push = (c) => { pushed = true; return push.call(this, c); };
        await this._read();
        this.push = push;
        idle = pushed ? 0 : idle + 1;
        if (idle > 1000) throw new Error('stream stalled');
      }
    } catch (err) {
      this._ended = true;
      this.emit('error', err);
    }
  }
}
module.exports = { Readable };
