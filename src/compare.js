'use strict';
// "Compare with Git HEAD" and "Compare with another document": both documents are converted to
// Markdown and shown in VS Code's own diff editor, so changed words, rows and headings are marked.
// The read side is a read-only text provider. Nothing leaves the machine; git runs locally.

const path = require('path');
const { execFile } = require('child_process');

const SCHEME = 'docx-viewer-diff';
const DOC_EXT = /\.(docx|dotx|docm|odt|ott|doc|dot)$/i;

// Keeps the Markdown for the diff editor. Bounded, so long sessions do not grow forever.
class DiffStore {
  constructor(max) { this.max = max || 40; this.map = new Map(); this.seq = 0; }
  put(text) {
    const key = String(++this.seq);
    this.map.set(key, text);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return key;
  }
  get(key) { return this.map.has(key) ? this.map.get(key) : null; }
}

// Path of the virtual Markdown file. The label shows in the diff tab, ".md" gives Markdown colors.
function diffPath(label, fileName) {
  const safe = (s) => String(s).replace(/[\\/:*?"<>|#?%]/g, '_').slice(0, 120);
  return '/' + safe(label) + '/' + safe(fileName) + '.md';
}

function diffTitle(leftName, leftLabel, rightName, rightLabel) {
  if (leftName === rightName) return rightName + ' (' + leftLabel + ' ↔ ' + rightLabel + ', as Markdown)';
  return leftName + ' ↔ ' + rightName + ' (as Markdown)';
}

function isDocument(p) { return DOC_EXT.test(p || ''); }

// Runs git without a shell. Repository hooks and fsmonitor commands are switched off, so opening a
// diff never runs code from the repository config. Returns { ok, stdout (Buffer) } or { ok: false, error }.
function runGit(args, cwd, maxBuffer, exec) {
  const run = exec || execFile;
  return new Promise((resolve) => {
    run('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'buffer', maxBuffer, timeout: 20000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr && stderr.length ? stderr.toString('utf8') : String(err.message || err)).trim();
        return resolve({ ok: false, code: err.code, error: msg.slice(0, 400) });
      }
      resolve({ ok: true, stdout });
    });
  });
}

// Reads the committed version of a file. Errors are turned into a short sentence for the user.
async function readFromHead(fsPath, maxBytes, exec) {
  const dir = path.dirname(fsPath);
  const base = path.basename(fsPath);
  // cat-file prints the stored bytes and runs no textconv or smudge filter.
  const r = await runGit(['cat-file', 'blob', 'HEAD:./' + base], dir, Math.max(maxBytes, 1024 * 1024), exec);
  if (r.ok) return { ok: true, bytes: r.stdout };
  const e = r.error || '';
  if (r.code === 'ENOENT') return { ok: false, message: 'Git is not installed or not on the PATH.' };
  if (/not a git repository/i.test(e)) return { ok: false, message: 'This file is not in a Git repository.' };
  if (/exists on disk, but not in|does not exist in|not a valid object name|invalid object name|bad revision|unknown revision/i.test(e)) return { ok: false, message: 'This file has no committed version yet (it is new or the repository has no commits).' };
  if (/maxBuffer/i.test(e) || r.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ok: false, message: 'The committed version is larger than the docxViewer.maxFileSizeMB limit.' };
  return { ok: false, message: 'Git could not read the committed version: ' + e };
}

// Registers the provider and the two commands. convertUri(uri) and convertBytes(bytes, name) return the
// converter result ({ ok, markdown } or { ok: false, notice }).
function registerCompare({ vscode, context, convertUri, convertBytes, maxBytes, activeUri, exec }) {
  const store = new DiffStore();
  const emitter = new vscode.EventEmitter();
  context.subscriptions.push(
    emitter,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      onDidChange: emitter.event,
      provideTextDocumentContent: (uri) => {
        const v = store.get(uri.query);
        return v === null ? '(This comparison is closed. Run the compare command again.)' : v;
      }
    })
  );
  const virtualUri = (label, fileName, text) => vscode.Uri.from({ scheme: SCHEME, path: diffPath(label, fileName), query: store.put(text) });

  async function markdownOf(result, what) {
    if (result && result.ok) return result.markdown;
    const n = result && result.notice;
    vscode.window.showWarningMessage('DOCX Viewer could not compare: ' + what + ' did not open. ' + (n ? n.title + '.' : ''));
    return null;
  }

  async function showDiff(left, right) {
    const title = diffTitle(left.name, left.label, right.name, right.label);
    await vscode.commands.executeCommand('vscode.diff', virtualUri(left.label, left.name, left.md), virtualUri(right.label, right.name, right.md), title, { preview: false });
  }

  async function compareWithHead(arg) {
    const uri = arg instanceof vscode.Uri ? arg : (arg && arg.resourceUri instanceof vscode.Uri ? arg.resourceUri : activeUri());
    if (!uri) return vscode.window.showInformationMessage('Open a Word or OpenDocument file first, or right-click one in the Explorer.');
    if (uri.scheme !== 'file') return vscode.window.showInformationMessage('Compare with Git HEAD works on files on this computer only.');
    if (!vscode.workspace.isTrusted) return vscode.window.showInformationMessage('Compare with Git HEAD runs git, so it needs a trusted workspace. Trust this folder first, or use "Compare with Another Document".');
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DOCX Viewer: comparing with Git HEAD' }, async () => {
      const head = await readFromHead(uri.fsPath, maxBytes(), exec);
      if (!head.ok) return vscode.window.showWarningMessage('DOCX Viewer: ' + head.message);
      const name = path.basename(uri.fsPath);
      const leftMd = await markdownOf(await convertBytes(head.bytes, name), 'the committed version');
      if (leftMd === null) return;
      const rightMd = await markdownOf(await convertUri(uri), 'the file on disk');
      if (rightMd === null) return;
      if (leftMd === rightMd) vscode.window.showInformationMessage('DOCX Viewer: the text of ' + name + ' is the same as in HEAD. Only formatting or images may differ.');
      await showDiff({ name, label: 'HEAD', md: leftMd }, { name, label: 'Working Tree', md: rightMd });
    });
  }

  async function compareWithOther(arg, selected) {
    let a = arg instanceof vscode.Uri ? arg : activeUri();
    let b = null;
    if (Array.isArray(selected)) {
      const docs = selected.filter((u) => u instanceof vscode.Uri && isDocument(u.path));
      if (docs.length === 2) { a = docs[0]; b = docs[1]; }
    }
    if (!a) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Compare', title: 'Pick the first document', filters: { 'Word and OpenDocument': ['docx', 'dotx', 'docm', 'odt', 'ott'] } });
      if (!picked || !picked[0]) return;
      a = picked[0];
    }
    if (!b) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Compare', title: 'Compare ' + path.basename(a.path) + ' with', defaultUri: vscode.Uri.joinPath(a, '..'), filters: { 'Word and OpenDocument': ['docx', 'dotx', 'docm', 'odt', 'ott'] } });
      if (!picked || !picked[0]) return;
      b = picked[0];
    }
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'DOCX Viewer: comparing documents' }, async () => {
      const leftMd = await markdownOf(await convertUri(a), path.basename(a.path));
      if (leftMd === null) return;
      const rightMd = await markdownOf(await convertUri(b), path.basename(b.path));
      if (rightMd === null) return;
      const an = path.basename(a.path);
      const bn = path.basename(b.path);
      await showDiff({ name: an, label: an === bn ? 'first' : 'A', md: leftMd }, { name: bn, label: an === bn ? 'second' : 'B', md: rightMd });
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('docxViewer.compareWithHead', compareWithHead),
    vscode.commands.registerCommand('docxViewer.compareWithDocument', compareWithOther)
  );
  return { compareWithHead, compareWithOther, store };
}

module.exports = { registerCompare, readFromHead, runGit, DiffStore, diffPath, diffTitle, isDocument, SCHEME };
