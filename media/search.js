// Search core shared by the webview (window.DocxSearch) and the unit tests (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocxSearch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  // Returns [[start, end], ...] in UTF-16 offsets of text, at most max matches.
  function findMatches(text, query, options) {
    const opts = options || {};
    const max = opts.max || 10000;
    if (!query || !text) return [];
    let re;
    try {
      re = new RegExp(escapeRegExp(query), opts.caseSensitive ? 'gu' : 'giu');
    } catch (e) {
      re = new RegExp(escapeRegExp(query), opts.caseSensitive ? 'g' : 'gi');
    }
    const out = [];
    let m;
    while ((m = re.exec(text)) && out.length < max) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }
  function countLabel(current, total, capped) {
    if (!total) return 'No results';
    return (current + 1) + ' of ' + total + (capped ? '+' : '');
  }
  // Wraps every match under root in <mark class="dv-hit">. Returns the marks in document order.
  function highlight(root, query, max) {
    const doc = root.ownerDocument;
    const marks = [];
    if (!query) return marks;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (let i = 0; i < nodes.length && marks.length < max; i++) {
      const node = nodes[i];
      const found = findMatches(node.nodeValue, query, { max: max - marks.length });
      if (!found.length) continue;
      const frag = doc.createDocumentFragment();
      const text = node.nodeValue;
      let pos = 0;
      found.forEach(function (r) {
        if (r[0] > pos) frag.appendChild(doc.createTextNode(text.slice(pos, r[0])));
        const mark = doc.createElement('mark');
        mark.className = 'dv-hit';
        mark.textContent = text.slice(r[0], r[1]);
        frag.appendChild(mark);
        marks.push(mark);
        pos = r[1];
      });
      if (pos < text.length) frag.appendChild(doc.createTextNode(text.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    }
    return marks;
  }
  function unhighlight(marks) {
    marks.forEach(function (m) {
      const parent = m.parentNode;
      if (!parent) return;
      parent.replaceChild(m.ownerDocument.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }
  return { findMatches, countLabel, escapeRegExp, highlight, unhighlight };
});
