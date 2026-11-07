'use strict';
// Builds the webview shell. Document content never goes into this string; it
// arrives later through postMessage as sanitized HTML.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

function nonce() {
  return crypto.randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '');
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// uris: { css, protocol, search, viewer } as strings; cspSource: webview.cspSource.
// opts.showSupportLinks: false leaves out the small Sponsor and More free viewers line (setting docxViewer.showSupportLinks).
function buildWebviewHtml(opts) {
  const n = opts.nonce || nonce();
  const footer = footerHtml('docxViewer', opts.showSupportLinks !== false, 'zovo-support-fixed');
  const csp = [
    "default-src 'none'",
    'img-src data: ' + opts.cspSource,
    'style-src ' + opts.cspSource + " 'nonce-" + n + "'",
    'font-src ' + opts.cspSource,
    "script-src 'nonce-" + n + "'",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(opts.uris.css)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
<title>DOCX Viewer</title>
</head>
<body data-theme="${escapeAttr(opts.theme || 'auto')}">
<header class="dv-bar" role="toolbar" aria-label="Document toolbar">
  <button type="button" id="dv-outline-toggle" class="dv-btn" title="Show or hide the outline" aria-pressed="true">Outline</button>
  <span id="dv-name" class="dv-name"></span>
  <span class="dv-spacer"></span>
  <span class="dv-search">
    <input id="dv-q" type="search" placeholder="Search" aria-label="Search in document" spellcheck="false" autocomplete="off">
    <span id="dv-count" class="dv-count" aria-live="polite"></span>
    <button type="button" id="dv-prev" class="dv-btn dv-icon" title="Previous match (Shift+Enter)" aria-label="Previous match">&#8593;</button>
    <button type="button" id="dv-next" class="dv-btn dv-icon" title="Next match (Enter)" aria-label="Next match">&#8595;</button>
  </span>
  <button type="button" id="dv-theme" class="dv-btn" title="Page theme: follow VS Code, light paper or dark">Theme: Auto</button>
  <button type="button" class="dv-btn" data-cmd="copyMarkdown" title="Copy the whole document as Markdown">Copy Markdown</button>
  <button type="button" class="dv-btn" data-cmd="openAsText" title="Open the plain text in a new editor">Open as Text</button>
</header>
<div class="dv-main">
  <nav id="dv-outline" class="dv-outline" aria-label="Outline"><div class="dv-outline-title">Outline</div><ol id="dv-outline-list"></ol></nav>
  <main id="dv-scroll" class="dv-scroll" tabindex="-1">
    <div id="dv-banner" class="dv-banner" role="note" hidden><span id="dv-banner-text"></span><button type="button" class="dv-btn" data-cmd="openInDefaultApp">Open in Default App</button></div>
    <div id="dv-status" class="dv-status">Opening document...</div>
    <article id="dv-doc" class="dv-page" hidden></article>
    <details id="dv-warnings" class="dv-warnings" hidden><summary></summary><ul></ul></details>
  </main>
</div>
${footer}
<script nonce="${n}" src="${escapeAttr(opts.uris.protocol)}"></script>
<script nonce="${n}" src="${escapeAttr(opts.uris.search)}"></script>
<script nonce="${n}" src="${escapeAttr(opts.uris.viewer)}"></script>
</body>
</html>`;
}

module.exports = { buildWebviewHtml, nonce };
