'use strict';
// DOCX Viewer Pro on top of the shared Zovo license module (src/license, copied unchanged from
// factory/sprint/license). Pro features: exporting a redline (tracked-changes .docx, HTML) and comparing two
// folders of documents. Everything else stays free, including the on-screen redline with its change list.
// Rules: nothing about Pro shows on open; each Pro feature works TRIAL_USES times on this computer first (a try is
// used only when the output was really written: check() before the inputs, commit() after the output); after
// that a click explains it once (a modal the user started) with the ways to unlock. No network except what the
// user starts (the GitHub Sponsors unlock, or a page opened in the browser).
// PRO_ENABLED = false makes every feature free and hides nothing; the unlock commands then only say so.
const { createLicense } = require('./license');

const PRO_ENABLED = true;
const SKU = 'docx-pro';
const TRIAL_USES = 3;
const TRIAL_KEY = 'docxViewer.proTrial';

const FEATURES = {
  exportRedline: {
    title: 'Redline export',
    detail: 'Saves the compare as a new Word document with real tracked changes (insertions, deletions, moves, table rows and formatting) that Word and LibreOffice can accept or reject one by one, or as one self-contained HTML file that prints to PDF. Your two documents are never changed.'
  },
  compareFolders: {
    title: 'Folder compare',
    detail: 'Compares every Word and OpenDocument file in one folder with the file of the same name in another folder, lists the changes per pair, opens any pair as a redline and saves all redlines as HTML in one step.'
  }
};

// The facade (src/license) adds the "How to buy" paragraph: the USD 19 tier on GitHub Sponsors, PayPal USD 19 or
// USD 59 for a team of 5 (CONV2).
const PRICE_LINE = 'Zovo Pro is USD 19 once, for life, and unlocks the Pro features in every Zovo viewer. Unlock with GitHub Sponsors asks GitHub one question and sends nothing else.';
const FREE_LINE = 'Everything else in DOCX Viewer stays free: Reading and Page view, search, tracked changes, Copy as Markdown, the Markdown compare and the on-screen redline with its change list.';

function createPro({ vscode, context, license, enabled }) {
  const on = enabled === undefined ? PRO_ENABLED : enabled;
  const lic = license || createLicense({ vscode, context, sku: SKU, name: 'Zovo', product: 'DOCX Viewer', commandPrefix: 'docxViewer' });
  const used = (f) => Number((context.globalState.get(TRIAL_KEY) || {})[f]) || 0;
  const left = (f) => (FEATURES[f] ? Math.max(0, TRIAL_USES - used(f)) : 0);

  const pro = () => !on || lic.isPro(SKU);

  async function explain(f) {
    const ft = FEATURES[f];
    const tried = used(f) >= TRIAL_USES ? 'You have used the ' + TRIAL_USES + ' free tries of this feature on this computer.\n\n' : '';
    return lic.requirePro(ft.title, tried + ft.detail + '\n\n' + PRICE_LINE + '\n\n' + FREE_LINE);
  }

  // Call when the user has chosen a Pro action, before asking for its inputs. True when it may run: Pro, or free
  // tries left. It uses no try. With no tries left it shows the one explaining modal (user-started) and returns the
  // unlock result.
  async function check(f) {
    if (pro()) { if (on) lic.refresh(); return true; }
    if (left(f) > 0) return true;
    return explain(f);
  }

  // Call after the action wrote its output (the folder report, the saved redline). Uses one free try when the user
  // is not Pro. A cancelled picker or save dialog never gets here, so it costs nothing (CONV3 fix 5).
  async function commit(f) {
    if (pro() || !FEATURES[f]) return;
    const m = Object.assign({}, context.globalState.get(TRIAL_KEY) || {});
    m[f] = used(f) + 1;
    await context.globalState.update(TRIAL_KEY, m);
    vscode.window.setStatusBarMessage('DOCX Viewer: free try of ' + FEATURES[f].title.toLowerCase() + ' used, ' + left(f) + ' left on this computer.', 6000);
  }

  // docxViewer.showProFeatures = false hides the Pro buttons and commands (the "do not show again" for Pro).
  const shown = () => pro() || vscode.workspace.getConfiguration('docxViewer').get('showProFeatures', true) !== false;

  return {
    enabled: on,
    shown,
    ready: lic.ready,
    check,
    commit,
    left,
    isPro: pro,
    label: (f) => (pro() ? '' : left(f) > 0 ? 'Pro, ' + left(f) + ' free ' + (left(f) === 1 ? 'try' : 'tries') : 'Pro'),
    onDidChange: (fn) => lic.onDidChange(fn),
    license: lic
  };
}

module.exports = { createPro, FEATURES, SKU, TRIAL_USES, TRIAL_KEY, PRO_ENABLED, PRICE_LINE };
