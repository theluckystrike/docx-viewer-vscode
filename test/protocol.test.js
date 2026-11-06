'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../media/protocol');
const S = require('../media/search');
const { buildWebviewHtml } = require('../src/webview-html');

test('validateInbound accepts known messages and strips extra fields', () => {
  assert.deepStrictEqual(P.validateInbound({ type: 'ready', extra: 1 }), { ok: true, msg: { type: 'ready' } });
  assert.deepStrictEqual(P.validateInbound({ type: 'command', name: 'copyMarkdown', x: 2 }), { ok: true, msg: { type: 'command', name: 'copyMarkdown' } });
  assert.strictEqual(P.validateInbound({ type: 'setTheme', theme: 'dark' }).ok, true);
});

test('validateInbound rejects unknown commands, bad links and junk', () => {
  for (const m of [null, 1, 'ready', [], {}, { type: 'command', name: 'rm -rf' }, { type: 'command' },
    { type: 'openLink', href: 'javascript:alert(1)' }, { type: 'openLink', href: 'file:///etc/passwd' },
    { type: 'openLink', href: 'command:workbench.action.terminal.new' }, { type: 'openLink', href: 'https://a b' },
    { type: 'openLink', href: 'https://x/' + 'a'.repeat(3000) }, { type: 'setTheme', theme: 'neon' }, { type: 'eval' }]) {
    assert.strictEqual(P.validateInbound(m).ok, false, JSON.stringify(m));
  }
  assert.strictEqual(P.validateInbound({ type: 'openLink', href: 'https://example.com/q3-report' }).ok, true);
  assert.strictEqual(P.validateInbound({ type: 'openLink', href: 'mailto:team@example.com' }).ok, true);
});

test('buildRenderMessages emits begin, every chunk in order, then end', () => {
  const result = { chunks: ['<p>a</p>', '<p>b</p>', '<p>c</p>'], outline: [{ level: 1, text: 'A', id: 'h-1' }], warnings: [], stats: { words: 3 } };
  const msgs = P.buildRenderMessages(result, { fileName: 'x.docx', size: 10 });
  assert.deepStrictEqual(msgs.map((m) => m.type), ['begin', 'chunk', 'chunk', 'chunk', 'end']);
  assert.deepStrictEqual(msgs.slice(1, 4).map((m) => m.index), [0, 1, 2]);
  for (const m of msgs) assert.ok(P.validateOutbound(m), JSON.stringify(m));
  assert.strictEqual(msgs[0].v, P.VERSION);
});

test('validateOutbound rejects malformed messages in the webview', () => {
  assert.strictEqual(P.validateOutbound({ type: 'chunk', index: 3, total: 3, html: '' }), false);
  assert.strictEqual(P.validateOutbound({ type: 'chunk', index: 0, total: 1, html: 5 }), false);
  assert.strictEqual(P.validateOutbound({ type: 'begin', meta: {}, total: 0 }), false);
  assert.strictEqual(P.validateOutbound({ type: 'theme', theme: 'x' }), false);
  assert.strictEqual(P.validateOutbound({ type: 'other' }), false);
});

test('buildNotice keeps only known actions', () => {
  const n = P.buildNotice({ kind: 'legacyDoc', title: 'T', detail: 'D' }, { fileName: 'a.doc' }, ['openInDefaultApp', 'format c:']);
  assert.deepStrictEqual(n.actions, ['openInDefaultApp']);
  assert.ok(P.validateOutbound(n));
});

test('search finds case-insensitive matches, treats the query literally and caps results', () => {
  assert.deepStrictEqual(S.findMatches('Revenue grew. revenue fell. REVENUE', 'revenue'), [[0, 7], [14, 21], [28, 35]]);
  assert.deepStrictEqual(S.findMatches('a.b axb', 'a.b'), [[0, 3]]);
  assert.deepStrictEqual(S.findMatches('(x) [y]', '[y]'), [[4, 7]]);
  assert.deepStrictEqual(S.findMatches('aaaa', 'a', { max: 2 }), [[0, 1], [1, 2]]);
  assert.deepStrictEqual(S.findMatches('Abc abc', 'abc', { caseSensitive: true }), [[4, 7]]);
  assert.deepStrictEqual(S.findMatches('x', ''), []);
  assert.deepStrictEqual(S.findMatches('Straße STRASSE', 'straße'), [[0, 6]]);
  assert.strictEqual(S.countLabel(0, 3, false), '1 of 3');
  assert.strictEqual(S.countLabel(4, 5000, true), '5 of 5000+');
  assert.strictEqual(S.countLabel(0, 0, false), 'No results');
});

test('webview HTML has a strict CSP with a nonce and no remote sources', () => {
  const html = buildWebviewHtml({ cspSource: 'https://file+.vscode-resource.vscode-cdn.net', nonce: 'abc123', theme: 'dark', uris: { css: 'c.css', protocol: 'p.js', search: 's.js', viewer: 'v.js' } });
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-abc123'/);
  assert.match(csp, /connect-src 'none'/);
  assert.ok(!/unsafe-(inline|eval)/.test(csp));
  assert.ok(!/https?:\/\/(?!file\+)/.test(csp));
  const scripts = html.match(/<script[^>]*>/g);
  assert.strictEqual(scripts.length, 3);
  for (const s of scripts) assert.match(s, /nonce="abc123"/);
  assert.match(html, /data-theme="dark"/);
});
