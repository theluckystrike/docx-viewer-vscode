'use strict';
// Redline styles, shared by the webview (VS Code theme colors) and the HTML export (fixed colors, light and
// dark by prefers-color-scheme). Insertions are underlined, deletions struck through, moves double, formatting
// changes dotted, so the marks read without color too.

const MARKS = `
.rl-doc { line-height: 1.55; overflow-wrap: anywhere; }
.rl-doc p, .rl-doc h1, .rl-doc h2, .rl-doc h3, .rl-doc h4, .rl-doc h5, .rl-doc h6 { margin: 0 0 0.6em; white-space: pre-wrap; }
.rl-doc h1 { font-size: 1.6em; } .rl-doc h2 { font-size: 1.35em; } .rl-doc h3 { font-size: 1.18em; }
.rl-doc h4, .rl-doc h5, .rl-doc h6 { font-size: 1.05em; }
.rl-doc p.rl-li { padding-left: 1.4em; position: relative; }
.rl-doc p.rl-li::before { content: "\\2022"; position: absolute; left: 0.4em; }
.f-b { font-weight: 700; } .f-i { font-style: italic; } .f-u { text-decoration: underline; } .f-s { text-decoration: line-through; }
.f-m { font-family: "Cambria Math", "STIX Two Math", serif; }
.rl-obj { opacity: 0.7; }
ins.rl-ins, .rl-ins ins { text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 2px; background: var(--rl-ins-bg); color: var(--rl-ins-fg); }
del.rl-del { text-decoration: line-through; text-decoration-thickness: 2px; background: var(--rl-del-bg); color: var(--rl-del-fg); }
.rl-blk { border-left: 3px solid transparent; padding-left: 8px; margin-left: -11px; }
.rl-blk.rl-ins { border-left-color: var(--rl-ins-fg); background: var(--rl-ins-bg); }
.rl-blk.rl-ins p, .rl-blk.rl-ins h1, .rl-blk.rl-ins h2, .rl-blk.rl-ins h3, .rl-blk.rl-ins td { text-decoration: underline; text-decoration-thickness: 2px; color: var(--rl-ins-fg); }
.rl-blk.rl-del { border-left-color: var(--rl-del-fg); background: var(--rl-del-bg); }
.rl-blk.rl-del p, .rl-blk.rl-del h1, .rl-blk.rl-del h2, .rl-blk.rl-del h3, .rl-blk.rl-del td { text-decoration: line-through; text-decoration-thickness: 2px; color: var(--rl-del-fg); }
.rl-blk.rl-mf { border-left: 3px double var(--rl-move); background: var(--rl-move-bg); }
.rl-blk.rl-mf p, .rl-blk.rl-mf h1, .rl-blk.rl-mf h2, .rl-blk.rl-mf h3 { text-decoration: line-through double; color: var(--rl-move); }
.rl-blk.rl-mt { border-left: 3px double var(--rl-move); background: var(--rl-move-bg); }
.rl-blk.rl-mt p, .rl-blk.rl-mt h1, .rl-blk.rl-mt h2, .rl-blk.rl-mt h3 { text-decoration: underline double; color: var(--rl-move); }
.rl-tag { display: inline-block; font-size: 0.75em; font-weight: 600; color: var(--rl-move); margin-bottom: 2px; }
.rl-fmt { text-decoration: underline dotted; text-decoration-color: var(--rl-fmt); text-decoration-thickness: 2px; background: var(--rl-fmt-bg); }
.rl-pfmt { outline: 1px dotted var(--rl-fmt); outline-offset: 2px; }
body.rl-nofmt .rl-fmt { text-decoration: none; background: none; }
body.rl-nofmt .rl-pfmt { outline: none; }
table.rl-tbl { border-collapse: collapse; margin: 0 0 0.8em; max-width: 100%; }
table.rl-tbl td { border: 1px solid var(--rl-border); padding: 4px 8px; vertical-align: top; }
table.rl-tbl td p { margin: 0 0 0.3em; }
tr.rl-tr-ins td { background: var(--rl-ins-bg); text-decoration: underline; color: var(--rl-ins-fg); }
tr.rl-tr-del td { background: var(--rl-del-bg); text-decoration: line-through; color: var(--rl-del-fg); }
td.rl-cell { outline: 2px solid var(--rl-cell); outline-offset: -2px; }
.rl-current { box-shadow: 0 0 0 2px var(--rl-current); border-radius: 2px; }
`;

const EXPORT_VARS = `
:root { --rl-ins-fg: #0b6b2e; --rl-ins-bg: #e3f6e8; --rl-del-fg: #b3261e; --rl-del-bg: #fde7e5; --rl-move: #6a3db8; --rl-move-bg: #f1ebfb;
  --rl-fmt: #9a6700; --rl-fmt-bg: #fff6d6; --rl-cell: #d29922; --rl-border: #c9ced6; --rl-current: #0b57d0; --bg: #ffffff; --fg: #1f2328; --muted: #57606a; }
@media (prefers-color-scheme: dark) { :root { --rl-ins-fg: #7ee2a0; --rl-ins-bg: rgba(46,160,67,0.18); --rl-del-fg: #ff8a80; --rl-del-bg: rgba(248,81,73,0.16);
  --rl-move: #c3a6ff; --rl-move-bg: rgba(137,87,229,0.18); --rl-fmt: #e3b341; --rl-fmt-bg: rgba(187,128,9,0.15); --rl-cell: #d29922; --rl-border: #444c56;
  --rl-current: #4daafc; --bg: #0d1117; --fg: #e6edf3; --muted: #8b949e; } }
@media print { :root { --bg: #ffffff; --fg: #000000; } .rl-nav { display: none; } }
body { background: var(--bg); color: var(--fg); font: 15px/1.55 Calibri, Carlito, "Segoe UI", Arial, sans-serif; margin: 0; }
.rl-page { max-width: 860px; margin: 0 auto; padding: 32px 28px 64px; }
.rl-head h1 { font-size: 1.4em; margin: 0 0 4px; }
.rl-meta { color: var(--muted); margin: 0 0 4px; }
.rl-summary { font-weight: 600; margin: 8px 0 16px; }
.rl-legend span { margin-right: 14px; }
.rl-nav { border: 1px solid var(--rl-border); border-radius: 6px; padding: 8px 12px; margin: 16px 0 24px; max-height: 320px; overflow: auto; font-size: 0.9em; }
.rl-nav ol { margin: 0; padding-left: 1.6em; }
.rl-nav a { color: inherit; }
.rl-foot { color: var(--muted); font-size: 0.85em; margin-top: 40px; border-top: 1px solid var(--rl-border); padding-top: 8px; }
`;

const WEBVIEW_VARS = `
:root { --rl-ins-fg: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); --rl-ins-bg: var(--vscode-diffEditor-insertedTextBackground, rgba(46,160,67,0.2));
  --rl-del-fg: var(--vscode-gitDecoration-deletedResourceForeground, #f85149); --rl-del-bg: var(--vscode-diffEditor-removedTextBackground, rgba(248,81,73,0.2));
  --rl-move: var(--vscode-charts-purple, #b180d7); --rl-move-bg: rgba(137,87,229,0.14); --rl-fmt: var(--vscode-editorWarning-foreground, #cca700);
  --rl-fmt-bg: rgba(187,128,9,0.12); --rl-cell: var(--vscode-editorWarning-foreground, #cca700); --rl-border: var(--vscode-editorWidget-border, #454545);
  --rl-current: var(--vscode-focusBorder, #007fd4); }
body[data-theme="light"] .rl-paper { --rl-ins-fg: #0b6b2e; --rl-ins-bg: #e3f6e8; --rl-del-fg: #b3261e; --rl-del-bg: #fde7e5; --rl-move: #6a3db8; --rl-move-bg: #f1ebfb;
  --rl-fmt: #9a6700; --rl-fmt-bg: #fff6d6; --rl-border: #c9ced6; background: #ffffff; color: #1f2328; }
body[data-theme="dark"] .rl-paper { background: #1e1e1e; color: #d4d4d4; }
`;

module.exports = { MARKS, EXPORT_VARS, WEBVIEW_VARS };
