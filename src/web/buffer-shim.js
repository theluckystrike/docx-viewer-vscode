// esbuild "inject" for the web bundles: every free use of Buffer (word-extractor, JSZip's
// 'nodebuffer' output, our converter) gets the npm 'buffer' package, the browser port of Node's Buffer.
export const Buffer = require('buffer/').Buffer;
