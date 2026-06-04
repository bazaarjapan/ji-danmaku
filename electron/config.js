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
  // AI ブレイン: 'codex' | 'mock'
  // 利用可能なものへ自動フォールバックする（main.js 側で解決）。
  brain: 'codex',
  // UIプリセット。'custom' は手動調整状態。
  preset: 'custom',

  // 画面を見て弾幕を生成する間隔(ms)。短いほど反応が良いがコスト/負荷増。
  // Codex応答は数秒〜十数秒で揺れる。生成中は次サイクルを自動スキップする。
  captureIntervalMs: 8000,

  // 1回の生成で受け取る弾幕の最大数（発話への反応時）。
  commentsPerBatch: 10,
  // 発話が無く画面だけに反応するときの本数（控えめにして"画面字幕"の出しすぎを防ぐ）。
  commentsPerBatchScreen: 4,

  // 声 ↔ 画面 の反応バランス(0-100)。
  // 100 = 声だけに反応(画面のみの弾幕は出さない) / 0 = 画面だけに反応(声は無視) / 中間はブレンド。
  voiceReactivity: 70,
  // 弾幕の雰囲気: balanced/gentle/tsukkomi/kusa/live/polite/calm
  commentTone: 'balanced',

  // NGワード/コメントフィルタ: 不適切語を含む弾幕を除外/伏字化する（AI・mock両方に適用）。
  ngMode: 'drop',         // 'drop' = 該当弾幕を除外 / 'mask' = 該当語を〇で伏字化
  ngWords: ['死ね', '殺す', 'ぶっ殺', '消えろ', 'クズ', 'カス', 'ブス', 'デブ', 'キモい', 'ウザい', '黙れ'],

  // フィラー弾幕(アンビエント/発話ざわめき)を追加するか。
  // false にすると AI が生成した弾幕だけを流す（www/草/888 等の自動フィラーは出さない）。
  ambientEnabled: false,
  // アンビエント(自動)弾幕: AI が無くても常に賑わいを出す。0で無効。
  // 1分あたりのおおよその自動コメント数。
  ambientPerMinute: 40,

  // マルチモニター: true で全ディスプレイに弾幕オーバーレイを表示。false でプライマリのみ。
  multiMonitor: true,
  // AIに見せる(キャプチャする)ディスプレイ。screen.getAllDisplays() のインデックス。
  // null または範囲外でプライマリ。
  captureDisplayIndex: null,

  // オーバーレイ弾幕をキャプチャから除外するか（自分の弾幕がスクショ/署名に写り込むのを防ぐ）。
  // 'auto': Windows 10 build 19041(version 2004)以降でのみ有効化。古いWindows10では
  //         setContentProtection が「真っ黒」描画になりキャプチャを潰すため auto で自動回避。
  // true: 常に有効 / false: 常に無効。
  overlayContentProtection: 'auto',

  // プライバシー除外: 一致する前面ウィンドウではスクリーンショットもAI生成も止める。
  privacyExclusions: {
    enabled: true,
    // ProcessName は .exe 無し・大小文字無視で完全一致。
    processNames: ['1Password', 'Bitwarden', 'KeePass', 'KeePassXC'],
    // タイトルは部分一致。具体的すぎる個人情報は入れず、一般的な秘密入力画面だけを既定にする。
    titlePatterns: ['password', 'パスワード', 'secret', 'ログイン', 'サインイン', '認証', '2FA']
  },

  // すぐに弾幕・キャプチャ・マイク監視を止める緊急停止キー。
  emergencyStopShortcut: 'F9',

  // アイドル検知: 画面が変化せず発話も無いときAI生成をスキップしてコストを抑える。
  idleDetection: true,
  // 画面署名の平均絶対差がこの値未満なら「変化なし」とみなす(0-255、小さいほど敏感)。
  idleChangeThreshold: 4,
  // 「変化なし」がこの回数連続したらAI生成をスキップ(アンビエントは継続)。
  idleSkipAfter: 1,

  // マイク監視: 喋ると弾幕がドッと増える「爽快感」担当。
  micEnabled: true,
  // 空文字ならOS既定の入力デバイス。値がある場合は getUserMedia の deviceId として使う。
  micDeviceId: '',
  // この音量(0-1)を超えたら「発話」とみなしてリアクションを盛る。
  micThreshold: 0.12,
  // 自動キャリブレーション結果のメタ情報。判定自体は micThreshold を使う。
  micCalibration: {
    noiseFloor: 0,
    peak: 0,
    calibratedAt: ''
  },

  // 音声認識(ローカルWhisper): 発話"内容"を文字起こしし、AIブレインに渡して反応させる。
  // Transformers.js + onnxruntime-web(WASM)でこのPC上のCPUだけで動く。追加課金なし。
  // 初回のみモデルをDL(baseで約150MB)→以降はキャッシュからオフライン動作。
  sttEnabled: true,

  // 音声認識バックエンド: 'local'(ローカルWhisper・無料)。
  sttBackend: 'local',
  // Whisperモデル: tiny=最速/粗い, base=速度と精度のバランス(推奨),
  // small=日本語精度寄り, medium=高精度だが重い(WebGPU推奨)。
  whisperModel: 'Xenova/whisper-base',

  // 発話の区切り判定: この長さの「間(無音)」で一区切りとみなし、一文まるごと解析する。
  // リアルタイム感を優先し、文中の短い間は許容しつつ反応待ちを短くする。
  sttSilenceMs: 650,
  // 区切りが来ない長い発話を強制的に切る上限(ms)。長文を途中で刻みすぎないよう長め。
  sttMaxMs: 20000,

  // 弾幕の見た目
  fontSize: 30,           // 基準フォントサイズ(px)
  speedMs: 8000,          // 画面端から端まで流れる時間(ms)。小さいほど速い。
  opacity: 0.92,          // 弾幕の不透明度
  maxOnScreen: 120,       // 同時表示の上限（負荷ガード）
  // 弾幕を流してよい画面範囲の余白(px)。字幕欄、ゲームUI、通知領域を避けるために使う。
  safeZone: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  },

  // Codex 設定
  codex: {
    model: '',            // 空ならデフォルトモデル
    timeoutMs: 60000,     // 1回の生成のタイムアウト（低reasoningでも ~20s 程度）
    minIntervalMs: 1500,  // 連続生成の最小間隔(レート制御)。これ未満の再呼び出しはスキップ。
    maxFailures: 3,       // 生成がこの回数連続で失敗したらバックオフに入る。
    backoffMs: 30000      // バックオフ時間。この間はcodex生成をスキップしmockで継続。
  },
};

const SECRET_CONFIG_KEYS = new Set([
  'openaiApiKey',
  'openaiApiKeyEncrypted',
  'openaiApiKeyConfigured',
  'openaiApiKeySource',
  'openaiApiKeyStorageAvailable'
]);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function sanitizeByDefaults(value, defaults) {
  if (typeof value !== 'object' || value === null || typeof defaults !== 'object' || defaults === null) return undefined;
  const out = Array.isArray(defaults) ? [] : {};
  for (const key of Object.keys(defaults)) {
    if (SECRET_CONFIG_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(value, key)) continue;
    const source = value[key];
    const def = defaults[key];
    if (Array.isArray(def)) {
      if (Array.isArray(source)) out[key] = source.map((item) => String(item || '').trim()).filter(Boolean);
      continue;
    }
    if (def === null) {
      if (source === null || typeof source === 'number') out[key] = source;
      continue;
    }
    if (typeof def === 'object') {
      const child = sanitizeByDefaults(source, def);
      if (child && Object.keys(child).length) out[key] = child;
      continue;
    }
    if (typeof source === typeof def) out[key] = source;
  }
  return out;
}

function sanitizeImportedConfig(value) {
  return normalizeConfig(sanitizeByDefaults(value, DEFAULTS) || {});
}

function exportableConfig(value) {
  return normalizeConfig(sanitizeByDefaults(value, DEFAULTS) || {});
}

function defaultConfig() {
  return cloneJson(DEFAULTS);
}

function normalizeConfig(cfg) {
  const out = { ...(cfg || {}) };
  if (!['codex', 'mock'].includes(out.brain)) out.brain = DEFAULTS.brain;
  if (out.sttBackend !== 'local') out.sttBackend = DEFAULTS.sttBackend;
  delete out.openaiApiKey;
  delete out.openaiApiKeyEncrypted;
  delete out.openaiSttModel;
  delete out.openaiSttUsdPerMin;
  delete out.openaiUsageMs;
  delete out.anthropic;
  return out;
}

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return normalizeConfig(deepMerge(DEFAULTS, JSON.parse(raw)));
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

module.exports = {
  DEFAULTS,
  CONFIG_DIR,
  CONFIG_PATH,
  load,
  save,
  deepMerge,
  sanitizeImportedConfig,
  exportableConfig,
  defaultConfig
};
