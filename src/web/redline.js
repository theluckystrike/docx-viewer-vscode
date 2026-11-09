'use strict';
// VS Code for the Web stand-in for src/redline/panel.js, src/redline/folders.js and src/pro.js (the web build
// swaps them in). The redline runs in a Node worker thread, so the web build offers the Markdown compare instead.
const MSG = 'The redline compare needs desktop VS Code. In VS Code for the Web, "Compare with Another Document" shows the Markdown diff.';
function createRedline() { return null; }
function registerFolders({ vscode, context }) {
  context.subscriptions.push(vscode.commands.registerCommand('docxViewer.compareFolders', () => vscode.window.showInformationMessage(MSG)));
  return {};
}
function createPro() { return null; }
module.exports = { createRedline, registerFolders, createPro, MSG };
