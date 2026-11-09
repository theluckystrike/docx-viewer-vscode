'use strict';
const vscode = require('vscode');
const path = require('path');
const runWorker = require('./run-worker'); // src/web/run-worker.js in the VS Code for the Web build
const { convertInWorker } = runWorker;
const { noticeFor, detectFormat, canConvert } = require('./detect');
const { buildWebviewHtml, buildPageHtml, fontAttr } = require('./webview-html');
const P = require('../media/protocol');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');
const { registerCompare } = require('./compare');
const { createRedline } = require('./redline/panel');
const { registerFolders } = require('./redline/folders');
const { createPro } = require('./pro');

let rating = { success() {}, failure() {} };
const counted = new WeakSet(); // panels already counted for the rating prompt

const VIEW_TYPE = 'docxViewer.preview';
// VS Code for the Web (vscode.dev, github.dev): no default app to hand a file to, and no git.
const isWeb = () => !!(vscode.env && vscode.UIKind && vscode.env.uiKind === vscode.UIKind.Web);
const WEB_NO_APP = 'VS Code for the Web cannot open files in another app. Right-click the file in the Explorer and choose Download to open it on your computer.';
function openInDefaultApp(uri) {
  if (isWeb()) return vscode.window.showInformationMessage(WEB_NO_APP);
  return vscode.env.openExternal(uri);
}
const MB = 1024 * 1024;

function cfg() {
  const c = vscode.workspace.getConfiguration('docxViewer');
  const num = (k, d, min) => { const v = Number(c.get(k, d)); return Number.isFinite(v) && v >= min ? v : d; };
  return {
    maxFileBytes: num('maxFileSizeMB', 100, 1) * MB,
    maxImageBytes: num('maxImageSizeMB', 20, 0.1) * MB,
    maxTotalImageBytes: num('maxTotalImagesMB', 300, 1) * MB,
    font: typeof c.get('fontFamily') === 'string' ? c.get('fontFamily') : '',
    theme: P.THEMES.includes(c.get('theme')) ? c.get('theme') : 'auto',
    defaultView: P.VIEWS.includes(c.get('defaultView')) ? c.get('defaultView') : 'reading',
    zoom: P.clampZoom(c.get('zoom', 1)),
    pageMaxBytes: num('pageViewMaxMB', 100, 1) * MB
  };
}

// Page view lays out Word packages only; .odt and old .doc files stay in Reading view.
const PAGE_EXT = /\.(docx|dotx|docm)$/i;
const VIEW_KEY = 'docxViewer.view';
const ZOOM_KEY = 'docxViewer.zoom';
const TOOLBAR_KEY = 'docxViewer.toolbarHidden';
function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
function pageNoteText(rev) {
  const parts = [];
  if (rev.changes) parts.push(plural(rev.changes, 'tracked change', 'tracked changes'));
  if (rev.comments) parts.push(plural(rev.comments, 'comment', 'comments'));
  return 'This document has ' + parts.join(' and ') + '. Reading view shows them.';
}

const NOTES = {
  tooLarge: 'This file is too large for Page view. Reading view is faster for it.',
  failed: 'Page view could not lay out this file, so it opens in Reading view.'
};

class DocxDocument {
  constructor(uri) {
    this.uri = uri;
    this.result = null; // { ok, ... } from the converter
    this.pending = null;
    this.allowLarge = false;
    this.allowLargePage = false;
    this.revMode = 'markup'; // view for files with tracked changes or comments
    this.alt = {}; // mode -> promise of the Markup or Original conversion
    this.version = 0;
  }
  invalidate() { this.result = null; this.pending = null; this.alt = {}; this.version++; }
  dispose() { this.result = null; this.pending = null; }
}

class DocxEditorProvider {
  constructor(context) {
    this.context = context;
    this.panels = new Map(); // panel -> document
    this.views = new Map(); // panel -> 'reading' | 'page'
    this.notes = new Map(); // panel -> { text, actions } shown once above Reading view
    this.active = null;
  }

  pageAvailable(document) { return PAGE_EXT.test(document.uri.path); }

  // The user's last switch in this workspace, else the docxViewer.defaultView setting.
  preferredView(document) {
    if (!this.pageAvailable(document)) return 'reading';
    const ws = this.context.workspaceState;
    const saved = ws && ws.get(VIEW_KEY);
    return P.VIEWS.includes(saved) ? saved : cfg().defaultView;
  }

  zoom() {
    const ws = this.context.workspaceState;
    const saved = ws && ws.get(ZOOM_KEY);
    return typeof saved === 'number' ? P.clampZoom(saved) : cfg().zoom;
  }

  // Sets the panel HTML for a view. Reading view keeps its own strict CSP; Page view gets the
  // CSP that docx-preview needs (inline styles, blob: images and fonts).
  setView(panel, document, view) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const u = (f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    const ws = this.context.workspaceState;
    const common = { cspSource: panel.webview.cspSource, theme: cfg().theme, zoom: this.zoom(), showSupportLinks: showLinks(vscode, 'docxViewer'), toolbarHidden: !!(ws && ws.get(TOOLBAR_KEY)), font: cfg().font };
    this.views.set(panel, view);
    panel.webview.html = view === 'page'
      ? buildPageHtml({ ...common, uris: { css: u('viewer.css'), protocol: u('protocol.js'), search: u('search.js'), pageView: u('page-view.js'), page: u('page.js'), pictures: u('pictures.js') } })
      : buildWebviewHtml({ ...common, pageAvailable: this.pageAvailable(document), uris: { css: u('viewer.css'), protocol: u('protocol.js'), search: u('search.js'), viewer: u('viewer.js'), pictures: u('pictures.js') } });
  }

  async switchView(panel, document, view, remember) {
    if (view === 'page' && !this.pageAvailable(document)) return;
    if (remember && this.context.workspaceState) await this.context.workspaceState.update(VIEW_KEY, view);
    this.setView(panel, document, view);
  }

  async openCustomDocument(uri) {
    return new DocxDocument(uri);
  }

  async resolveCustomEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    // Command links only for the two support commands and the settings page (footer "Hide" link). Links inside the
    // document never reach them: viewer.js catches every click in the document and the host drops command: links.
    panel.webview.options = { enableScripts: true, enableCommandUris: commandUris('docxViewer'), localResourceRoots: [media] };
    this.setView(panel, document, this.preferredView(document));
    this.panels.set(panel, document);
    if (panel.active) this.active = panel;

    const subs = [];
    subs.push(panel.onDidChangeViewState(() => { if (panel.active) this.active = panel; else if (this.active === panel) this.active = null; }));
    subs.push(panel.webview.onDidReceiveMessage((raw) => this.onMessage(panel, document, raw)));
    // Re-render when the file changes on disk (for example after saving it in Word).
    if (document.uri.scheme === 'file') {
      const dir = vscode.Uri.file(path.dirname(document.uri.fsPath));
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, path.basename(document.uri.fsPath)));
      let t = null;
      const changed = () => { clearTimeout(t); t = setTimeout(() => { document.invalidate(); this.render(panel, document); }, 400); };
      subs.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed));
    }
    panel.onDidDispose(() => {
      this.panels.delete(panel);
      if (this.active === panel) this.active = null;
      subs.forEach((s) => s.dispose());
    });
  }

  async onMessage(panel, document, raw) {
    const v = P.validateInbound(raw);
    if (!v.ok) return;
    const m = v.msg;
    if (m.type === 'ready') return this.render(panel, document);
    if (m.type === 'openLink') return vscode.env.openExternal(vscode.Uri.parse(m.href, true));
    if (m.type === 'setTheme') return; // per-panel choice, kept in webview state
    if (m.type === 'setZoom') {
      if (this.context.workspaceState) await this.context.workspaceState.update(ZOOM_KEY, m.zoom);
      for (const p of this.panels.keys()) if (p !== panel) p.webview.postMessage({ type: 'zoom', zoom: m.zoom });
      return;
    }
    if (m.type === 'pageRendered') {
      this.lastPageRender = m;
      if (!counted.has(panel)) { counted.add(panel); rating.success(document.uri); }
      return;
    }
    if (m.type === 'setToolbar') return this.setToolbar(m.hidden, panel);
    if (m.type === 'pageFailed') {
      rating.failure();
      this.notes.set(panel, { text: NOTES.failed, actions: [] });
      return this.switchView(panel, document, 'reading', false);
    }
    switch (m.name) {
      case 'openAsText': return openAsText(document.uri, this);
      case 'copyMarkdown': return copyMarkdown(document.uri, this);
      case 'openInDefaultApp': return openInDefaultApp(document.uri);
      case 'openSettings': return vscode.commands.executeCommand('workbench.action.openSettings', 'docxViewer.maxFileSizeMB');
      case 'openAnyway': document.allowLarge = true; document.invalidate(); return this.render(panel, document);
      case 'reload': document.invalidate(); return this.render(panel, document);
      case 'showPage': return this.switchView(panel, document, 'page', true);
      case 'showReading': return this.switchView(panel, document, 'reading', true);
      case 'pageAnyway': document.allowLargePage = true; return this.switchView(panel, document, 'page', false);
      case 'revMarkup': document.revMode = 'markup'; return this.render(panel, document);
      case 'revFinal': document.revMode = 'final'; return this.render(panel, document);
      case 'revOriginal': document.revMode = 'original'; return this.render(panel, document);
    }
  }

  // Hidden or shown toolbar, kept per workspace and applied to every open viewer.
  async setToolbar(hidden, from) {
    if (this.context.workspaceState) await this.context.workspaceState.update(TOOLBAR_KEY, hidden);
    for (const p of this.panels.keys()) if (p !== from) p.webview.postMessage({ type: 'toolbar', hidden });
  }

  toggleToolbar() {
    const ws = this.context.workspaceState;
    return this.setToolbar(!(ws && ws.get(TOOLBAR_KEY)), null);
  }

  meta(document, size) {
    return { fileName: path.basename(document.uri.path), size: size || 0 };
  }

  // Converts once per document version and caches the result.
  async load(document) {
    if (document.result) return document.result;
    if (document.pending) return document.pending;
    const version = document.version;
    const c = cfg();
    const ext = path.extname(document.uri.path).toLowerCase();
    document.pending = (async () => {
      let size = 0;
      try {
        size = (await vscode.workspace.fs.stat(document.uri)).size;
      } catch (err) {
        return { ok: false, size, notice: { kind: 'error', title: 'DOCX Viewer could not open this file', detail: String(err.message || err) } };
      }
      if (size > c.maxFileBytes && !document.allowLarge) {
        return { ok: false, size, tooLarge: true, notice: { kind: 'tooLarge', title: 'This document is ' + (size / MB).toFixed(1) + ' MB', detail: 'Files over ' + (c.maxFileBytes / MB) + ' MB are not opened automatically, so VS Code stays fast. Open it anyway, open it in your default app, or raise docxViewer.maxFileSizeMB.' } };
      }
      const bytes = await vscode.workspace.fs.readFile(document.uri);
      const format = detectFormat(bytes);
      if (!canConvert(format, ext, bytes)) return { ok: false, size, notice: noticeFor(format, ext, bytes) };
      const r = await convertInWorker(bytes, { ext, maxImageBytes: c.maxImageBytes, maxTotalImageBytes: c.maxTotalImageBytes });
      r.size = size;
      return r;
    })();
    const r = await document.pending;
    if (document.version === version) { document.result = r; document.pending = null; }
    return r;
  }

  // Markup or Original view of a file with tracked changes or comments, converted on first use.
  // Copy as Markdown, Open as Text and Compare always use load() (Final).
  async loadMode(document, mode) {
    const base = await this.load(document);
    if (mode === 'final' || !base.ok || !base.revisions) return base;
    if (!document.alt[mode]) {
      const c = cfg();
      const ext = path.extname(document.uri.path).toLowerCase();
      document.alt[mode] = (async () => {
        const bytes = await vscode.workspace.fs.readFile(document.uri);
        const r = await convertInWorker(bytes, { ext, maxImageBytes: c.maxImageBytes, maxTotalImageBytes: c.maxTotalImageBytes, revisionMode: mode });
        if (!r.ok) return base;
        r.size = base.size;
        return r;
      })();
    }
    return document.alt[mode];
  }

  // Page view: send the file bytes to the webview, which lays them out. Files above
  // docxViewer.pageViewMaxMB go to Reading view with a note and an "anyway" button.
  async renderPage(panel, document) {
    const c = cfg();
    let size = 0;
    try {
      size = (await vscode.workspace.fs.stat(document.uri)).size;
    } catch (_) {
      return this.switchView(panel, document, 'reading', false);
    }
    if ((size > c.pageMaxBytes && !document.allowLargePage) || (size > c.maxFileBytes && !document.allowLarge)) {
      this.notes.set(panel, { text: NOTES.tooLarge, actions: size > c.maxFileBytes && !document.allowLarge ? [] : ['pageAnyway'] });
      return this.switchView(panel, document, 'reading', false);
    }
    const bytes = await vscode.workspace.fs.readFile(document.uri);
    if (detectFormat(bytes) !== 'zip') {
      return this.switchView(panel, document, 'reading', false);
    }
    if (!this.panels.has(panel)) return;
    // A plain Uint8Array over its own ArrayBuffer: VS Code sends that to the webview as binary.
    // A Node Buffer (what readFile can return) arrives as a plain object instead.
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    await panel.webview.postMessage({ type: 'pageData', v: P.VERSION, meta: this.meta(document, size), theme: c.theme, zoom: this.zoom(), pictureMaxBytes: c.maxImageBytes, bytes: copy });
    // Page view does not draw tracked changes or comments. Say so once the converter has counted them.
    const r = await this.load(document).catch(() => null);
    if (r && r.ok && r.revisions && this.panels.has(panel) && this.views.get(panel) === 'page') {
      return panel.webview.postMessage({ type: 'pageNote', text: pageNoteText(r.revisions), actions: ['showReading'] });
    }
  }

  async render(panel, document) {
    if (this.views.get(panel) === 'page') return this.renderPage(panel, document);
    const post = (m) => panel.webview.postMessage(m);
    const note = this.notes.get(panel);
    this.notes.delete(panel);
    let r;
    try {
      r = await this.load(document);
    } catch (err) {
      r = { ok: false, notice: { kind: 'error', title: 'DOCX Viewer could not read this file', detail: String((err && err.message) || err) } };
    }
    if (!this.panels.has(panel)) return;
    const meta = this.meta(document, r.size);
    if (!r.ok) {
      if (!r.tooLarge) rating.failure(); // any file that did not open: no rating ask after it
      let actions = r.tooLarge ? ['openAnyway', 'openInDefaultApp', 'openSettings'] : r.notice.kind === 'error' ? ['reload', 'openInDefaultApp'] : ['openInDefaultApp'];
      if (isWeb()) actions = actions.filter((a) => a !== 'openInDefaultApp');
      return post(P.buildNotice(r.notice, meta, actions));
    }
    if (r.revisions && document.revMode !== 'final') {
      const alt = await this.loadMode(document, document.revMode);
      if (!this.panels.has(panel)) return;
      if (alt.ok) r = alt;
    }
    if (r.revisions) r = Object.assign({}, r, { revisions: Object.assign({}, r.revisions, { mode: document.revMode }) });
    const shown = note ? Object.assign({}, r, { banner: note.text + (r.banner ? ' ' + r.banner : ''), bannerActions: note.actions.concat(r.bannerActions || []) }) : r;
    for (const m of P.buildRenderMessages(shown, meta)) {
      if (!this.panels.has(panel)) return;
      await post(m);
    }
    if (!counted.has(panel)) { counted.add(panel); rating.success(document.uri); }
  }

  activeDocument() {
    if (this.active && this.panels.has(this.active)) return this.panels.get(this.active);
    for (const [panel, doc] of this.panels) if (panel.visible) return doc;
    return null;
  }
}

function documentFor(uri, provider) {
  for (const d of provider.panels.values()) if (d.uri.toString() === uri.toString()) return d;
  return new DocxDocument(uri);
}

// Converts bytes that are not a file on disk (the committed version from git).
async function convertBytes(bytes, name) {
  const c = cfg();
  const ext = path.extname(name).toLowerCase();
  const format = detectFormat(bytes);
  if (!canConvert(format, ext, bytes)) return { ok: false, notice: noticeFor(format, ext, bytes) || { kind: 'error', title: 'Unknown format', detail: '' } };
  return convertInWorker(bytes, { ext, maxImageBytes: c.maxImageBytes, maxTotalImageBytes: c.maxTotalImageBytes });
}

async function resultFor(uri, provider) {
  const r = await provider.load(documentFor(uri, provider));
  if (!r.ok) {
    vscode.window.showWarningMessage(r.notice.title + '. ' + r.notice.detail);
    return null;
  }
  return r;
}

function targetUri(arg, provider) {
  if (arg instanceof vscode.Uri) return arg;
  const d = provider.activeDocument();
  if (d) return d.uri;
  vscode.window.showInformationMessage('Open a .docx file in DOCX Viewer first.');
  return null;
}

async function openAsText(uri, provider) {
  const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'DOCX Viewer: extracting text' }, () => resultFor(uri, provider));
  if (!r) return;
  const doc = await vscode.workspace.openTextDocument({ content: r.text, language: 'plaintext' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function openAsMarkdown(uri, provider) {
  const r = await resultFor(uri, provider);
  if (!r) return;
  const doc = await vscode.workspace.openTextDocument({ content: r.markdown, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}

async function copyMarkdown(uri, provider) {
  const r = await resultFor(uri, provider);
  if (!r) return;
  await vscode.env.clipboard.writeText(r.markdown);
  const note = r.stats.images ? ' Images are left out; each one is a placeholder link.' : '';
  vscode.window.showInformationMessage('Copied ' + r.stats.words.toLocaleString() + ' words as Markdown.' + note);
}

function activate(context) {
  // Web build: the converter worker is a separate script next to the extension.
  if (runWorker.configure) runWorker.configure({ workerUrl: vscode.Uri.joinPath(context.extensionUri, 'out', 'web', 'worker.js').toString(true) });
  rating = createRatingPrompt({ vscode, context, extensionId: 'zovo.docx-viewer-vscode', section: 'docxViewer', name: 'DOCX Viewer' });
  registerSupport({ vscode, context, prefix: 'docxViewer', selfId: 'zovo.docx-viewer-vscode' });
  const provider = new DocxEditorProvider(context);
  // Zovo Pro (src/pro.js): redline export and folder compare. Local checks only; no network on start.
  const pro = isWeb() ? null : createPro({ vscode, context });
  if (!pro) {
    const later = () => vscode.window.showInformationMessage('Zovo Pro features (redline export, folder compare) need desktop VS Code.');
    for (const c of ['enterLicenseKey', 'getPro', 'removeLicense', 'unlockWithSponsors']) context.subscriptions.push(vscode.commands.registerCommand('docxViewer.' + c, later));
  }
  const redline = isWeb() ? null : createRedline({ vscode, context, rating, pro, cfg });
  registerCompare({
    vscode, context,
    convertUri: (uri) => provider.load(documentFor(uri, provider)),
    convertBytes,
    maxBytes: () => cfg().maxFileBytes,
    activeUri: () => { const d = provider.activeDocument(); return d ? d.uri : null; },
    redline,
    isWeb
  });
  registerFolders({ vscode, context, redline, pro, isWeb });
  const noRedline = () => vscode.window.showInformationMessage('The redline compare needs desktop VS Code.');
  context.subscriptions.push(
    vscode.commands.registerCommand('docxViewer.exportRedlineDocx', () => (redline ? redline.exportActive('docx') : noRedline())),
    vscode.commands.registerCommand('docxViewer.exportRedlineHtml', () => (redline ? redline.exportActive('html') : noRedline()))
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('docxViewer.openAsText', (arg) => { const u = targetUri(arg, provider); if (u) return openAsText(u, provider); }),
    vscode.commands.registerCommand('docxViewer.openAsMarkdown', (arg) => { const u = targetUri(arg, provider); if (u) return openAsMarkdown(u, provider); }),
    vscode.commands.registerCommand('docxViewer.copyAsMarkdown', (arg) => { const u = targetUri(arg, provider); if (u) return copyMarkdown(u, provider); }),
    vscode.commands.registerCommand('docxViewer.openInDefaultApp', (arg) => { const u = targetUri(arg, provider); if (u) return openInDefaultApp(u); }),
    vscode.commands.registerCommand('docxViewer.find', () => {
      const p = provider.active || [...provider.panels.keys()].find((x) => x.visible);
      if (p) p.webview.postMessage({ type: 'find' });
    }),
    vscode.commands.registerCommand('docxViewer.toggleToolbar', () => provider.toggleToolbar()),
    vscode.commands.registerCommand('docxViewer.openSample', () => {
      const uri = vscode.Uri.joinPath(context.extensionUri, 'media', 'sample', 'Q3 Field Report.docx');
      return vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }),
    vscode.commands.registerCommand('docxViewer.openWalkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', 'zovo.docx-viewer-vscode#docxViewer.start', false)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('docxViewer.theme')) {
        for (const p of provider.panels.keys()) p.webview.postMessage({ type: 'theme', theme: cfg().theme });
      }
      if (e.affectsConfiguration('docxViewer.fontFamily')) {
        for (const p of provider.panels.keys()) p.webview.postMessage({ type: 'font', font: fontAttr(cfg().font) });
      }
      if (e.affectsConfiguration('docxViewer.zoom')) {
        for (const p of provider.panels.keys()) p.webview.postMessage({ type: 'zoom', zoom: cfg().zoom });
      }
      if (e.affectsConfiguration('docxViewer.maxImageSizeMB') || e.affectsConfiguration('docxViewer.maxTotalImagesMB') || e.affectsConfiguration('docxViewer.maxFileSizeMB')) {
        for (const [p, d] of provider.panels) { d.invalidate(); provider.render(p, d); }
      }
    })
  );
  return { provider, redline, pro };
}

function deactivate() {}

module.exports = { activate, deactivate, DocxEditorProvider, DocxDocument, convertBytes, NOTES, pageNoteText, isWeb, WEB_NO_APP };
