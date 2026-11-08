// Writes THIRD-PARTY-NOTICES.md for every npm package bundled into out/worker.js, out/web/*.js, media/page-view.js and media/pictures.js.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkgs = ['mammoth', '@xmldom/xmldom', 'base64-js', 'buffer', 'core-util-is', 'dingbat-to-unicode', 'docx-preview', 'ieee754', 'immediate', 'inherits', 'isarray', 'jszip', 'lie', 'lop', 'option', 'pako', 'process-nextick-args', 'readable-stream', 'rtf.js', 'safe-buffer', 'setimmediate', 'string_decoder', 'underscore', 'utif', 'util-deprecate', 'word-extractor', 'xmlbuilder'];
let out = '# Third-party notices\n\nDOCX Viewer bundles the following packages in `out/worker.js`, in `out/web/` (the VS Code for the Web build; `buffer` and `ieee754` are used only there) and, for Page view, `media/page-view.js`. WMFJS (from rtf.js), UTIF.js and pako also go into `media/pictures.js`, which both views load to draw EMF, WMF and TIFF pictures. Only the WMFJS part of rtf.js is bundled.\n';
for (const name of pkgs) {
  const dir = path.join(root, 'node_modules', name);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
  out += '\n## ' + name + ' ' + pj.version + '\n\nLicense: ' + (pj.license || 'see below') + '\n\n';
  out += lic ? '```\n' + fs.readFileSync(path.join(dir, lic), 'utf8').trim() + '\n```\n' : '(no license file in the package)\n';
}
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), out);
console.log('wrote THIRD-PARTY-NOTICES.md for', pkgs.length, 'packages');
