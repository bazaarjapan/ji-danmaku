'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { redact } = require('../electron/logger');

test('redact removes secret-like keys recursively', () => {
  const result = redact({
    openaiApiKey: 'sk-testsecret123456',
    nested: {
      authorization: 'Bearer abc.def',
      keep: 'visible'
    },
    list: [{ token: 'secret-token' }]
  });

  assert.deepEqual(result, {
    openaiApiKey: '[redacted]',
    nested: {
      authorization: '[redacted]',
      keep: 'visible'
    },
    list: [{ token: '[redacted]' }]
  });
});

test('redact masks secret-looking values in normal strings', () => {
  const result = redact('failed with key sk-testsecret123456 and Bearer abc.def');

  assert.equal(result, 'failed with key sk-*** and Bearer ***');
});
