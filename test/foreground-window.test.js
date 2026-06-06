'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getForegroundWindow,
  parseMacForegroundOutput
} = require('../electron/foreground-window');

test('parseMacForegroundOutput maps app name and title', () => {
  assert.deepEqual(parseMacForegroundOutput('Safari\nExample Page\n'), {
    process: 'Safari',
    title: 'Example Page'
  });
});

test('parseMacForegroundOutput keeps empty window title', () => {
  assert.deepEqual(parseMacForegroundOutput('Finder\n'), {
    process: 'Finder',
    title: ''
  });
});

test('macOS foreground resolver uses osascript', async () => {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, 'Terminal\nproject\n');
  };

  assert.deepEqual(await getForegroundWindow('darwin', execFile), {
    process: 'Terminal',
    title: 'project'
  });
  assert.equal(calls[0].command, 'osascript');
  assert.equal(calls[0].options.timeout, 5000);
});

test('Windows foreground resolver keeps the PowerShell path', async () => {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args, options });
    callback(null, '{"title":"Project","process":"Code"}\n');
  };

  assert.deepEqual(await getForegroundWindow('win32', execFile), {
    process: 'Code',
    title: 'Project'
  });
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 2), ['-NoProfile', '-NonInteractive']);
  assert.equal(calls[0].options.windowsHide, true);
});

test('unknown platforms return empty context', async () => {
  assert.deepEqual(await getForegroundWindow('linux'), {
    process: '',
    title: ''
  });
});
