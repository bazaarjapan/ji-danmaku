'use strict';

// ブレインのディスパッチャ。設定の brain を第一候補に、
// 失敗時は mock(アンビエント)へフォールバックする。

const codex = require('./codex');
const anthropic = require('./anthropic');
const mock = require('./mock');

// AI ブレインで弾幕バッチを生成。常に配列を返す（最悪 mock）。
async function generateBatch(cfg, { context, transcript, imagePath, recent }) {
  const count = cfg.commentsPerBatch || 10;
  const brain = cfg.brain || 'codex';

  let result = null;
  try {
    if (brain === 'codex') {
      result = await codex.generate({
        count, context, transcript, imagePath, recent,
        model: cfg.codex && cfg.codex.model,
        timeoutMs: cfg.codex && cfg.codex.timeoutMs,
        minIntervalMs: cfg.codex && cfg.codex.minIntervalMs,
        maxFailures: cfg.codex && cfg.codex.maxFailures,
        backoffMs: cfg.codex && cfg.codex.backoffMs
      });
    } else if (brain === 'anthropic') {
      result = await anthropic.generate({
        count, context, transcript, imagePath, recent,
        model: cfg.anthropic && cfg.anthropic.model,
        maxTokens: cfg.anthropic && cfg.anthropic.maxTokens
      });
    }
  } catch (e) {
    console.error('[ai] brain error:', e.message);
  }

  if (result && result.length) {
    return { source: brain, comments: result };
  }
  // フォールバック: 文脈を活かしたアンビエント
  return { source: 'mock', comments: mock.generate(count, context || {}) };
}

module.exports = { generateBatch, mock };
