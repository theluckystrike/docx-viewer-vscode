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
  return { findMatches, countLabel, escapeRegExp };
});
