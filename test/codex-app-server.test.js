'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { __test } = require('../electron/ai/codex');

test('AppServer requests resolve responses and clear pending timers', async () => {
  const server = new __test.AppServer();
  let sent = '';
  server.child = {
    stdin: {
      writable: true,
      write(line) { sent = line; }
    }
  };

  const response = server._request('unit/test', { ok: true }, 1000);
  const request = JSON.parse(sent);
  assert.equal(server.pending.size, 1);

  server._dispatch({ id: request.id, result: { done: true } });

  assert.deepEqual(await response, { done: true });
  assert.equal(server.pending.size, 0);
});

test('AppServer reuses a Codex thread while model is unchanged', async () => {
  const server = new __test.AppServer();
  const calls = [];
  server._request = async (method, params) => {
    calls.push({ method, params });
    return { threadId: 'thread-1' };
  };

  assert.equal(await server.ensureThread({ model: 'gpt-5.5', timeoutMs: 1000 }), 'thread-1');
  assert.equal(await server.ensureThread({ model: 'gpt-5.5', timeoutMs: 1000 }), 'thread-1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'thread/start');
  assert.equal(calls[0].params.ephemeral, true);
});

test('AppServer starts a fresh thread when voice-only mode changes', async () => {
  const server = new __test.AppServer();
  const calls = [];
  server._request = async (method, params) => {
    calls.push({ method, params });
    return { threadId: `thread-${calls.length}` };
  };

  assert.equal(await server.ensureThread({ model: 'gpt-5.5', voiceOnly: false, timeoutMs: 1000 }), 'thread-1');
  assert.equal(await server.ensureThread({ model: 'gpt-5.5', voiceOnly: true, timeoutMs: 1000 }), 'thread-2');
  assert.equal(await server.ensureThread({ model: 'gpt-5.5', voiceOnly: true, timeoutMs: 1000 }), 'thread-2');

  assert.equal(calls.length, 2);
});

test('AppServer turn/start errors reject without waiting for turn timeout', async () => {
  const server = new __test.AppServer();
  let sent = '';
  server.child = {
    stdin: {
      writable: true,
      write(line) { sent = line; }
    }
  };
  server.ensure = async () => {};
  server.ensureThread = async () => 'thread-1';

  const turn = server._runTurn({ promptText: 'hello', model: 'gpt-5.5', timeoutMs: 1000 });
  await new Promise((resolve) => setImmediate(resolve));
  const request = JSON.parse(sent);

  assert.equal(request.method, 'turn/start');
  assert.equal(server.pending.size, 1);

  server._dispatch({
    id: request.id,
    error: { code: -32000, message: 'thread busy' }
  });

  await assert.rejects(turn, /thread busy/);
  assert.equal(server.pending.size, 0);
});

test('AppServer schedules recycle after the turn limit', () => {
  const server = new __test.AppServer();
  server.child = { killed: false };
  server.turnsOnServer = 24;

  assert.equal(server.shouldRecycle(), true);
});

test('AppServer starts without a shell on Unix so tree cleanup can target the server', () => {
  assert.deepEqual(__test.appServerSpawnOptions('linux'), {
    detached: true,
    windowsHide: true
  });
  assert.deepEqual(__test.appServerSpawnOptions('win32'), {
    shell: true,
    windowsHide: true
  });
});

test('withTimeout rejects stalled app-server operations', async () => {
  await assert.rejects(
    __test.withTimeout(new Promise(() => {}), 5, 'unit operation'),
    /unit operation timeout/
  );
});
