// Bundles the extension host code and the converter worker into out/, the Page view renderer
// (docx-preview + JSZip) into media/page-view.js for the webview, then checks the
// licenses of every npm package that went into the bundles (see scripts/licenses.js).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { checkMetafile } = require('./licenses');
const root = path.join(__dirname, '..');
const common = { bundle: true, platform: 'node', target: 'node18', format: 'cjs', minify: true, legalComments: 'none', logLevel: 'info', metafile: true };
// VS Code for the Web (vscode.dev, github.dev): the extension host is a Web Worker, so these two
// bundles target the browser. Node modules are swapped for small stand-ins (src/web/), Buffer comes
// from the npm 'buffer' package, and the converter runs in a nested Web Worker (src/web/worker.js).
// NODE_BUILTINS fails the build if any Node module still slips into a web bundle.
const NODE_BUILTINS = ['fs', 'path', 'zlib', 'crypto', 'child_process', 'worker_threads', 'os', 'stream', 'util', 'events', 'http', 'https', 'net', 'tls', 'url'];
const webSwap = {
  name: 'web-swap',
  setup(b) {
    b.onResolve({ filter: /^\.\/run-worker$/ }, (a) => (a.importer.endsWith(path.join('src', 'extension.js')) ? { path: path.join(root, 'src/web/run-worker.js') } : undefined));
    b.onResolve({ filter: new RegExp('^(node:)?(' + NODE_BUILTINS.join('|') + ')$') }, (a) => {
      const name = a.path.replace(/^node:/, '');
      if (name === 'path') return { path: path.join(root, 'src/web/path.js') };
      if (name === 'child_process') return { path: path.join(root, 'src/web/child_process.js') };
      if (name === 'stream') return { path: path.join(root, 'src/web/stream.js') }; // word-extractor's OLE reader
      return { errors: [{ text: 'Node module "' + name + '" in a web bundle (from ' + path.relative(root, a.importer) + ')' }] };
    });
  }
};
const web = { ...common, platform: 'browser', target: 'es2022', mainFields: ['browser', 'module', 'main'], plugins: [webSwap], inject: [path.join(root, 'src/web/buffer-shim.js')], define: { global: 'globalThis' } };
Promise.all([
  esbuild.build({ ...common, entryPoints: [path.join(root, 'src/extension.js')], outfile: path.join(root, 'out/extension.js'), external: ['vscode'] }),
  esbuild.build({ ...common, entryPoints: [path.join(root, 'src/worker.js')], outfile: path.join(root, 'out/worker.js') }),
  esbuild.build({ ...common, platform: 'browser', target: 'chrome114', format: 'iife', entryPoints: [path.join(root, 'src/page-entry.js')], outfile: path.join(root, 'media/page-view.js') }),
  // The extension host code uses no Buffer (only the converter does), so no Buffer polyfill here: 57 KB less.
  esbuild.build({ ...web, inject: [], format: 'cjs', entryPoints: [path.join(root, 'src/extension.js')], outfile: path.join(root, 'out/web/extension.js'), external: ['vscode'] }),
  esbuild.build({ ...web, format: 'iife', entryPoints: [path.join(root, 'src/web/worker.js')], outfile: path.join(root, 'out/web/worker.js') })
]).then((results) => {
  const report = { packages: {}, problems: [] };
  for (const r of results) {
    const c = checkMetafile(r.metafile, root);
    Object.assign(report.packages, c.packages);
    report.problems.push(...c.problems);
  }
  fs.writeFileSync(path.join(root, 'out', 'licenses.json'), JSON.stringify(report, null, 1));
  if (report.problems.length) {
    console.error('License check failed:\n  ' + report.problems.join('\n  '));
    process.exit(1);
  }
  console.log('License check: ' + Object.keys(report.packages).length + ' bundled packages, all allowed.');
}).catch((e) => { console.error(e); process.exit(1); });
