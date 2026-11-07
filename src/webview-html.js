'use strict';
// Builds the webview shell. Document content never goes into this string; it
// arrives later through postMessage as sanitized HTML.
const { nonce: randomNonce } = require('./rand');
const { footerHtml, FOOTER_CSS } = require('./support');

function nonce() {
  return randomNonce();
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
    'img-src blob: data: ' + opts.cspSource,
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
<body data-theme="${escapeAttr(opts.theme || 'auto')}" data-zoom="${zoomAttr(opts.zoom)}" data-bar="${opts.toolbarHidden ? 'hidden' : 'shown'}" data-font="${escapeAttr(fontAttr(opts.font))}">
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
 ${zoomControls(false)}
  <button type="button" id="dv-theme" class="dv-btn" title="Page theme: follow VS Code, light paper or dark">Theme: Auto</button>
  ${opts.pageAvailable ? '<button type="button" id="dv-view" class="dv-btn" data-cmd="showPage" title="Show the pages the way Word lays them out">Page view</button>' : ''}
  <button type="button" class="dv-btn" data-cmd="copyMarkdown" title="Copy the whole document as Markdown">Copy Markdown</button>
  <button type="button" class="dv-btn" data-cmd="openAsText" title="Open the plain text in a new editor">Open as Text</button>
  <button type="button" id="dv-bar-hide" class="dv-btn dv-icon" title="Hide the toolbar (Ctrl+Shift+H)" aria-label="Hide the toolbar">&#8963;</button>
</header>
<button type="button" id="dv-bar-show" class="dv-btn dv-bar-show" title="Show the toolbar (Ctrl+Shift+H)" aria-label="Show the toolbar">&#8964;</button>
<div class="dv-main">
  <nav id="dv-outline" class="dv-outline" aria-label="Outline"><div class="dv-outline-title">Outline</div><ol id="dv-outline-list"></ol></nav>
  <main id="dv-scroll" class="dv-scroll" tabindex="-1">
    <div id="dv-rev" class="dv-rev" role="group" aria-label="Tracked changes and comments" hidden><span id="dv-rev-text"></span><span id="dv-rev-authors" class="dv-rev-authors"></span><span class="dv-rev-modes"><button type="button" class="dv-btn" data-rev="revMarkup" title="Show insertions, deletions and comments">Markup</button><button type="button" class="dv-btn" data-rev="revFinal" title="As if every change were accepted">Final</button><button type="button" class="dv-btn" data-rev="revOriginal" title="As if every change were rejected">Original</button></span></div>
    <div id="dv-banner" class="dv-banner" role="note" hidden><span id="dv-banner-text"></span><span id="dv-banner-actions" class="dv-banner-actions"></span></div>
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

// docxViewer.fontFamily: '' (document fonts), 'editor' (the editor font) or a font list.
function fontAttr(f) {
  const v = typeof f === 'string' ? f.trim() : '';
  return /^[\w\s,"'.-]{0,200}$/.test(v) ? v : '';
}

function zoomAttr(z) {
  const n = Number(z);
  return String(Number.isFinite(n) && n >= 0.5 && n <= 3 ? n : 1);
}

function zoomControls(withFit) {
  return '<span class="dv-zoom" role="group" aria-label="Zoom">' +
    '<button type="button" id="dv-zoom-out" class="dv-btn dv-icon" title="Zoom out (Ctrl+-)" aria-label="Zoom out">&#8722;</button>' +
    '<button type="button" id="dv-zoom-label" class="dv-btn" title="Reset zoom to 100% (Ctrl+0)">100%</button>' +
    '<button type="button" id="dv-zoom-in" class="dv-btn dv-icon" title="Zoom in (Ctrl+=)" aria-label="Zoom in">+</button>' +
    (withFit ? '<button type="button" id="dv-zoom-fit" class="dv-btn" title="Fit the widest page to the window">Fit width</button>' : '') +
    '</span>';
}

// CSP for Page view. docx-preview writes <style> elements and style="" attributes, so styles need
// 'unsafe-inline' (and so no style nonce, which would switch 'unsafe-inline' off). Images and
// embedded fonts arrive as blob: URLs made from the file. No script from the document can run and
// no request can leave the webview.
function pageCsp(cspSource, n) {
  return [
    "default-src 'none'",
    'img-src blob: data: ' + cspSource,
    'style-src ' + cspSource + " 'unsafe-inline'",
    'font-src blob: data: ' + cspSource,
    "script-src 'nonce-" + n + "'",
    "connect-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ');
}

// Page view shell. The file bytes arrive later through postMessage; docx-preview lays them out.
// uris: { css, protocol, search, pageView, page }.
function buildPageHtml(opts) {
  const n = opts.nonce || nonce();
  const footer = footerHtml('docxViewer', opts.showSupportLinks !== false, 'zovo-support-fixed');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(pageCsp(opts.cspSource, n))}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(opts.uris.css)}">
${footer ? `<style>${FOOTER_CSS}</style>` : ''}
<title>DOCX Viewer</title>
</head>
<body class="dv-pageview" data-theme="${escapeAttr(opts.theme || 'auto')}" data-zoom="${zoomAttr(opts.zoom)}" data-bar="${opts.toolbarHidden ? 'hidden' : 'shown'}">
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
  ${zoomControls(true)}
  <button type="button" id="dv-theme" class="dv-btn" title="Page theme: follow VS Code, light paper or dark">Theme: Auto</button>
  <button type="button" id="dv-view" class="dv-btn" data-cmd="showReading" title="Show the text as one flowing column">Reading view</button>
  <button type="button" class="dv-btn" data-cmd="copyMarkdown" title="Copy the whole document as Markdown">Copy Markdown</button>
  <button type="button" class="dv-btn" data-cmd="openAsText" title="Open the plain text in a new editor">Open as Text</button>
  <button type="button" id="dv-bar-hide" class="dv-btn dv-icon" title="Hide the toolbar (Ctrl+Shift+H)" aria-label="Hide the toolbar">&#8963;</button>
</header>
<button type="button" id="dv-bar-show" class="dv-btn dv-bar-show" title="Show the toolbar (Ctrl+Shift+H)" aria-label="Show the toolbar">&#8964;</button>
<div class="dv-main">
  <nav id="dv-outline" class="dv-outline" aria-label="Outline"><div class="dv-outline-title">Outline</div><ol id="dv-outline-list"></ol></nav>
  <main id="dv-pages" class="dv-scroll dv-pages" tabindex="-1">
    <div id="dv-page-note" class="dv-banner" role="note" hidden><span id="dv-page-note-text"></span><span id="dv-page-note-actions" class="dv-banner-actions"></span></div>
    <div id="dv-status" class="dv-status">Laying out pages...</div>
    <div id="dv-page-styles" hidden></div>
    <div id="dv-page-root" class="dv-page-root"></div>
  </main>
</div>
${footer}
<script nonce="${n}" src="${escapeAttr(opts.uris.protocol)}"></script>
<script nonce="${n}" src="${escapeAttr(opts.uris.search)}"></script>
<script nonce="${n}" src="${escapeAttr(opts.uris.pageView)}"></script>
<script nonce="${n}" src="${escapeAttr(opts.uris.page)}"></script>
</body>
</html>`;
}

module.exports = { buildWebviewHtml, buildPageHtml, pageCsp, nonce, fontAttr };
