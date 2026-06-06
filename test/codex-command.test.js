'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  codexCommandTarget,
  codexCommandCandidates,
  resolveCodexCommand
} = require('../electron/codex-command');

test('Windows Codex command candidates prefer the user npm shim', () => {
  const env = {
    APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\tester'
  };

  assert.deepEqual(codexCommandCandidates('win32', env), [
    path.win32.join(env.APPDATA, 'npm', 'codex.cmd'),
    'codex',
    'codex.cmd'
  ]);
});

test('Windows Codex command resolver uses the explicit shim when it exists', () => {
  const env = {
    APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\tester'
  };
  const expected = path.win32.join(env.APPDATA, 'npm', 'codex.cmd');
  const existsSync = (candidate) => candidate === expected;

  assert.equal(resolveCodexCommand('win32', env, existsSync), expected);
});

test('Windows Codex command resolver falls back to shell PATH lookup', () => {
  const env = {
    APPDATA: 'C:\\Users\\tester\\AppData\\Roaming',
    USERPROFILE: 'C:\\Users\\tester'
  };

  assert.equal(resolveCodexCommand('win32', env, () => false), 'codex');
});

test('Codex command target wraps Windows cmd shims without shell:true', () => {
  assert.deepEqual(codexCommandTarget('C:\\Tools\\codex.cmd', ['app-server', '--help'], 'win32', {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe'
  }), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', '""C:\\Tools\\codex.cmd" "app-server" "--help""'],
    options: { windowsHide: true, windowsVerbatimArguments: true }
  });
});

test('Codex command target executes directly outside Windows', () => {
  assert.deepEqual(codexCommandTarget('codex', ['--version'], 'linux'), {
    command: 'codex',
    args: ['--version'],
    options: { windowsHide: true }
  });
});
