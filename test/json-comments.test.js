'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { extractJson, normalizeComments } = require('../electron/ai/json-comments');

test('extractJson reads comments JSON from a fenced response', () => {
  const payload = extractJson([
    'Here is the answer:',
    '```json',
    '{"comments":[{"text":"わかるw"}]}',
    '```'
  ].join('\n'));

  assert.deepEqual(payload, { comments: [{ text: 'わかるw' }] });
});

test('extractJson returns null when no comments array is present', () => {
  assert.equal(extractJson('{"message":"not comments"}'), null);
});

test('normalizeComments trims text, limits length, and keeps supported style fields', () => {
  const normalized = normalizeComments({
    comments: [
      {
        text: '  123456789012345678901234567890123456789012345  ',
        color: '#ff5b5b',
        big: true,
        small: true,
        pos: 'ue'
      },
      { text: 'invalid color', color: 'red', pos: 'middle' },
      { text: '   ' },
      { nope: true }
    ]
  });

  assert.deepEqual(normalized, [
    {
      text: '1234567890123456789012345678901234567890',
      style: { color: '#ff5b5b', big: true, small: true, pos: 'ue' }
    },
    {
      text: 'invalid color',
      style: {}
    }
  ]);
});
