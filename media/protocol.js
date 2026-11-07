// Message protocol between the extension host and the webview.
// Loaded as a plain script in the webview (window.DocxProtocol) and with require() in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DocxProtocol = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = 1;
  // webview -> extension
  const COMMANDS = ['openAsText', 'copyMarkdown', 'openInDefaultApp', 'openAnyway', 'reload', 'openSettings'];
  const THEMES = ['auto', 'light', 'dark'];
  const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s<>"]{1,2040}$/i;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // Returns { ok: true, msg } with only known fields, or { ok: false, error }.
  function validateInbound(m) {
    if (!isObj(m) || typeof m.type !== 'string') return { ok: false, error: 'not a message' };
    switch (m.type) {
      case 'ready':
        return { ok: true, msg: { type: 'ready' } };
      case 'command':
        if (COMMANDS.indexOf(m.name) === -1) return { ok: false, error: 'unknown command' };
        return { ok: true, msg: { type: 'command', name: m.name } };
      case 'openLink':
        if (typeof m.href !== 'string' || !SAFE_LINK.test(m.href)) return { ok: false, error: 'link not allowed' };
        return { ok: true, msg: { type: 'openLink', href: m.href } };
      case 'setTheme':
        if (THEMES.indexOf(m.theme) === -1) return { ok: false, error: 'unknown theme' };
        return { ok: true, msg: { type: 'setTheme', theme: m.theme } };
      default:
        return { ok: false, error: 'unknown type' };
    }
  }

  // Splits a conversion result into the messages the extension posts, in order.
  function buildRenderMessages(result, meta) {
    const total = result.chunks.length;
    const out = [{ type: 'begin', v: VERSION, meta: meta, total: total, banner: typeof result.banner === 'string' ? result.banner : '' }];
    for (let i = 0; i < total; i++) out.push({ type: 'chunk', index: i, total: total, html: result.chunks[i] });
    out.push({ type: 'end', outline: result.outline, warnings: result.warnings, stats: result.stats });
    return out;
  }

  function buildNotice(notice, meta, actions) {
    return { type: 'notice', v: VERSION, meta: meta, kind: notice.kind, title: notice.title, detail: notice.detail, actions: (actions || []).filter((a) => COMMANDS.indexOf(a) !== -1) };
  }

  // Checks messages arriving in the webview. Returns true when the shape is right.
  function validateOutbound(m) {
    if (!isObj(m)) return false;
    switch (m.type) {
      case 'begin': return isObj(m.meta) && Number.isInteger(m.total) && m.total >= 1 && (m.banner === undefined || typeof m.banner === 'string');
      case 'chunk': return Number.isInteger(m.index) && m.index >= 0 && m.index < m.total && typeof m.html === 'string';
      case 'end': return Array.isArray(m.outline) && Array.isArray(m.warnings) && isObj(m.stats);
      case 'notice': return typeof m.title === 'string' && typeof m.detail === 'string' && Array.isArray(m.actions);
      case 'theme': return THEMES.indexOf(m.theme) !== -1;
      case 'find': case 'loading': return true;
      default: return false;
    }
  }

  return { VERSION, COMMANDS, THEMES, validateInbound, validateOutbound, buildRenderMessages, buildNotice };
});
