'use strict';
// The few POSIX 'path' functions the extension uses, for the VS Code for the Web build (esbuild
// alias). Uri paths always use '/', so the POSIX rules are the right ones there.
function basename(p, ext) {
  const s = String(p).replace(/\/+$/, '');
  let b = s.slice(s.lastIndexOf('/') + 1);
  if (ext && b.endsWith(ext) && b !== ext) b = b.slice(0, -ext.length);
  return b;
}
function dirname(p) {
  if (/^\/+$/.test(String(p))) return '/';
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  if (i === -1) return '.';
  return i === 0 ? '/' : s.slice(0, i);
}
function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}
function join(...parts) {
  const out = [];
  const abs = String(parts[0] || '').startsWith('/');
  for (const seg of parts.join('/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return (abs ? '/' : '') + out.join('/') || '.';
}
module.exports = { basename, dirname, extname, join, sep: '/', posix: null };
module.exports.posix = module.exports;
