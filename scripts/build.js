// Bundles the extension host code and the converter worker into out/.
const esbuild = require('esbuild');
const path = require('path');
const root = path.join(__dirname, '..');
const common = { bundle: true, platform: 'node', target: 'node18', format: 'cjs', minify: true, legalComments: 'none', logLevel: 'info' };
Promise.all([
  esbuild.build({ ...common, entryPoints: [path.join(root, 'src/extension.js')], outfile: path.join(root, 'out/extension.js'), external: ['vscode'] }),
  esbuild.build({ ...common, entryPoints: [path.join(root, 'src/worker.js')], outfile: path.join(root, 'out/worker.js') })
]).catch((e) => { console.error(e); process.exit(1); });
