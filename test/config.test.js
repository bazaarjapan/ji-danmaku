'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULTS, deepMerge, defaultConfig, exportableConfig, sanitizeImportedConfig } = require('../electron/config');

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

test('exportableConfig removes secret and helper fields', () => {
  const result = exportableConfig({
    ...DEFAULTS,
    openaiApiKey: 'sk-secret',
    openaiApiKeyEncrypted: 'encrypted',
    defaultNgWords: ['x']
  });

  assert.equal(Object.prototype.hasOwnProperty.call(result, 'openaiApiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'openaiApiKeyEncrypted'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'defaultNgWords'), false);
  assert.equal(result.brain, DEFAULTS.brain);
});

test('defaultConfig does not include stored API key fields', () => {
  const result = defaultConfig();

  assert.equal(Object.prototype.hasOwnProperty.call(result, 'openaiApiKey'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'openaiApiKeyEncrypted'), false);
});

test('sanitizeImportedConfig keeps known typed keys and drops unknown or invalid values', () => {
  const result = sanitizeImportedConfig({
    brain: 'anthropic',
    sttBackend: 'openai',
    captureIntervalMs: 'fast',
    ngWords: [' foo ', '', 'bar'],
    safeZone: { top: 120, unknown: 9 },
    openaiApiKeyEncrypted: 'encrypted',
    anthropic: { model: 'claude' },
    unknownKey: true
  });

  assert.deepEqual(result, {
    brain: DEFAULTS.brain,
    sttBackend: 'local',
    ngWords: ['foo', 'bar'],
    safeZone: { top: 120 }
  });
});

test('defaultConfig returns a deep clone', () => {
  const first = defaultConfig();
  first.codex.timeoutMs = 1;
  assert.equal(defaultConfig().codex.timeoutMs, DEFAULTS.codex.timeoutMs);
});

test('default voice reactivity starts at a voice-forward balance', () => {
  assert.equal(DEFAULTS.voiceReactivity, 70);
  assert.equal(defaultConfig().voiceReactivity, 70);
});

test('default STT silence favors faster speech reactions', () => {
  assert.equal(DEFAULTS.sttSilenceMs, 650);
  assert.equal(defaultConfig().sttSilenceMs, 650);
});

test('default Whisper model favors realtime transcription', () => {
  assert.equal(DEFAULTS.whisperModel, 'Xenova/whisper-base');
  assert.equal(defaultConfig().whisperModel, 'Xenova/whisper-base');
});

test('default ambient filler starts disabled', () => {
  assert.equal(DEFAULTS.ambientEnabled, false);
  assert.equal(defaultConfig().ambientEnabled, false);
});

test('default capture interval favors responsive generation', () => {
  assert.equal(DEFAULTS.captureIntervalMs, 8000);
  assert.equal(defaultConfig().captureIntervalMs, 8000);
});
