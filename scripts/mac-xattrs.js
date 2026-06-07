'use strict';

const { execFileSync } = require('child_process');

const BLOCKING_XATTRS = [
  'com.apple.FinderInfo',
  'com.apple.ResourceFork'
];

function cleanupXattrs(path) {
  if (!path) return;
  try {
    execFileSync('xattr', ['-cr', path], { stdio: 'ignore' });
  } catch {
    // xattr cleanup is best-effort. codesign verification will surface any
    // remaining macOS metadata that makes the bundle invalid.
  }

  let paths = [];
  try {
    paths = execFileSync('find', [path, '-xattr', '-print0'])
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
  } catch {
    paths = [];
  }

  for (const item of paths) {
    for (const attr of BLOCKING_XATTRS) {
      try {
        execFileSync('xattr', ['-d', attr, item], { stdio: 'ignore' });
      } catch {
        // The attribute may be absent or protected. Continue cleaning the rest.
      }
    }
  }
}

module.exports = { cleanupXattrs };
