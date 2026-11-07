// License gate for the esbuild bundles. Every npm package that ends up in out/ must have a
// permissive license, and saxes (ISC) and yauzl must never be in it: we import only the OLE
// part of word-extractor, which needs neither.
const fs = require('fs');
const path = require('path');

const ALLOWED = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'Zlib']);
// ISC is fine as a license, but these two must stay out because word-extractor's entry point
// pulls them in and we do not need them.
const BANNED_PACKAGES = new Set(['saxes', 'yauzl', 'xmlchars']);

// "node_modules/@scope/name/lib/x.js" -> "@scope/name"
function packageOf(input) {
  const i = input.lastIndexOf('node_modules/');
  if (i === -1) return null;
  const rest = input.slice(i + 'node_modules/'.length).split('/');
  return rest[0].startsWith('@') ? rest[0] + '/' + rest[1] : rest[0];
}

// "(MIT OR GPL-3.0-or-later)" is allowed when one side is allowed; "(MIT AND Zlib)" when both are.
function licenseAllowed(lic) {
  if (!lic || typeof lic !== 'string') return false;
  return lic.replace(/[()]/g, ' ').split(/\s+OR\s+/i).some((alt) => alt.trim().split(/\s+AND\s+/i).every((part) => ALLOWED.has(part.trim())));
}

function checkMetafile(metafile, root) {
  const packages = {};
  const problems = [];
  for (const input of Object.keys(metafile.inputs)) {
    const name = packageOf(input);
    if (!name || packages[name]) continue;
    let lic = null;
    try {
      lic = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).license || null;
    } catch (_) { lic = null; }
    packages[name] = lic;
    if (BANNED_PACKAGES.has(name)) problems.push(name + ' must not be bundled (from ' + input + ')');
    else if (!licenseAllowed(lic)) problems.push(name + ' has license ' + JSON.stringify(lic) + ', which is not on the allowlist');
  }
  return { packages, problems };
}

module.exports = { checkMetafile, licenseAllowed, packageOf, ALLOWED, BANNED_PACKAGES };
