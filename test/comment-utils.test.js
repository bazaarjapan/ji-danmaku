'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  dedupeAiComments,
  filterNgComments,
  normalizeCommentText,
  normalizeNgWords
} = require('../electron/comment-utils');

test('normalizeCommentText removes spacing and trailing live-chat punctuation', () => {
  assert.equal(normalizeCommentText(' それ な！！ww '), 'それな');
});

test('dedupeAiComments drops duplicate comments in the batch and recent window', () => {
  const now = 100000;
  const recent = [
    { n: '既存', text: '既存w', at: now - 1000 },
    { n: '期限切れ', text: '期限切れ', at: now - 60000 }
  ];
  const input = [
    { text: '既存！！' },
    { text: 'それなw' },
    { text: 'それな！！' },
    { text: '草' }
  ];

  const result = dedupeAiComments(input, recent, { now, ttlMs: 45000 });

  assert.deepEqual(result.comments.map((comment) => comment.text), ['それなw', '草']);
  assert.deepEqual(result.recent.map((item) => item.n), ['既存', 'それな', '草']);
});

test('filterNgComments drops comments containing configured words', () => {
  const input = [
    { text: 'これはOK' },
    { text: '黙れって言わない' },
    { text: '888' }
  ];

  const result = filterNgComments(input, { ngWords: ['黙れ'], ngMode: 'drop' });

  assert.deepEqual(result.map((comment) => comment.text), ['これはOK', '888']);
});

test('normalizeNgWords trims blanks and removes duplicates', () => {
  assert.deepEqual(normalizeNgWords([' 黙れ ', '', '黙れ', 'KIMOI', 'kimoi']), ['黙れ', 'KIMOI']);
  assert.deepEqual(normalizeNgWords('死ね\n 消えろ,\n死ね'), ['死ね', '消えろ']);
});

test('filterNgComments masks configured words without dropping comments', () => {
  const input = [
    { text: 'それはキモいかも', style: { color: '#fff' } }
  ];

  const result = filterNgComments(input, { ngWords: ['キモい'], ngMode: 'mask' });

  assert.deepEqual(result, [
    { text: 'それは〇〇〇かも', style: { color: '#fff' } }
  ]);
});

test('filterNgComments matches latin NG words case-insensitively', () => {
  const input = [
    { text: 'spam text' },
    { text: 'SPAM text' },
    { text: 'clean' }
  ];

  const dropped = filterNgComments(input, { ngWords: ['Spam'], ngMode: 'drop' });
  assert.deepEqual(dropped.map((comment) => comment.text), ['clean']);

  const masked = filterNgComments([{ text: 'SPAM spam' }], { ngWords: ['Spam'], ngMode: 'mask' });
  assert.deepEqual(masked.map((comment) => comment.text), ['〇〇〇〇 〇〇〇〇']);
});
