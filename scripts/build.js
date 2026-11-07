// Bundles the extension host code and the converter worker into out/, the Page view renderer
// (docx-preview + JSZip) into media/page-view.js for the webview, then checks the
// licenses of every npm package that went into the bundles (see scripts/licenses.js).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { checkMetafile } = require('./licenses');
const root = path.join(__dirname, '..');
const common = { bundle: true, platform: 'node', target: 'node18', format: 'cjs', minify: true, legalComments: 'none', logLevel: 'info', metafile: true };
Promise.all([
  esbuild.build({ ...common, entryPoints: [path.join(root, 'src/extension.js')], outfile: path.join(root, 'out/extension.js'), external: ['vscode'] }),
  esbuild.build({ ...common, entryPoints: [path.join(root, 'src/worker.js')], outfile: path.join(root, 'out/worker.js') }),
  esbuild.build({ ...common, platform: 'browser', target: 'chrome114', format: 'iife', entryPoints: [path.join(root, 'src/page-entry.js')], outfile: path.join(root, 'media/page-view.js') })
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
