'use strict';
// VS Code for the Web has no processes. "Compare with Git HEAD" is hidden there (when: !isWeb) and
// refuses non-file URIs; this stub makes any call that still gets here fail like a missing git.
function execFile(cmd, args, opts, cb) {
  const err = Object.assign(new Error(cmd + ' cannot run in VS Code for the Web'), { code: 'ENOENT' });
  setTimeout(() => cb(err, new Uint8Array(0), new Uint8Array(0)), 0);
}
module.exports = { execFile };
