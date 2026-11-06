// Runs inside a real VS Code extension host (extensionTestsPath).
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const out = process.env.DV_SMOKE_OUT;
const P = process.env.DV_FIXTURES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.run = async function () {
  const log = [];
  const check = (name, ok, extra) => log.push((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : ''));
  try {
    const ext = vscode.extensions.getExtension('zovo.docx-viewer-vscode');
    check('extension found', !!ext);
    const uri = vscode.Uri.file(path.join(P, 'sample.docx'));
    await vscode.commands.executeCommand('vscode.open', uri);
    await sleep(2500);
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    check('default editor for .docx is docxViewer.preview', tab && tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'docxViewer.preview', tab && tab.label);
    check('extension active', ext.isActive);
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('docxViewer.copyAsMarkdown');
    await sleep(500);
    const md = await vscode.env.clipboard.readText();
    check('copy as markdown', md.startsWith('# Q3 2026 Field Report') && md.includes('| North | $9.8M |'), md.slice(0, 60).replace(/\n/g, '\\n'));
    await vscode.commands.executeCommand('docxViewer.openAsText');
    await sleep(800);
    const ed = vscode.window.activeTextEditor;
    check('open as text', ed && ed.document.isUntitled && ed.document.getText().includes('Revenue by region'), ed && ed.document.languageId);
    await vscode.commands.executeCommand('docxViewer.openAsText', vscode.Uri.file(path.join(P, 'sample.dotx')));
    await sleep(800);
    check('open as text from explorer uri (.dotx)', vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.getText().startsWith('Q3 2026 Field Report'));
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path.join(P, 'legacy.doc')));
    await sleep(1500);
    const t2 = vscode.window.tabGroups.activeTabGroup.activeTab;
    check('.doc opens in docxViewer (notice)', t2 && t2.input instanceof vscode.TabInputCustom && t2.input.viewType === 'docxViewer.preview', t2 && t2.label);
    await vscode.commands.executeCommand('docxViewer.find');
    check('find command runs', true);
  } catch (e) {
    log.push('FAIL exception :: ' + (e && e.stack || e));
  }
  fs.writeFileSync(out, log.join('\n') + '\n');
};
