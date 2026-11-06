// Writes THIRD-PARTY-NOTICES.md for every npm package bundled into out/worker.js.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkgs = ['mammoth', '@xmldom/xmldom', 'base64-js', 'core-util-is', 'dingbat-to-unicode', 'immediate', 'inherits', 'isarray', 'jszip', 'lie', 'lop', 'option', 'pako', 'process-nextick-args', 'readable-stream', 'safe-buffer', 'setimmediate', 'string_decoder', 'underscore', 'util-deprecate', 'xmlbuilder'];
let out = '# Third-party notices\n\nDOCX Viewer bundles the following packages in `out/worker.js`.\n';
for (const name of pkgs) {
  const dir = path.join(root, 'node_modules', name);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  out += '\n## ' + name + ' ' + pj.version + '\n\nLicense: ' + (pj.license || 'see below') + '\n\n';
  out += lic ? '```\n' + fs.readFileSync(path.join(dir, lic), 'utf8').trim() + '\n```\n' : '(no license file in the package)\n';
}
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), out);
console.log('wrote THIRD-PARTY-NOTICES.md for', pkgs.length, 'packages');
