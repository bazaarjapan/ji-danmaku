'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// 設定ファイルは %APPDATA%/ji-danmaku/config.json （無ければ既定値）
const CONFIG_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), '.config'),
  'ji-danmaku'
);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  // AI ブレイン: 'codex' | 'anthropic' | 'mock'
  // 利用可能なものへ自動フォールバックする（main.js 側で解決）。
  brain: 'codex',

  // 画面を見て弾幕を生成する間隔(ms)。短いほど反応が良いがコスト/負荷増。
  // Codex は1回 ~20秒かかるため既定はやや長め。生成中は次サイクルを自動スキップ。
  captureIntervalMs: 15000,

  // 1回の生成で受け取る弾幕の最大数。
  commentsPerBatch: 10,

  // アンビエント(自動)弾幕: AI が無くても常に賑わいを出す。0で無効。
  // 1分あたりのおおよその自動コメント数。
  ambientPerMinute: 40,

  // マイク監視: 喋ると弾幕がドッと増える「爽快感」担当。
  micEnabled: true,
  // この音量(0-1)を超えたら「発話」とみなしてリアクションを盛る。
  micThreshold: 0.12,

  // 弾幕の見た目
  fontSize: 30,           // 基準フォントサイズ(px)
  speedMs: 8000,          // 画面端から端まで流れる時間(ms)。小さいほど速い。
  opacity: 0.92,          // 弾幕の不透明度
  maxOnScreen: 120,       // 同時表示の上限（負荷ガード）

  // Codex 設定
  codex: {
    model: '',            // 空ならデフォルトモデル
    timeoutMs: 60000      // 1回の生成のタイムアウト（低reasoningでも ~20s 程度）
  },

  // Anthropic (任意): 環境変数 ANTHROPIC_API_KEY が使われる
  anthropic: {
    model: 'claude-opus-4-8',
    maxTokens: 400
  }
};

function deepMerge(base, override) {
  if (typeof override !== 'object' || override === null) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    if (
      typeof out[key] === 'object' &&
      out[key] !== null &&
      !Array.isArray(out[key]) &&
      typeof override[key] === 'object'
    ) {
      out[key] = deepMerge(out[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    return { ...DEFAULTS };
  }
}

function save(cfg) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[config] save failed:', e.message);
    return false;
  }
}

module.exports = { DEFAULTS, CONFIG_DIR, CONFIG_PATH, load, save, deepMerge };
