'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { deepMerge } = require('../electron/config');

test('deepMerge merges nested objects without losing sibling defaults', () => {
  const base = {
    captureIntervalMs: 15000,
    codex: {
      model: '',
      timeoutMs: 60000,
      minIntervalMs: 1500
    }
  };

  const result = deepMerge(base, {
    codex: {
      timeoutMs: 30000
    }
  });

  assert.deepEqual(result, {
    captureIntervalMs: 15000,
    codex: {
      model: '',
      timeoutMs: 30000,
      minIntervalMs: 1500
    }
  });
  assert.equal(base.codex.timeoutMs, 60000);
});

test('deepMerge replaces arrays and explicit scalar values', () => {
  const result = deepMerge(
    { ngWords: ['a'], nested: { enabled: true, mode: 'drop' } },
    { ngWords: ['b', 'c'], nested: { enabled: false } }
  );

  assert.deepEqual(result, {
    ngWords: ['b', 'c'],
    nested: { enabled: false, mode: 'drop' }
  });
});
