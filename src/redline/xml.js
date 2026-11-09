'use strict';
// A small, fast XML reader for WordprocessingML. It keeps attributes as the raw source text and text
// nodes as raw (still escaped) strings, so a part can be written back without changing anything the
// compare did not touch. Iterative (no recursion while reading), so tables nested thousands deep do not
// overflow the stack. Elements: { n: 'w:p', a: ' w:rsidR="00A1"', c: [children] | null }. Text: a string.

const TAG = /<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;

class XmlError extends Error {}

function parse(xml) {
  const root = { n: '#root', a: '', c: [] };
  const stack = [root];
  let pos = 0;
  const len = xml.length;
  while (pos < len) {
    const lt = xml.indexOf('<', pos);
    const top = stack[stack.length - 1];
    if (lt === -1) { const rest = xml.slice(pos); if (rest.trim()) top.c.push(rest); break; }
    if (lt > pos) {
      const t = xml.slice(pos, lt);
      if (stack.length > 1) top.c.push(t);
    }
    if (xml.startsWith('<!--', lt)) { const e = xml.indexOf('-->', lt + 4); pos = e === -1 ? len : e + 3; continue; }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); pos = e === -1 ? len : e + 2; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      const raw = xml.slice(lt + 9, e === -1 ? len : e);
      top.c.push(escapeText(raw));
      pos = e === -1 ? len : e + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      // DOCTYPE, with an optional internal subset. Word never writes one; it is skipped.
      let e = xml.indexOf('>', lt);
      const br = xml.indexOf('[', lt);
      if (br !== -1 && br < e) { const close = xml.indexOf(']>', br); e = close === -1 ? e : close + 1; }
      pos = e === -1 ? len : e + 1;
      continue;
    }
    TAG.lastIndex = lt;
    const m = TAG.exec(xml);
    if (!m) throw new XmlError('Malformed XML near offset ' + lt);
    pos = TAG.lastIndex;
    if (m[1]) {
      // Close tag: pop to the matching element (tolerates small nesting errors).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].n === m[2]) { stack.length = i; break; }
      }
      continue;
    }
    const el = { n: m[2], a: m[3] || '', c: m[4] ? null : [] };
    top.c.push(el);
    if (!m[4]) stack.push(el);
  }
  return root;
}

const ATTR_CACHE = new Map();
function attr(el, name) {
  if (!el || !el.a) return null;
  let re = ATTR_CACHE.get(name);
  if (!re) {
    re = new RegExp('(?:^|\\s)' + name.replace(/[.:-]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
    ATTR_CACHE.set(name, re);
  }
  const m = re.exec(el.a);
  if (!m) return null;
  return decode(m[1] !== undefined ? m[1] : m[2]);
}

function decode(s) {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(code);
  });
}

function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

// Characters XML 1.0 does not allow. Removed from text that the compare writes.
function cleanXmlText(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '');
}

function serialize(node) {
  const out = [];
  const walk = (n) => {
    if (typeof n === 'string') { out.push(n); return; }
    if (n.n === '#root') { for (const c of n.c) walk(c); return; }
    if (n.c === null) { out.push('<', n.n, n.a, '/>'); return; }
    out.push('<', n.n, n.a, '>');
    for (const c of n.c) walk(c);
    out.push('</', n.n, '>');
  };
  walk(node);
  return out.join('');
}

function kids(el) {
  return el && el.c ? el.c.filter((c) => typeof c !== 'string') : [];
}

module.exports = { parse, serialize, attr, decode, escapeText, escapeAttr, cleanXmlText, kids, XmlError };
