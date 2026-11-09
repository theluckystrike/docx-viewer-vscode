'use strict';
// The redline view: a webview with the formatted compare of two documents (inline or side by side), a change
// list with next/previous and filters, and the exports. The compare runs in a worker (run.js) with progress
// and Cancel. Nothing leaves the machine.
const path = require('path');
const { runRedline } = require('./run');
const S = require('./style');
const { nonce } = require('../rand');
const { footerHtml, FOOTER_CSS, commandUris, showLinks } = require('../support');

const VIEW_TYPE = 'docxViewer.redline';
const MB = 1024 * 1024;

function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const LAYOUT = `
html, body { height: 100%; margin: 0; }
body { background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); display: flex; flex-direction: column; }
.rl-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); }
.rl-bar .sp { flex: 1; }
.rl-btn { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #fff); border: 1px solid transparent; border-radius: 3px; padding: 3px 9px; cursor: pointer; font: inherit; }
.rl-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
.rl-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.rl-btn[aria-pressed="true"] { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.rl-btn.primary { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.rl-pro { font-size: 10px; opacity: 0.85; margin-left: 4px; }
.rl-names { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 40vw; }
.rl-sum { padding: 4px 10px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; }
.rl-sum label { white-space: nowrap; cursor: pointer; }
.rl-sum .total { color: var(--vscode-foreground); font-weight: 600; }
.rl-main { flex: 1; display: flex; min-height: 0; }
.rl-list { width: 260px; min-width: 180px; border-right: 1px solid var(--vscode-panel-border, #3c3c3c); overflow: auto; font-size: 12px; }
.rl-list ol { list-style: none; margin: 0; padding: 0; }
.rl-list li { padding: 4px 8px; cursor: pointer; border-bottom: 1px solid rgba(128,128,128,0.15); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-list li:hover { background: var(--vscode-list-hoverBackground); }
.rl-list li.cur { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.rl-list .ty { display: inline-block; min-width: 18px; font-weight: 700; margin-right: 6px; text-align: center; }
.ty-ins { color: var(--rl-ins-fg); } .ty-del { color: var(--rl-del-fg); } .ty-move { color: var(--rl-move); } .ty-cell { color: var(--rl-cell); } .ty-fmt { color: var(--rl-fmt); }
.rl-list .more { padding: 8px; color: var(--vscode-descriptionForeground); white-space: normal; }
body.nolist .rl-list { display: none; }
.rl-scroll { flex: 1; overflow: auto; }
.rl-paper { padding: 20px 32px 60px; min-height: 100%; box-sizing: border-box; }
.rl-doc { max-width: 920px; margin: 0 auto; }
body.sbs .rl-doc { max-width: none; }
.rl-sbs { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
.rl-sbs > div { min-width: 0; }
.rl-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; font-weight: 600; color: var(--vscode-descriptionForeground); margin-bottom: 10px; position: sticky; top: -20px; background: inherit; padding: 4px 0; z-index: 2; }
.rl-msg { padding: 24px; max-width: 720px; }
.rl-msg h2 { margin-top: 0; }
.rl-progress { padding: 24px; color: var(--vscode-descriptionForeground); }
.rl-banner { padding: 6px 10px; background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); font-size: 12px; }
.rl-hide { display: none !important; }
`;

function shellHtml(webview, opts) {
  const n = nonce();
  const csp = ["default-src 'none'", 'img-src ' + webview.cspSource + ' blob: data:', 'style-src ' + webview.cspSource + " 'nonce-" + n + "'", 'font-src ' + webview.cspSource, "script-src 'nonce-" + n + "'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"].join('; ');
  const footer = footerHtml('docxViewer', opts.showSupportLinks, 'zovo-support-fixed');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${escAttr(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${n}">${S.WEBVIEW_VARS}${S.MARKS}${LAYOUT}${footer ? FOOTER_CSS : ''}</style>
<title>Redline</title>
</head>
<body data-theme="${escAttr(opts.theme || 'auto')}" class="${opts.formatting ? '' : 'rl-nofmt'}">
<header class="rl-bar" role="toolbar" aria-label="Redline toolbar">
  <button type="button" class="rl-btn" id="rl-list-toggle" aria-pressed="true" title="Show or hide the change list">Changes</button>
  <span class="rl-names" id="rl-names"></span>
  <span class="sp"></span>
  <button type="button" class="rl-btn" id="rl-inline" aria-pressed="true" title="One document with insertions and deletions marked">Inline</button>
  <button type="button" class="rl-btn" id="rl-side" aria-pressed="false" title="Older and newer side by side, scrolling together">Side by side</button>
  <button type="button" class="rl-btn" id="rl-prev" title="Previous change (Shift+F7)" aria-label="Previous change">&#8593;</button>
  <span id="rl-pos" aria-live="polite">0 of 0</span>
  <button type="button" class="rl-btn" id="rl-next" title="Next change (F7)" aria-label="Next change">&#8595;</button>
  <button type="button" class="rl-btn" id="rl-swap" title="Swap older and newer">Swap</button>
  <button type="button" class="rl-btn" id="rl-theme" title="Page theme: follow VS Code, light paper or dark">Theme: Auto</button>
  <button type="button" class="rl-btn primary" id="rl-export-docx" title="Save a new Word document with tracked changes that Word and LibreOffice can accept or reject">Export DOCX<span class="rl-pro" id="rl-pro-docx"></span></button>
  <button type="button" class="rl-btn" id="rl-export-html" title="Save one self-contained HTML file (print it to PDF from a browser)">Export HTML<span class="rl-pro" id="rl-pro-html"></span></button>
</header>
<div class="rl-sum" id="rl-sum" role="group" aria-label="Change types">
  <span class="total" id="rl-total">Comparing...</span>
  <label><input type="checkbox" data-f="ins" checked> <span id="n-ins">insertions</span></label>
  <label><input type="checkbox" data-f="del" checked> <span id="n-del">deletions</span></label>
  <label><input type="checkbox" data-f="move" checked> <span id="n-move">moves</span></label>
  <label><input type="checkbox" data-f="cell" checked> <span id="n-cell">table cells</span></label>
  <label title="Bold, italic, underline, size and paragraph style changes"><input type="checkbox" id="rl-fmt" data-f="fmt"${opts.formatting ? ' checked' : ''}> <span id="n-fmt">formatting</span></label>
</div>
<div id="rl-banners"></div>
<div class="rl-main">
  <nav class="rl-list" id="rl-list" aria-label="Change list"><ol id="rl-items"></ol></nav>
  <div class="rl-scroll" id="rl-scroll"><div class="rl-paper"><div class="rl-progress" id="rl-progress">Comparing the documents...</div><div class="rl-doc" id="rl-doc"></div></div></div>
</div>
${footer}
<script nonce="${n}" src="${escAttr(opts.scriptUri)}"></script>
</body>
</html>`;
}

class RedlinePanel {
  // a, b: { uri?, bytes?, name, label }. a is the older document, b the newer one.
  constructor(host, a, b) {
    this.host = host;
    this.a = a;
    this.b = b;
    this.payload = null;
    this.busy = false;
    const vscode = host.vscode;
    const media = vscode.Uri.joinPath(host.context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel(VIEW_TYPE, this.title(), vscode.ViewColumn.Active, {
      enableScripts: true,
      enableCommandUris: commandUris('docxViewer'),
      localResourceRoots: [media],
      retainContextWhenHidden: true
    });
    this.panel.iconPath = vscode.Uri.joinPath(host.context.extensionUri, 'icon.png');
    this.panel.webview.html = shellHtml(this.panel.webview, {
      theme: host.cfg().theme,
      formatting: host.cfg().formatting,
      showSupportLinks: showLinks(vscode, 'docxViewer'),
      scriptUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'redline.js')).toString()
    });
    this.subs = [this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m))];
    if (host.pro) this.subs.push(host.pro.onDidChange(() => this.postPro()));
    this.panel.onDidDispose(() => { this.subs.forEach((s) => s.dispose()); host.panels.delete(this); this.a = this.b = this.payload = null; });
    host.panels.add(this);
  }

  title() { return 'Redline: ' + this.a.name + (this.a.name === this.b.name ? ' (' + this.a.label + ' ↔ ' + this.b.label + ')' : ' ↔ ' + this.b.name); }

  post(m) { return this.panel.webview.postMessage(m); }

  postPro() {
    const pro = this.host.pro;
    return this.post({ type: 'pro', docx: pro ? pro.label('exportRedline') : '', html: pro ? pro.label('exportRedline') : '', hide: !!(pro && pro.shown && !pro.shown()) });
  }

  job(task) {
    return { task, a: { bytes: this.a.bytes, name: this.a.name, label: this.a.label }, b: { bytes: this.b.bytes, name: this.b.name, label: this.b.label }, opts: { formatting: task === 'view' ? true : this.host.cfg().formatting, author: 'Compare', date: new Date().toISOString().slice(0, 10) + 'T00:00:00Z' } };
  }

  async run() {
    const vscode = this.host.vscode;
    this.busy = true;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DOCX Viewer: comparing ' + this.a.name + ' and ' + this.b.name, cancellable: true }, (progress, token) => {
      let last = 0;
      return runRedline(this.job('view'), {
        token,
        onProgress: (p) => {
          progress.report({ message: p.stage, increment: Math.max(0, p.pct - last) });
          last = p.pct;
          this.post({ type: 'progress', text: p.stage + '...' });
        }
      });
    });
    this.busy = false;
    if (!this.a) return r; // closed meanwhile
    if (r.cancelled) { this.post({ type: 'error', title: 'Compare cancelled', detail: 'Close this tab, or run the compare again.' }); return r; }
    if (!r.ok) {
      const n = r.notice || { title: 'The compare failed', detail: '' };
      const which = r.which === 'a' ? this.a.name : r.which === 'b' ? this.b.name : '';
      this.post({ type: 'error', title: n.title, detail: (which ? which + ': ' : '') + (n.detail || '') });
      this.host.rating.failure();
      return r;
    }
    this.payload = r.payload;
    await this.send(r.payload);
    if (this.b.uri) this.host.rating.success(this.b.uri);
    return r;
  }

  async send(p) {
    await this.post({ type: 'start', names: { a: this.a.name + ' (' + this.a.label + ')', b: this.b.name + ' (' + this.b.label + ')' }, summary: p.summary, counts: p.counts, total: p.total, listed: p.listed, banners: p.banners, exportDocx: p.exportDocx, ms: p.ms, theme: this.host.cfg().theme });
    await this.postPro();
    const CHUNK = 400;
    for (let i = 0; i < p.rows.length; i += CHUNK) {
      if (!this.a) return;
      await this.post({ type: 'rows', rows: p.rows.slice(i, i + CHUNK) });
    }
    await this.post({ type: 'done', changes: p.changes });
  }

  async onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'export' && (m.format === 'docx' || m.format === 'html')) return this.host.exportRedline(this, m.format);
    if (m.type === 'swap') {
      if (this.busy) return;
      const t = this.a; this.a = this.b; this.b = t;
      this.panel.title = this.title();
      await this.post({ type: 'reset' });
      return this.run();
    }
    if (m.type === 'formatting' && typeof m.on === 'boolean') {
      const c = this.host.vscode.workspace.getConfiguration('docxViewer');
      return c.update('redlineFormatting', m.on, this.host.vscode.ConfigurationTarget.Global);
    }
  }
}

// Wires the redline into the extension. deps: { vscode, context, rating, pro, cfg }
function createRedline(deps) {
  const { vscode } = deps;
  const host = {
    vscode,
    context: deps.context,
    rating: deps.rating || { success() {}, failure() {} },
    pro: deps.pro || null,
    panels: new Set(),
    cfg: () => {
      const c = vscode.workspace.getConfiguration('docxViewer');
      const base = deps.cfg ? deps.cfg() : {};
      return Object.assign({}, base, { formatting: c.get('redlineFormatting', true) !== false });
    }
  };

  async function readDoc(d) {
    if (d.bytes) return d;
    const max = host.cfg().maxFileBytes || 100 * MB;
    const st = await vscode.workspace.fs.stat(d.uri);
    if (st.size > max) {
      const pick = await vscode.window.showWarningMessage(d.name + ' is ' + (st.size / MB).toFixed(1) + ' MB, over the docxViewer.maxFileSizeMB limit. Compare it anyway?', 'Compare Anyway');
      if (pick !== 'Compare Anyway') return null;
    }
    d.bytes = await vscode.workspace.fs.readFile(d.uri);
    return d;
  }

  // a: older, b: newer. Each { uri } or { bytes, name, label }.
  async function open(a, b) {
    const A = await readDoc(Object.assign({ name: a.uri ? path.basename(a.uri.path) : 'older', label: 'older' }, a));
    if (!A) return null;
    const B = await readDoc(Object.assign({ name: b.uri ? path.basename(b.uri.path) : 'newer', label: 'newer' }, b));
    if (!B) return null;
    const panel = new RedlinePanel(host, A, B);
    panel.done = panel.run(); // the Compare menu's export waits for it
    return panel;
  }

  host.exportRedline = async function exportRedline(panel, format) {
    if (!panel.payload) return vscode.window.showInformationMessage('Wait for the compare to finish, then export.');
    if (format === 'docx' && !panel.payload.exportDocx) {
      return vscode.window.showInformationMessage('Export as DOCX needs a Word file (.docx, .docm or .dotx) as the newer document. Export as HTML works for every format, or use Swap if the Word file is the newer one.');
    }
    if (host.pro && !(await host.pro.check('exportRedline'))) return;
    const base = panel.b.name.replace(/\.[^.]+$/, '');
    const ext = format === 'docx' ? (/\.docm$/i.test(panel.b.name) ? '.docm' : '.docx') : '.html';
    const dir = panel.b.uri && panel.b.uri.scheme === 'file' ? vscode.Uri.joinPath(panel.b.uri, '..') : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri : undefined);
    const def = dir ? vscode.Uri.joinPath(dir, base + ' redline' + ext) : undefined;
    const target = await vscode.window.showSaveDialog({ defaultUri: def, saveLabel: 'Export Redline', title: 'Save the redline as ' + (format === 'docx' ? 'a Word document with tracked changes' : 'HTML'), filters: format === 'docx' ? { 'Word document': [ext.slice(1)] } : { HTML: ['html'] } });
    if (!target) return;
    const same = (u) => u && u.toString() === target.toString();
    if (same(panel.a.uri) || same(panel.b.uri)) return vscode.window.showWarningMessage('Pick another file name: the redline never replaces one of the two documents.');
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DOCX Viewer: writing the redline', cancellable: true }, (progress, token) => runRedline(panel.job(format), { token, onProgress: (p) => progress.report({ message: p.stage }) }));
    if (r.cancelled) return;
    if (!r.ok) return vscode.window.showWarningMessage('DOCX Viewer could not export the redline. ' + ((r.notice && (r.notice.title + '. ' + (r.notice.detail || ''))) || ''));
    const data = format === 'docx' ? r.bytes : new TextEncoder().encode(r.html);
    await vscode.workspace.fs.writeFile(target, data);
    // The file is saved: only now does the export use a free try (a cancelled save dialog costs nothing).
    if (host.pro) { await host.pro.commit('exportRedline'); if (panel.a) panel.postPro(); }
    let msg = 'Saved ' + path.basename(target.path) + '.';
    if (format === 'docx') {
      msg = 'Saved ' + path.basename(target.path) + ' with tracked changes by "Compare".';
      if (r.check && r.check.accept && r.check.reject) msg += ' Checked: accepting all changes gives the newer text, rejecting all gives the older text.';
      else if (r.check && (r.check.accept === false || r.check.reject === false)) msg += ' Note: the accept/reject check found a difference in the text (pictures, equations or fields). Please review the result.';
    }
    const buttons = target.scheme === 'file' ? ['Open in Default App', 'Reveal in File Explorer'] : [];
    const pick = await vscode.window.showInformationMessage(msg, ...buttons);
    if (pick === 'Open in Default App') await vscode.env.openExternal(target);
    else if (pick === 'Reveal in File Explorer') await vscode.commands.executeCommand('revealFileInOS', target);
    return target;
  };

  function active() {
    for (const p of host.panels) if (p.panel.active) return p;
    for (const p of host.panels) if (p.panel.visible) return p;
    return null;
  }

  function exportActive(format) {
    const p = active();
    if (!p) return vscode.window.showInformationMessage('Open a redline first: run "Compare Documents (Redline)".');
    return host.exportRedline(p, format);
  }

  return { open, host, active, exportActive, readDoc };
}

module.exports = { createRedline, RedlinePanel, shellHtml, VIEW_TYPE };
