'use strict';
// Self-contained HTML redline: one file, no scripts and no external links. Opens in any
// browser, prints to PDF from the browser's Print dialog, light and dark by the reader's system setting.

const S = require('./style');
const { esc } = require('./render');

const TYPE_LABEL = { ins: 'Inserted', del: 'Deleted', move: 'Moved', cell: 'Table cell', fmt: 'Formatting' };

function build(payload, a, b, opts) {
  const date = (opts && opts.date ? opts.date : new Date().toISOString()).slice(0, 10);
  const body = payload.rows.map((r) => r.i).join('\n').replace(/ data-c="([a-z0-9]+)"/g, ' id="$1" data-c="$1"');
  const list = payload.changes.map((c) => '<li><a href="#' + c.id + '">' + esc(TYPE_LABEL[c.type] || c.type) + '</a>: ' + esc(c.desc ? c.desc + ' (' + c.text + ')' : c.text) + '</li>').join('');
  const more = payload.total > payload.listed ? '<p>' + (payload.total - payload.listed).toLocaleString('en-US') + ' more changes are marked in the text below.</p>' : '';
  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">\n' +
    '<title>Redline: ' + esc(a.name) + ' to ' + esc(b.name) + '</title>\n<style>' + S.EXPORT_VARS + S.MARKS + '</style>\n</head>\n<body>\n<div class="rl-page">\n' +
    '<header class="rl-head"><h1>Redline: ' + esc(a.name) + ' &rarr; ' + esc(b.name) + '</h1>\n' +
    '<p class="rl-meta">Older: ' + esc(a.label || a.name) + ' &middot; Newer: ' + esc(b.label || b.name) + ' &middot; Compared ' + esc(date) + '</p>\n' +
    '<p class="rl-summary">' + esc(payload.summary) + '</p>\n' +
    '<p class="rl-legend"><span><ins class="rl-ins">inserted</ins></span><span><del class="rl-del">deleted</del></span><span class="rl-blk rl-mt" style="display:inline;padding:0 4px;margin:0">moved</span><span class="rl-fmt">formatting</span></p></header>\n' +
    (payload.changes.length ? '<nav class="rl-nav" aria-label="Changes"><ol>' + list + '</ol>' + more + '</nav>\n' : '<p>No differences in the text.</p>\n') +
    '<main class="rl-doc">\n' + body + '\n</main>\n' +
    '<p class="rl-foot">Made with DOCX Viewer for VS Code (free, offline). Pictures show as &#9635;. Existing tracked changes were accepted before the compare.</p>\n' +
    '</div>\n</body>\n</html>\n';
}

module.exports = { build };
