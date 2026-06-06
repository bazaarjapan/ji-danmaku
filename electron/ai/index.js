'use strict';

// ブレインのディスパッチャ。設定の brain を第一候補に、
// 失敗時は mock(アンビエント)へフォールバックする。

const codex = require('./codex');
const mock = require('./mock');
const logger = require('../logger');

// AI ブレインで弾幕バッチを生成。常に配列を返す（最悪 mock）。
async function generateBatch(cfg, { context, transcript, imagePath, recent, count, voiceFocus, voiceOnly }, options = {}) {
  const n = count || cfg.commentsPerBatch || 10;
  const brain = ['codex', 'mock'].includes(cfg.brain) ? cfg.brain : 'codex';

  let result = null;
  let errorMessage = '';
  try {
    if (brain === 'codex') {
      result = await codex.generate({
        count: n, context, transcript, imagePath, recent, voiceFocus, voiceOnly,
        tone: cfg.commentTone,
        model: cfg.codex && cfg.codex.model,
        timeoutMs: cfg.codex && cfg.codex.timeoutMs,
        minIntervalMs: cfg.codex && cfg.codex.minIntervalMs,
        maxFailures: cfg.codex && cfg.codex.maxFailures,
        backoffMs: cfg.codex && cfg.codex.backoffMs
      });
    }
  } catch (e) {
    errorMessage = e.message;
    console.error('[ai] brain error:', e.message);
    logger.error('ai.brain_error', { brain, message: e.message });
  }

  if (result && result.length) {
    return { source: brain, requestedBrain: brain, comments: result, fallbackFrom: '', error: '' };
  }
  if (brain !== 'mock') {
    logger.warn('ai.fallback_to_mock', { brain, count: n });
  }
  // フォールバック: 文脈を活かしたアンビエント
  return {
    source: 'mock',
    requestedBrain: brain,
    comments: mock.generate(n, context || {}, cfg.commentTone),
    fallbackFrom: brain !== 'mock' ? brain : '',
    error: errorMessage || (brain !== 'mock' ? 'AI生成結果が空のためmockへフォールバック' : '')
  };
}

function status() {
  return {
    codex: codex.status ? codex.status() : {}
  };
}

function shutdown(brain) {
  if (!brain || brain === 'codex') {
    try { codex.shutdown(); } catch {}
  }
}

module.exports = { generateBatch, mock, status, shutdown };
