// Renders the real webview shell (src/webview-html.js + media/*) with the real
// conversion of test/fixtures/sample.docx in headless Chrome and saves PNGs to images/.
// VS Code theme colors are supplied as the same --vscode-* CSS variables VS Code injects.
// Usage: node scripts/screenshot.js <cdp-port>   (start Chrome first with ~/bin/agent-chrome)
const fs = require('fs');
const path = require('path');
const os = require('os');
const { convertDocx } = require('../src/convert');
const { noticeFor } = require('../src/detect');
const { buildWebviewHtml } = require('../src/webview-html');
const P = require('../media/protocol');

const root = path.join(__dirname, '..');
const port = Number(process.argv[2] || 9361);
const work = path.join(os.homedir(), 'docx-viewer-vscode-work', 'shot');
fs.mkdirSync(work, { recursive: true });

const DARK = {
  'editor-background': '#1f1f1f', 'editor-foreground': '#cccccc', descriptionForeground: '#9d9d9d', 'panel-border': '#2b2b2b',
  'textLink-foreground': '#4daafc', 'editor-findMatchHighlightBackground': 'rgba(234, 92, 0, 0.33)', 'editor-findMatchBackground': '#9e6a03',
  'editorWidget-background': '#202020', 'editorWidget-border': '#313131', 'button-background': '#0078d4', 'button-foreground': '#ffffff',
  'button-secondaryBackground': '#313131', 'button-secondaryForeground': '#cccccc', 'input-background': '#313131', 'input-border': '#3c3c3c',
  'input-foreground': '#cccccc', 'sideBar-background': '#181818', 'list-hoverBackground': '#2a2d2e', focusBorder: '#0078d4'
};
const LIGHT = {
  'editor-background': '#ffffff', 'editor-foreground': '#3b3b3b', descriptionForeground: '#6f6f6f', 'panel-border': '#e5e5e5',
  'textLink-foreground': '#005fb8', 'editor-findMatchHighlightBackground': 'rgba(234, 92, 0, 0.25)', 'editor-findMatchBackground': '#f5c26b',
  'editorWidget-background': '#f8f8f8', 'editorWidget-border': '#e5e5e5', 'button-background': '#005fb8', 'button-foreground': '#ffffff',
  'button-secondaryBackground': '#e5e5e5', 'button-secondaryForeground': '#3b3b3b', 'input-background': '#ffffff', 'input-border': '#cecece',
  'input-foreground': '#3b3b3b', 'sideBar-background': '#f8f8f8', 'list-hoverBackground': '#f2f2f2', focusBorder: '#005fb8'
};

function themeCss(vars) {
  return ':root{' + Object.entries(vars).map(([k, v]) => '--vscode-' + k + ':' + v).join(';') +
    ';--vscode-font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--vscode-font-size:13px}';
}

async function page(name, vscodeTheme, docTheme, messages, actions) {
  const nonce = 'shot' + name.replace(/\W/g, '');
  let html = buildWebviewHtml({ cspSource: 'file:', nonce, theme: docTheme, uris: { css: 'media/viewer.css', protocol: 'media/protocol.js', search: 'media/search.js', viewer: 'media/viewer.js' } });
  fs.writeFileSync(path.join(work, name + '-theme.css'), themeCss(vscodeTheme === 'dark' ? DARK : LIGHT));
  fs.writeFileSync(path.join(work, name + '-data.js'),
    'window.__msgs=' + JSON.stringify(messages) + ';window.__actions=' + JSON.stringify(actions || {}) + ';' +
    'window.acquireVsCodeApi=function(){return{postMessage:function(m){if(m.type==="ready")setTimeout(function(){__msgs.forEach(function(x){window.postMessage(x,"*")});setTimeout(__after,50)},0)},getState:function(){return null},setState:function(){}}};' +
    'window.__after=function(){var a=__actions;if(a.scrollTo){var el=document.getElementById(a.scrollTo);if(el)document.getElementById("dv-scroll").scrollTop=el.offsetTop-40}' +
    'if(a.search){var q=document.getElementById("dv-q");q.value=a.search;q.dispatchEvent(new Event("input"));setTimeout(function(){for(var i=0;i<(a.next||0);i++)document.getElementById("dv-next").click();window.__done=true},400)}else window.__done=true};');
  html = html.replace('<link rel="stylesheet"', '<link rel="stylesheet" href="' + name + '-theme.css">\n<link rel="stylesheet"')
    .replace('<body ', '<body class="vscode-' + vscodeTheme + '" ')
    .replace('<script nonce="' + nonce + '" src="media/protocol.js">', '<script nonce="' + nonce + '" src="' + name + '-data.js"></script>\n<script nonce="' + nonce + '" src="media/protocol.js">');
  fs.writeFileSync(path.join(work, name + '.html'), html);
  return 'file://' + path.join(work, name + '.html');
}

async function cdp() {
  const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  let target = list.find((t) => t.type === 'page');
  if (!target) target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
  const send = (method, params) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  return { send, close: () => ws.close() };
}

(async () => {
  fs.cpSync(path.join(root, 'media'), path.join(work, 'media'), { recursive: true });
  const sample = fs.readFileSync(path.join(root, 'test/fixtures/sample.docx'));
  const r = await convertDocx(sample, { ext: '.docx' });
  const meta = { fileName: 'Q3 Field Report.docx', size: sample.length };
  const render = P.buildRenderMessages(r, meta);
  const notice = [P.buildNotice(noticeFor('ole', '.doc'), { fileName: 'budget-2003.doc', size: 512 }, ['openInDefaultApp'])];
  const shots = [
    ['screenshot-dark', 'dark', 'auto', render, { search: 'revenue', next: 0 }],
    ['screenshot-paper', 'dark', 'light', render, { scrollTo: 'h-3' }],
    ['screenshot-light', 'light', 'auto', render, { scrollTo: 'h-4', search: 'region', next: 3 }],
    ['screenshot-doc-notice', 'dark', 'auto', notice, {}]
  ];
  const c = await cdp();
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 780, deviceScaleFactor: 1, mobile: false });
  for (const [name, vt, dt, msgs, actions] of shots) {
    const url = await page(name, vt, dt, msgs, actions);
    await c.send('Page.navigate', { url });
    for (let i = 0; i < 50; i++) {
      await new Promise((res) => setTimeout(res, 100));
      const v = await c.send('Runtime.evaluate', { expression: 'window.__done===true', returnByValue: true });
      if (v.result && v.result.result && v.result.result.value) break;
    }
    await new Promise((res) => setTimeout(res, 200));
    const info = await c.send('Runtime.evaluate', { expression: 'document.getElementById("dv-count").textContent + " | marks=" + document.querySelectorAll("mark").length + " | outline=" + document.querySelectorAll("#dv-outline-list li").length', returnByValue: true });
    const shot = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(root, 'images', name + '.png'), Buffer.from(shot.result.data, 'base64'));
    console.log(name, info.result.result.value);
  }
  c.close();
})().catch((e) => { console.error(e); process.exit(1); });
