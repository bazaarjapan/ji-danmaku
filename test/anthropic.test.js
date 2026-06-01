'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const anthropic = require('../electron/ai/anthropic');

test('anthropic generation passes the abort signal to fetch', async () => {
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevFetch = global.fetch;
  const controller = new AbortController();
  let seenSignal = null;

  process.env.ANTHROPIC_API_KEY = 'test-key';
  global.fetch = async (_url, options) => {
    seenSignal = options.signal;
    return {
      ok: true,
      async json() {
        return { content: [{ text: '{"comments":[{"text":"ok"}]}' }] };
      }
    };
  };

  try {
    const comments = await anthropic.generate({
      count: 1,
      context: {},
      transcript: '',
      imagePath: '',
      recent: [],
      voiceFocus: false,
      voiceOnly: false,
      tone: 'balanced',
      signal: controller.signal
    });

    assert.equal(seenSignal, controller.signal);
    assert.equal(comments[0].text, 'ok');
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    global.fetch = prevFetch;
  }
});
