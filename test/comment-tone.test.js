'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTone, toneInstruction } = require('../electron/ai/comment-tone');
const { toneWords } = require('../electron/ai/mock');

test('normalizeTone keeps known tone keys', () => {
  assert.equal(normalizeTone('kusa'), 'kusa');
  assert.equal(normalizeTone('polite'), 'polite');
});

test('normalizeTone falls back to balanced for unknown values', () => {
  assert.equal(normalizeTone(''), 'balanced');
  assert.equal(normalizeTone('unsafe'), 'balanced');
});

test('toneInstruction returns a bounded safety-aware instruction', () => {
  const text = toneInstruction('tsukkomi');
  assert.match(text, /ツッコミ/);
  assert.match(text, /攻撃的表現は禁止/);
});

test('mock tone word pools differ by tone', () => {
  assert.ok(toneWords('kusa').some((word) => /草|w/.test(word)));
  assert.ok(toneWords('polite').some((word) => /です|ます/.test(word)));
  assert.deepEqual(toneWords('unknown'), toneWords('balanced'));
});
