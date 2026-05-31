'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findPrivacyExclusion, normalizeProcessName, normalizeRuleList } = require('../electron/privacy-rules');

test('normalizeRuleList accepts arrays and newline text', () => {
  assert.deepEqual(normalizeRuleList([' Bitwarden ', '', 'KeePass']), ['Bitwarden', 'KeePass']);
  assert.deepEqual(normalizeRuleList('password\n secret,\nlogin'), ['password', 'secret', 'login']);
});

test('normalizeProcessName strips exe suffix case-insensitively', () => {
  assert.equal(normalizeProcessName('Bitwarden.EXE'), 'bitwarden');
});

test('findPrivacyExclusion matches configured process names', () => {
  const result = findPrivacyExclusion(
    { process: 'Bitwarden', title: 'Vault' },
    { privacyExclusions: { enabled: true, processNames: ['bitwarden'], titlePatterns: [] } }
  );
  assert.equal(result.excluded, true);
  assert.equal(result.kind, 'process');
});

test('findPrivacyExclusion matches title substrings without exposing the title', () => {
  const result = findPrivacyExclusion(
    { process: 'chrome', title: 'Company password reset' },
    { privacyExclusions: { enabled: true, processNames: [], titlePatterns: ['password'] } }
  );
  assert.equal(result.excluded, true);
  assert.equal(result.kind, 'title');
  assert.equal(result.message.includes('Company'), false);
});

test('findPrivacyExclusion respects disabled rules', () => {
  const result = findPrivacyExclusion(
    { process: 'Bitwarden', title: 'password' },
    { privacyExclusions: { enabled: false, processNames: ['bitwarden'], titlePatterns: ['password'] } }
  );
  assert.deepEqual(result, { excluded: false });
});
