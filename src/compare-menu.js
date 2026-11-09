'use strict';
// The "Compare" button in the document toolbar and the "DOCX Viewer: Compare..." command (CONV3 fix 5). One quick
// pick: the two free compares first, then the two Zovo Pro tools with their free tries. It is the PDF and SQLite
// pattern: the Pro tools are visible where the user already looks, with no badge, toast or popup on open.
// Pro rules (src/pro.js): check() before any input, commit() only after the output is written, so pressing Escape
// on a picker never uses a try.

// deps: { vscode, pro (null in the web build), compare (registerCompare result), redline (null in the web build),
//         folders (registerFolders result), activeUri, isWeb }
function createCompareMenu(deps) {
  const { vscode, pro, compare, redline, folders } = deps;
  const web = () => !!(deps.isWeb && deps.isWeb());

  // " (Pro, 3 free tries)", " (Pro)", or "" for a Pro user.
  const tag = (f) => { const l = pro ? pro.label(f) : ''; return l ? ' (' + l + ')' : ''; };

  function items() {
    const list = [];
    if (!web()) list.push({ label: '$(git-compare) Compare with Git HEAD', description: 'free', detail: 'Your changes since the last commit, as a redline or a Markdown diff.', id: 'head' });
    list.push({ label: '$(diff) Compare with another document', description: 'free', detail: 'Pick a second Word or OpenDocument file. Redline or Markdown diff.', id: 'other' });
    if (pro && redline && folders && pro.shown()) {
      list.push({ label: 'Zovo Pro', kind: vscode.QuickPickItemKind ? vscode.QuickPickItemKind.Separator : -1 });
      list.push({ label: '$(files) Compare two folders' + tag('compareFolders'), detail: 'Every document in one folder against the file of the same name in another, with one HTML redline per pair.', id: 'folders' });
      list.push({ label: '$(file-symlink-file) Export redline as Word with tracked changes' + tag('exportRedline'), detail: 'A new .docx that Word and LibreOffice can accept or reject change by change.', id: 'export' });
    }
    return list;
  }

  // Export from the menu: the open redline if there is one, else compare this document with another one first.
  async function exportRedline(uri) {
    const open = redline.active && redline.active();
    if (open && open.payload) return redline.host.exportRedline(open, 'docx');
    if (!(await pro.check('exportRedline'))) return;
    const panel = await compare.compareWithOther(uri, null, 'redline');
    if (!panel || !panel.done) return;
    const r = await panel.done;
    if (!r || !r.ok || !panel.payload) return;
    return redline.host.exportRedline(panel, 'docx');
  }

  async function menu(arg) {
    const uri = arg instanceof vscode.Uri ? arg : (deps.activeUri ? deps.activeUri() : null);
    const shownPro = !!(pro && redline && folders && pro.shown());
    const placeHolder = shownPro && !pro.isPro()
      ? 'The 2 Pro tools have 3 free tries each on this computer. Zovo Pro is USD 19 once, for every Zovo viewer.'
      : 'Pick a compare';
    const pick = await vscode.window.showQuickPick(items(), { title: 'Compare this document', placeHolder });
    if (!pick || !pick.id) return;
    if (pick.id === 'head') return compare.compareWithHead(uri);
    if (pick.id === 'other') return compare.compareWithOther(uri);
    if (pick.id === 'folders') return folders.compareFolders();
    if (pick.id === 'export') return exportRedline(uri);
  }

  return { menu, items, exportRedline };
}

module.exports = { createCompareMenu };
