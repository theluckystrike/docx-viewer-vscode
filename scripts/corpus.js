// Converts every file in a folder through the worker, as the extension does, and prints one line per
// file: OK/ERR, time, size, words, images, equations, charts, notes, name, and the notice or banner.
// Use it on a folder of real-world files before a release: node scripts/corpus.js <folder>
const fs = require('fs');
const path = require('path');
const { convertInWorker } = require('../src/run-worker');

(async () => {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node scripts/corpus.js <folder>'); process.exit(2); }
  let ok = 0, total = 0;
  for (const n of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, n);
    if (!fs.statSync(p).isFile()) continue;
    const buf = fs.readFileSync(p);
    const t = Date.now();
    const r = await convertInWorker(buf, { ext: path.extname(n).toLowerCase() });
    total++;
    if (r.ok) ok++;
    const s = r.ok ? r.stats : null;
    console.log([r.ok ? 'OK ' : 'ERR', (Date.now() - t) + 'ms', buf.length, s ? s.words + 'w' : '', s ? 'img ' + s.images + '/' + s.skippedImages + ' eq ' + s.equations + ' charts ' + s.charts + ' notes ' + r.warnings.length : '', n, r.ok ? (r.banner || '') : r.notice.title].join('\t'));
  }
  console.error('files ' + total + ', opened ' + ok);
})();
