'use strict';
// "Compare Two Folders of Documents (Redline)" (Pro): pairs files by relative path, runs one redline per pair in
// the worker, saves one HTML redline per changed pair plus an index.html, and offers to open any pair in the
// redline view. Files are read one pair at a time.
const path = require('path');
const { runRedline } = require('./run');
const { esc } = require('./render');
const S = require('./style');

const DOC_EXT = /\.(docx|dotx|docm|odt|ott|doc|dot)$/i;
const MAX_FILES = 2000;
const MAX_DEPTH = 8;

async function listDocs(vscode, root) {
  const out = new Map();
  const walk = async (dir, rel, depth) => {
    if (depth > MAX_DEPTH || out.size >= MAX_FILES) return;
    let entries;
    try { entries = await vscode.workspace.fs.readDirectory(dir); } catch (_) { return; }
    for (const [name, type] of entries) {
      if (name.startsWith('~$') || name.startsWith('.')) continue; // Word lock files, hidden folders
      const r = rel ? rel + '/' + name : name;
      if (type & vscode.FileType.Directory) { if (!/^(node_modules|\.git)$/.test(name)) await walk(vscode.Uri.joinPath(dir, name), r, depth + 1); } else if (DOC_EXT.test(name)) out.set(r.toLowerCase(), { rel: r, uri: vscode.Uri.joinPath(dir, name) });
      if (out.size >= MAX_FILES) return;
    }
  };
  await walk(root, '', 0);
  return out;
}

function pairsOf(older, newer) {
  const pairs = [];
  const onlyOld = [];
  const onlyNew = [];
  for (const [k, v] of older) { if (newer.has(k)) pairs.push({ rel: newer.get(k).rel, a: v.uri, b: newer.get(k).uri }); else onlyOld.push(v.rel); }
  for (const [k, v] of newer) if (!older.has(k)) onlyNew.push(v.rel);
  pairs.sort((x, y) => x.rel.localeCompare(y.rel));
  return { pairs, onlyOld: onlyOld.sort(), onlyNew: onlyNew.sort() };
}

function indexHtml(rows, info) {
  const tr = rows.map((r) => '<tr><td>' + (r.file ? '<a href="' + esc(encodeURI(r.file)) + '">' + esc(r.rel) + '</a>' : esc(r.rel)) + '</td><td>' + esc(r.status) + '</td></tr>').join('');
  const list = (title, l) => (l.length ? '<h2>' + esc(title) + ' (' + l.length + ')</h2><ul>' + l.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '');
  return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' +
    '<title>Folder redline</title><style>' + S.EXPORT_VARS + 'table{border-collapse:collapse;width:100%}td,th{border:1px solid var(--rl-border);padding:4px 8px;text-align:left}a{color:inherit}</style></head><body><div class="rl-page">' +
    '<h1>Folder redline</h1><p class="rl-meta">Older: ' + esc(info.older) + '<br>Newer: ' + esc(info.newer) + '<br>Compared ' + esc(info.date) + '</p>' +
    '<p class="rl-summary">' + esc(info.summary) + '</p><table><thead><tr><th>Document</th><th>Changes</th></tr></thead><tbody>' + tr + '</tbody></table>' +
    list('Only in the older folder', info.onlyOld) + list('Only in the newer folder', info.onlyNew) +
    '<p class="rl-foot">Made with DOCX Viewer for VS Code (free, offline).</p></div></body></html>\n';
}

function registerFolders({ vscode, context, redline, pro, isWeb }) {
  async function pickFolder(title, label, def) {
    const r = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, title, openLabel: label, defaultUri: def });
    return r && r[0];
  }

  async function compareFolders(arg) {
    if (isWeb && isWeb()) return vscode.window.showInformationMessage('Folder compare needs desktop VS Code.');
    if (pro && !(await pro.check('compareFolders'))) return;
    const older = arg instanceof vscode.Uri ? arg : await pickFolder('Pick the folder with the OLDER documents', 'Older Folder');
    if (!older) return;
    const newer = await pickFolder('Pick the folder with the NEWER documents', 'Newer Folder', vscode.Uri.joinPath(older, '..'));
    if (!newer) return;
    if (older.toString() === newer.toString()) return vscode.window.showWarningMessage('Pick two different folders.');
    const [lo, ln] = await Promise.all([listDocs(vscode, older), listDocs(vscode, newer)]);
    const { pairs, onlyOld, onlyNew } = pairsOf(lo, ln);
    if (!pairs.length) return vscode.window.showInformationMessage('No documents with the same name in both folders (' + lo.size + ' older, ' + ln.size + ' newer).');
    const outDir = await pickFolder('Save the HTML redlines and index.html in', 'Save Here', vscode.Uri.joinPath(newer, '..'));
    if (!outDir) return;
    const date = new Date().toISOString().slice(0, 10);
    const results = [];
    const maxBytes = (vscode.workspace.getConfiguration('docxViewer').get('maxFileSizeMB', 100) || 100) * 1024 * 1024;
    const cancelled = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DOCX Viewer: comparing folders', cancellable: true }, async (progress, token) => {
      for (let i = 0; i < pairs.length; i++) {
        if (token.isCancellationRequested) return true;
        const p = pairs[i];
        progress.report({ message: (i + 1) + ' of ' + pairs.length + ': ' + p.rel, increment: 100 / pairs.length });
        try {
          const [sa, sb] = await Promise.all([vscode.workspace.fs.stat(p.a), vscode.workspace.fs.stat(p.b)]);
          if (sa.size > maxBytes || sb.size > maxBytes) { results.push({ rel: p.rel, status: 'skipped: over the docxViewer.maxFileSizeMB limit', pair: p }); continue; }
          const [ba, bb] = await Promise.all([vscode.workspace.fs.readFile(p.a), vscode.workspace.fs.readFile(p.b)]);
          const name = path.basename(p.rel);
          const r = await runRedline({ task: 'html', a: { bytes: ba, name, label: 'older' }, b: { bytes: bb, name, label: 'newer' }, opts: { formatting: vscode.workspace.getConfiguration('docxViewer').get('redlineFormatting', true) !== false, date } }, { token });
          if (r.cancelled) return true;
          if (!r.ok) { results.push({ rel: p.rel, status: 'could not compare: ' + ((r.notice && r.notice.title) || 'error'), pair: p }); continue; }
          if (!r.total) { results.push({ rel: p.rel, status: 'no differences in the text', pair: p }); continue; }
          const file = p.rel.replace(/[\\/]/g, ' - ').replace(/\.[^.]+$/, '') + ' redline.html';
          await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(outDir, file), new TextEncoder().encode(r.html));
          results.push({ rel: p.rel, status: r.summary, file, pair: p });
        } catch (err) {
          results.push({ rel: p.rel, status: 'could not compare: ' + String((err && err.message) || err).slice(0, 120), pair: p });
        }
      }
      return false;
    });
    const changed = results.filter((r) => r.file).length;
    const summary = results.length + ' pairs compared: ' + changed + ' changed, ' + (results.length - changed) + ' without text changes or skipped. ' + onlyOld.length + ' only in the older folder, ' + onlyNew.length + ' only in the newer folder.' + (cancelled ? ' Stopped early.' : '');
    const index = vscode.Uri.joinPath(outDir, 'index.html');
    await vscode.workspace.fs.writeFile(index, new TextEncoder().encode(indexHtml(results, { older: older.fsPath || older.path, newer: newer.fsPath || newer.path, date, summary, onlyOld, onlyNew })));
    // The report is on disk: only now does the run use a free try (a cancelled picker costs nothing).
    if (pro) await pro.commit('compareFolders');
    const pick = await vscode.window.showInformationMessage(summary, 'Open a Pair', 'Open index.html', 'Reveal Folder');
    if (pick === 'Open index.html') await vscode.env.openExternal(index);
    else if (pick === 'Reveal Folder') await vscode.commands.executeCommand('revealFileInOS', index);
    else if (pick === 'Open a Pair') {
      const item = await vscode.window.showQuickPick(results.map((r) => ({ label: r.rel, description: r.status, r })), { title: 'Open a pair as a redline', matchOnDescription: true });
      if (item) await redline.open({ uri: item.r.pair.a, name: path.basename(item.r.rel), label: 'older' }, { uri: item.r.pair.b, name: path.basename(item.r.rel), label: 'newer' });
    }
    return { results, onlyOld, onlyNew, index };
  }

  context.subscriptions.push(vscode.commands.registerCommand('docxViewer.compareFolders', compareFolders));
  return { compareFolders, listDocs, pairsOf };
}

module.exports = { registerFolders, pairsOf, indexHtml };
