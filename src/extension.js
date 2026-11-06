'use strict';
const vscode = require('vscode');
const path = require('path');
const { convertInWorker } = require('./run-worker');
const { noticeFor, detectFormat } = require('./detect');
const { buildWebviewHtml } = require('./webview-html');
const P = require('../media/protocol');

const VIEW_TYPE = 'docxViewer.preview';
const MB = 1024 * 1024;

function cfg() {
  const c = vscode.workspace.getConfiguration('docxViewer');
  const num = (k, d, min) => { const v = Number(c.get(k, d)); return Number.isFinite(v) && v >= min ? v : d; };
  return {
    maxFileBytes: num('maxFileSizeMB', 50, 1) * MB,
    maxImageBytes: num('maxImageSizeMB', 5, 0.1) * MB,
    maxTotalImageBytes: num('maxTotalImagesMB', 40, 1) * MB,
    theme: P.THEMES.includes(c.get('theme')) ? c.get('theme') : 'auto'
  };
}

class DocxDocument {
  constructor(uri) {
    this.uri = uri;
    this.result = null; // { ok, ... } from the converter
    this.pending = null;
    this.allowLarge = false;
    this.version = 0;
  }
  invalidate() { this.result = null; this.pending = null; this.version++; }
  dispose() { this.result = null; this.pending = null; }
}

class DocxEditorProvider {
  constructor(context) {
    this.context = context;
    this.panels = new Map(); // panel -> document
    this.active = null;
  }

  async openCustomDocument(uri) {
    return new DocxDocument(uri);
  }

  async resolveCustomEditor(document, panel) {
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, enableCommandUris: false, localResourceRoots: [media] };
    const u = (f) => panel.webview.asWebviewUri(vscode.Uri.joinPath(media, f)).toString();
    panel.webview.html = buildWebviewHtml({
      cspSource: panel.webview.cspSource,
      theme: cfg().theme,
      uris: { css: u('viewer.css'), protocol: u('protocol.js'), search: u('search.js'), viewer: u('viewer.js') }
    });
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
    switch (m.name) {
      case 'openAsText': return openAsText(document.uri, this);
      case 'copyMarkdown': return copyMarkdown(document.uri, this);
      case 'openInDefaultApp': return vscode.env.openExternal(document.uri);
      case 'openSettings': return vscode.commands.executeCommand('workbench.action.openSettings', 'docxViewer.maxFileSizeMB');
      case 'openAnyway': document.allowLarge = true; document.invalidate(); return this.render(panel, document);
      case 'reload': document.invalidate(); return this.render(panel, document);
    }
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
      if (format !== 'zip') return { ok: false, size, notice: noticeFor(format, ext) };
      const r = await convertInWorker(bytes, { ext, maxImageBytes: c.maxImageBytes, maxTotalImageBytes: c.maxTotalImageBytes });
      r.size = size;
      return r;
    })();
    const r = await document.pending;
    if (document.version === version) { document.result = r; document.pending = null; }
    return r;
  }

  async render(panel, document) {
    const post = (m) => panel.webview.postMessage(m);
    let r;
    try {
      r = await this.load(document);
    } catch (err) {
      r = { ok: false, notice: { kind: 'error', title: 'DOCX Viewer could not read this file', detail: String((err && err.message) || err) } };
    }
    if (!this.panels.has(panel)) return;
    const meta = this.meta(document, r.size);
    if (!r.ok) {
      const actions = r.tooLarge ? ['openAnyway', 'openInDefaultApp', 'openSettings'] : r.notice.kind === 'error' ? ['reload', 'openInDefaultApp'] : ['openInDefaultApp'];
      return post(P.buildNotice(r.notice, meta, actions));
    }
    for (const m of P.buildRenderMessages(r, meta)) {
      if (!this.panels.has(panel)) return;
      await post(m);
    }
  }

  activeDocument() {
    if (this.active && this.panels.has(this.active)) return this.panels.get(this.active);
    for (const [panel, doc] of this.panels) if (panel.visible) return doc;
    return null;
  }
}

async function resultFor(uri, provider) {
  let document = null;
  for (const d of provider.panels.values()) if (d.uri.toString() === uri.toString()) { document = d; break; }
  const r = await provider.load(document || new DocxDocument(uri));
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
  const provider = new DocxEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: false }
    }),
    vscode.commands.registerCommand('docxViewer.openAsText', (arg) => { const u = targetUri(arg, provider); if (u) return openAsText(u, provider); }),
    vscode.commands.registerCommand('docxViewer.openAsMarkdown', (arg) => { const u = targetUri(arg, provider); if (u) return openAsMarkdown(u, provider); }),
    vscode.commands.registerCommand('docxViewer.copyAsMarkdown', (arg) => { const u = targetUri(arg, provider); if (u) return copyMarkdown(u, provider); }),
    vscode.commands.registerCommand('docxViewer.openInDefaultApp', (arg) => { const u = targetUri(arg, provider); if (u) return vscode.env.openExternal(u); }),
    vscode.commands.registerCommand('docxViewer.find', () => {
      const p = provider.active || [...provider.panels.keys()].find((x) => x.visible);
      if (p) p.webview.postMessage({ type: 'find' });
    }),
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
      if (e.affectsConfiguration('docxViewer.maxImageSizeMB') || e.affectsConfiguration('docxViewer.maxTotalImagesMB') || e.affectsConfiguration('docxViewer.maxFileSizeMB')) {
        for (const [p, d] of provider.panels) { d.invalidate(); provider.render(p, d); }
      }
    })
  );
  return { provider };
}

function deactivate() {}

module.exports = { activate, deactivate, DocxEditorProvider, DocxDocument };
