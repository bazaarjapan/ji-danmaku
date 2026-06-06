'use strict';

const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (!context.appOutDir) return;

  try {
    execFileSync('xattr', ['-cr', context.appOutDir], { stdio: 'ignore' });
  } catch {
    // xattr is a macOS packaging cleanup. If it is unavailable, let signing fail
    // with the native codesign error rather than hiding the packaging problem.
  }
};
