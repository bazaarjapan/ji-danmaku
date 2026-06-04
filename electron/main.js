'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut, Tray, Menu, nativeImage, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const configStore = require('./config');
const scr = require('./screen');
const ai = require('./ai');
const { dedupeAiComments, filterNgComments, normalizeNgWords } = require('./comment-utils');
const logger = require('./logger');
const privacyRules = require('./privacy-rules');
const { codexCommandCandidates, codexCommandTarget } = require('./codex-command');

// 開発時だけ .env.local（プロジェクト直下）を読み、未設定の環境変数を補う。
function loadEnvLocal() {
  if (app.isPackaged) return;
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const k = m[1];
      const v = m[2].trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {}
}
loadEnvLocal();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

let overlayWins = [];         // 各ディスプレイのオーバーレイ（マルチモニター対応）
let controlWin = null;
let tray = null;
let isQuitting = false;
let cfg = configStore.load();
logger.info('app.launch', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform });

function publicConfig() {
  const out = { ...cfg };
  delete out.openaiApiKey;
  delete out.openaiApiKeyEncrypted;
  return { ...out, defaultNgWords: configStore.DEFAULTS.ngWords };
}

let running = false;          // 弾幕配信ON/OFF
let captureTimer = null;      // AI生成ループ
let ambientTimer = null;      // アンビエント弾幕ループ
let micState = { level: 0, speaking: false, transcript: '' };
let transcriptLog = [];    // 直近の発話ログ { text, at }（話題追従の文脈用）
let lastBatchAt = 0;       // 直近の生成サイクル開始時刻（反応トリガのデバウンス用）
let lastAiCommentAt = 0;   // 直近にAI弾幕を画面へ流した時刻（アンビエント抑制用）
let lastPrivacyKey = '';   // 除外ログの連続出力を抑える
let runtimeDiagnostics = {
  ai: {
    status: 'idle',
    requestedBrain: cfg.brain || 'codex',
    source: '',
    fallbackFrom: '',
    lastError: '',
    lastResult: '未実行',
    updatedAt: 0
  },
  stt: {
    status: cfg.sttEnabled ? 'idle' : 'muted',
    backend: cfg.sttBackend || 'local',
    message: cfg.sttEnabled ? '停止' : 'OFF',
    updatedAt: 0
  },
  privacy: {
    excluded: false,
    message: '',
    kind: '',
    rule: '',
    updatedAt: 0
  },
  safety: {
    emergencyStoppedAt: 0,
    reason: '',
    shortcut: cfg.emergencyStopShortcut || 'F9',
    updatedAt: 0
  },
  setup: {
    status: 'idle',
    checks: [],
    updatedAt: 0
  }
};

// ---- ウィンドウ生成 ----------------------------------------------------

// オーバーレイをキャプチャから除外して良いか判定。
// 'auto' は WDA_EXCLUDEFROMCAPTURE が正しく効く Windows 10 build 19041(2004) 以降のみ有効化。
function shouldExcludeFromCapture() {
  const mode = cfg.overlayContentProtection;
  if (mode === true) return true;
  if (mode === false) return false;
  if (process.platform !== 'win32') return true;  // macOS等は通常どおり除外可
  const build = parseInt((os.release().split('.')[2] || '0'), 10);
  return build >= 19041;
}

// 1ディスプレイ分のオーバーレイを生成する。
function createOverlayForDisplay(display) {
  const { x, y, width, height } = display.bounds;

  const win = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 他アプリの裏/最小化でも弾幕アニメを止めない（Chromiumの背景スロットリング無効化）。
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // クリック透過: 弾幕は完全に「上を流れるだけ」で操作を邪魔しない。
  win.setIgnoreMouseEvents(true, { forward: true });
  // 自分が流した弾幕を画面キャプチャから除外する（Windows: WDA_EXCLUDEFROMCAPTURE）。
  // これにより (1) アイドル検知の画面署名が自分の弾幕の動きで汚れない、
  //          (2) AIブレインへ渡すスクショに自分の弾幕が写り込まず、実画面だけに反応できる。
  // ユーザーの目には弾幕は通常どおり表示される（キャプチャ系ツールにのみ非表示）。
  // ただし Windows 10 build 19041 未満では「除外」ではなく「真っ黒」描画になり、
  // フルスクリーンのオーバーレイだとキャプチャ全体を潰してしまうため自動で無効化する。
  if (shouldExcludeFromCapture()) {
    win.setContentProtection(true);
  } else {
    console.log('[overlay] content protection をスキップ（古いWindowsビルド）。弾幕がキャプチャに写る可能性があります。');
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  win.on('closed', () => { overlayWins = overlayWins.filter((w) => w !== win); });
  return win;
}

function destroyOverlays() {
  for (const w of overlayWins) { try { if (!w.isDestroyed()) w.destroy(); } catch {} }
  overlayWins = [];
}

// multiMonitor=true で全ディスプレイに、false でプライマリのみオーバーレイを生成。
function createOverlays() {
  destroyOverlays();
  const displays = cfg.multiMonitor === false
    ? [screen.getPrimaryDisplay()]
    : screen.getAllDisplays();
  overlayWins = displays.map((d) => createOverlayForDisplay(d));
  setOverlayStyle();
}

// ディスプレイ着脱・解像度変更に追従して作り直す（短時間の連続イベントはまとめる）。
let rebuildTimer = null;
function scheduleOverlayRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { createOverlays(); }, 400);
}

// AIに見せる(キャプチャする)ディスプレイ。captureDisplayIndex が範囲内ならそれ、無ければプライマリ。
function captureTargetDisplay() {
  const displays = screen.getAllDisplays();
  const idx = cfg.captureDisplayIndex;
  if (typeof idx === 'number' && idx >= 0 && idx < displays.length) return displays[idx];
  return screen.getPrimaryDisplay();
}

function createControl() {
  controlWin = new BrowserWindow({
    width: 420,
    height: 640,
    title: 'Ji-Danmaku コントロール',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // ローカルWhisper(Worker)が node_modules の WASM ランタイムを fetch で読めるよう
      // file:// への同一オリジン外アクセスを許可。このウィンドウは自前のローカルHTMLしか
      // 読み込まない(リモート/未知のコンテンツは一切開かない)ため安全。
      webSecurity: false,
      // 最小化/裏に回ってもマイク監視・発話検知(rAFループ)を止めない。
      // これが無いとコントロール画面が隠れた途端に声反応の弾幕が止まる。
      backgroundThrottling: false
    }
  });
  controlWin.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'));
  controlWin.webContents.once('did-finish-load', () => {
    sendControl('running', running);
    sendControl('diagnostics', runtimeDiagnosticsSnapshot());
  });
  controlWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    controlWin.hide();
    updateTrayMenu();
  });
  controlWin.on('closed', () => { controlWin = null; });
}

function sendControl(channel, payload) {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send(channel, payload);
}

function stampRuntimePatch(patch) {
  const at = Date.now();
  const stamped = { ...(patch || {}) };
  for (const key of ['ai', 'stt', 'privacy', 'safety']) {
    if (patch && patch[key]) stamped[key] = { ...patch[key], updatedAt: at };
  }
  return stamped;
}

function runtimeDiagnosticsSnapshot() {
  const aiStatus = ai.status ? ai.status() : {};
  return configStore.deepMerge(runtimeDiagnostics, {
    codex: aiStatus.codex || {}
  });
}

function updateRuntimeDiagnostics(patch) {
  runtimeDiagnostics = configStore.deepMerge(runtimeDiagnostics, stampRuntimePatch(patch));
  const snapshot = runtimeDiagnosticsSnapshot();
  sendControl('diagnostics', snapshot);
  return snapshot;
}

function privacySafeContext(privacy) {
  return {
    title: '<privacy-excluded>',
    process: privacy.kind === 'process' ? privacy.rule : ''
  };
}

function updatePrivacyDiagnostics(privacy) {
  if (privacy && privacy.excluded) {
    const key = `${privacy.kind || ''}:${privacy.rule || ''}`;
    if (key !== lastPrivacyKey) {
      logger.info('privacy.excluded', { kind: privacy.kind, rule: privacy.rule });
      lastPrivacyKey = key;
    }
    updateRuntimeDiagnostics({
      privacy: {
        excluded: true,
        message: privacy.message,
        kind: privacy.kind || '',
        rule: privacy.rule || ''
      },
      ai: {
        status: 'idle',
        requestedBrain: cfg.brain || 'codex',
        source: '',
        fallbackFrom: '',
        lastError: '',
        lastResult: 'プライバシー除外中'
      }
    });
    return;
  }
  if (lastPrivacyKey) {
    logger.info('privacy.clear');
    lastPrivacyKey = '';
  }
  updateRuntimeDiagnostics({
    privacy: {
      excluded: false,
      message: '',
      kind: '',
      rule: ''
    }
  });
}

// コントロール画面を最前面に呼び出す（F7）。閉じていれば作り直す。
// 全画面アプリの裏に隠れて見失った時の救済。
function summonControl() {
  if (!controlWin || controlWin.isDestroyed()) { createControl(); return; }
  if (controlWin.isMinimized()) controlWin.restore();
  controlWin.show();
  // Windowsでフォーカス奪取を確実にするため一時的に最前面化してから戻す。
  controlWin.setAlwaysOnTop(true);
  try { controlWin.moveTop(); } catch {}
  controlWin.focus();
  setTimeout(() => {
    if (controlWin && !controlWin.isDestroyed()) controlWin.setAlwaysOnTop(false);
  }, 500);
}

function createTrayImage() {
  const candidates = [
    path.join(process.resourcesPath || '', 'tray-icon.ico'),
    path.join(process.resourcesPath || '', 'tray-icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png')
  ];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) {
        image.setTemplateImage(false);
        return image;
      }
    } catch {}
  }

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="7" fill="#11131a"/>',
    '<path d="M7 10h18v3H7zm0 6h14v3H7zm0 6h18v3H7z" fill="#5bd1ff"/>',
    '<circle cx="25" cy="9" r="4" fill="#ffd24d"/>',
    '</svg>'
  ].join('');
  const image = nativeImage.createFromDataURL('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
  image.setTemplateImage(false);
  return image;
}

function createTray() {
  if (tray) return;
  tray = new Tray(createTrayImage());
  tray.setToolTip('Ji-Danmaku');
  tray.on('click', summonControl);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'コントロールを表示', click: summonControl },
    {
      label: running ? '弾幕を停止' : '弾幕を開始',
      click: () => { if (running) stopRunning(); else startRunning(); }
    },
    { label: '緊急停止', enabled: running, click: () => emergencyStop('tray') },
    { type: 'separator' },
    { label: '終了', click: quitFromTray }
  ]));
}

function quitFromTray() {
  isQuitting = true;
  try { stopRunning({ clearOverlay: true }); } catch {}
  app.quit();
}

// ---- 弾幕送出 ----------------------------------------------------------

// AIコメントの重複抑制用: 直近に流したテキストをローリング保持する。
// アンビエント/発話ざわめき(www/草/888)は"群衆らしい繰り返し"なので対象外。
let recentAi = [];               // { n: 正規化テキスト, text: 原文, at: 時刻 }
const RECENT_AI_TTL = 45000;     // 45秒以内は重複とみなす

// 'ai' バッチからバッチ内＋直近窓の重複を除去する。
function dedupeAi(comments) {
  const result = dedupeAiComments(comments, recentAi, { ttlMs: RECENT_AI_TTL });
  recentAi = result.recent;
  return result.comments;
}

// 直前に出たAIコメント原文（プロンプトの反復抑制に渡す）。
function recentAiTexts(limit = 12) {
  const now = Date.now();
  return recentAi.filter((r) => now - r.at < RECENT_AI_TTL).slice(-limit).map((r) => r.text);
}

// 色未指定の弾幕に、内容キーワード連動のアクセント色を控えめ(約45%)に付与する。
// 既に色/テスト弾幕は触らない。基本は白多数でうるさくしない。
function applyAccents(comments) {
  return comments.map((c) => {
    const st = c.style || {};
    if (st.color) return c;
    const ac = ai.mock.accentColor(c.text);
    if (ac && Math.random() < 0.45) return { ...c, style: { ...st, color: ac } };
    return c;
  });
}

// NGワードフィルタ: 不適切語を含む弾幕を除外(drop)または伏字化(mask)。
// 全弾幕(AI/ambient/voice/test)が通る sendComments で適用し、漏れをなくす。
function filterNg(comments) {
  return filterNgComments(comments, cfg);
}

// 全オーバーレイ（各ディスプレイ）へ同じメッセージを配る。
function broadcastOverlay(channel, payload) {
  for (const w of overlayWins) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function sendComments(comments, source) {
  if (!overlayWins.length || !comments || !comments.length) return;
  let list = comments;
  if (source === 'ai') {
    list = dedupeAi(comments);
    if (!list.length) return;
  }
  list = filterNg(list);
  if (!list.length) return;
  if (source !== 'test') list = applyAccents(list);
  // 重複抑制・フィルタは1回だけ実行し、同じ弾幕を全モニターに流す。
  broadcastOverlay('danmaku', { comments: list, source });
}

function setOverlayStyle() {
  if (!overlayWins.length) return;
  broadcastOverlay('style', {
    fontSize: cfg.fontSize,
    speedMs: cfg.speedMs,
    opacity: cfg.opacity,
    maxOnScreen: cfg.maxOnScreen,
    safeZone: cfg.safeZone
  });
}

// AI生成バッチを間隔内で少しずつ流す（連続感を出す）。
let dripQueue = [];
let dripTimer = null;
let lastEnqueueAt = 0;   // 直近バッチ到着時刻（生成間隔の実測用）
let batchInterval = 0;   // 観測した生成間隔(EWMA)
let dripDeadline = 0;    // 現在のキューを流し切る目標時刻

// AI生成バッチを「一気に出さず」、次のバッチが来るまで持つよう間隔調整して流す。
// 各tickで「残り時間 ÷ 残り個数」で間隔を決めるため、末尾ほど自然に伸びて“間”が空きにくい。
function enqueueDrip(comments) {
  if (!comments || !comments.length) return;
  const now = Date.now();
  // 実際の生成間隔を観測(EWMA)。codexの実レイテンシに追従し、流し切る目標時間に使う。
  if (lastEnqueueAt) {
    const delta = now - lastEnqueueAt;
    if (delta > 1000 && delta < 120000) {
      batchInterval = batchInterval ? Math.round(batchInterval * 0.6 + delta * 0.4) : delta;
    }
  }
  lastEnqueueAt = now;
  dripQueue.push(...comments);
  // 次バッチが来るまで持たせる目標。観測間隔（なければ生成間隔設定）を基準に少し広め。
  const window = Math.max(4000, batchInterval || cfg.captureIntervalMs || 15000);
  dripDeadline = now + window;

  if (dripTimer) return;
  const tick = () => {
    if (!running || !dripQueue.length) {
      clearTimeout(dripTimer);
      dripTimer = null;
      return;
    }
    const speaking = micState.speaking;
    // 基本は1個ずつ。行列が溜まりすぎた時だけ2個まとめて掃く(オーバーフロー防止)。
    const burst = dripQueue.length > 14 ? 2 : 1;
    const chunk = dripQueue.splice(0, burst);
    sendComments(chunk, 'ai');
    lastAiCommentAt = Date.now();
    // 「残り時間 ÷ 残り個数」で常に均等配分し、生成タイミングでの一気流れを無くす。
    // 発話中はテンポを少し上げる（下限/上限を短めに）。自然なゆらぎも足す。
    const remain = Math.max(0, dripDeadline - Date.now());
    const per = remain / Math.max(1, dripQueue.length);
    const minGap = speaking ? 450 : 700;
    const maxGap = speaking ? 1600 : 2800;
    const gap = Math.min(maxGap, Math.max(minGap, per)) * (0.9 + Math.random() * 0.2);
    dripTimer = setTimeout(tick, gap);
  };
  tick();
}

// ---- ループ ------------------------------------------------------------

let cycleBusy = false;
let prevSignature = null;   // 前サイクルの画面署名（アイドル検知用）
let idleStreak = 0;         // 「変化なし」連続回数
let reactiveTimer = null;   // 発話/画面変化への即時反応生成のデバウンス
let reactivePending = false;// 生成中に来た反応要求を、終了後に1回だけ拾う
let stopToken = 0;          // 停止後に進行中の非同期キャプチャを破棄するための世代

// 「視聴者が"今の発言/画面"に即反応する」ための生成トリガ。
// codex は1ターンずつ＆~20秒かかるので、生成中は終了後に1回だけ拾い、
// アイドル時の単発トリガは直近生成から4秒以内の連打を抑える。
function triggerReactiveCycle() {
  if (!running) return;
  if (cycleBusy) { reactivePending = true; return; }
  if (reactiveTimer) return;
  const since = Date.now() - lastBatchAt;
  const wait = since >= 4000 ? 120 : (4000 - since);
  reactiveTimer = setTimeout(() => { reactiveTimer = null; captureCycle(); }, wait);
}

function cycleCancelled(token) {
  return !running || token !== stopToken;
}

function aiWatchdogTimeoutMs() {
  const brain = cfg.brain || 'codex';
  if (brain === 'codex') {
    const base = cfg.codex && Number(cfg.codex.timeoutMs);
    return Math.max(15000, (Number.isFinite(base) && base > 0 ? base : 60000) + 10000);
  }
  return 70000;
}

function fallbackBatchAfterWatchdog(params, message) {
  const count = params && params.count ? params.count : cfg.commentsPerBatch || 6;
  const brain = cfg.brain || 'codex';
  if (brain === 'codex' && ai.shutdown) ai.shutdown('codex');
  logger.warn('ai.generation_watchdog_timeout', {
    brain,
    timeoutMs: aiWatchdogTimeoutMs(),
    message
  });
  return {
    source: 'mock',
    requestedBrain: brain,
    comments: ai.mock.generate(count, (params && params.context) || {}, cfg.commentTone),
    fallbackFrom: brain,
    error: message
  };
}

function generateBatchWithWatchdog(params) {
  const timeoutMs = aiWatchdogTimeoutMs();
  const controller = new AbortController();
  let timer = null;
  return Promise.race([
    ai.generateBatch(cfg, params, { signal: controller.signal }).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(fallbackBatchAfterWatchdog(params, `AI生成が${Math.round(timeoutMs / 1000)}秒で応答しませんでした`));
      }, timeoutMs);
    })
  ]);
}

async function captureCycle() {
  if (!running || cycleBusy) return;  // 生成中なら今回の発火はスキップ（プロセス重複防止）
  cycleBusy = true;
  const cycleToken = stopToken;
  lastBatchAt = Date.now();
  let context = { title: '', process: '' };
  let imagePath = null;
  let signature = null;
  try {
    context = await scr.getForegroundWindow();
  } catch {}
  if (cycleCancelled(cycleToken)) {
    cycleBusy = false;
    return;
  }

  const privacy = privacyRules.findPrivacyExclusion(context, cfg);
  if (privacy.excluded) {
    const safeContext = privacySafeContext(privacy);
    _lastContext = safeContext;
    updatePrivacyDiagnostics(privacy);
    sendControl('status', {
      idle: true,
      privacyExcluded: true,
      privacyReason: privacy.message,
      lastContext: safeContext
    });
    cycleBusy = false;
    reactivePending = false;
    return;
  }
  _lastContext = context;
  updatePrivacyDiagnostics(null);

  try {
    const shot = await scr.captureScreenshot(captureTargetDisplay());
    if (shot) { imagePath = shot.file; signature = shot.signature; }
  } catch (e) {
    console.error('[capture] screenshot失敗:', e.message);
    logger.warn('capture.screenshot_failed', { message: e.message });
  }
  if (cycleCancelled(cycleToken)) {
    cycleBusy = false;
    return;
  }

  const speaking = micState.speaking;

  // アイドル検知: 画面が変化せず発話も無ければAI生成をスキップしてコストを抑える。
  if (cfg.idleDetection) {
    const diff = scr.signatureDiff(prevSignature, signature);
    const changed = diff >= (cfg.idleChangeThreshold ?? 4);
    prevSignature = signature || prevSignature;
    if (!changed && !speaking) {
      idleStreak++;
      if (idleStreak >= (cfg.idleSkipAfter ?? 1)) {
        // 生成はスキップ。アンビエント弾幕は別ループで継続するので「無人」にはならない。
        updateRuntimeDiagnostics({
          ai: {
            status: 'idle',
            requestedBrain: cfg.brain || 'codex',
            source: '',
            fallbackFrom: '',
            lastError: '',
            lastResult: '画面変化なしでスキップ'
          }
        });
        sendControl('status', { idle: true, lastContext: context });
        cycleBusy = false;
        return;
      }
    } else {
      idleStreak = 0;  // 変化/発話を検知 → 即再開
    }
  }

  // Whisperの文字起こしは発話が終わった直後に届くため、speaking=false でも
  // 直近(25秒以内)の認識結果は文脈として渡す。
  const nowTs = Date.now();
  const fresh = micState.transcript && (nowTs - (micState.transcriptAt || 0) < 25000);
  // 直近の発話を数発分(90秒以内・最大3つ)まとめ、会話の流れに沿わせる。
  const thread = transcriptLog.filter((e) => nowTs - e.at < 90000).slice(-3).map((e) => e.text);
  // 声↔画面バランス(0-100)。vr>0でのみ発話を採用し、画面のみ本数は (100-vr)/100 で増減。
  const vr = Math.max(0, Math.min(100, cfg.voiceReactivity ?? 60));
  const allowVoice = vr > 0;
  const transcript = (allowVoice && (speaking || fresh)) ? (thread.join(' / ') || micState.transcript) : '';
  try {
    const recent = recentAiTexts();
    // 発話があれば「声への反応」を主役に満度で、無ければ画面のみ控えめ(バランスで増減)で生成。
    const voiceFocus = !!transcript;
    // 声100%: 画面(スクショ・ウィンドウ名)を一切渡さず、発言だけに反応する。
    const voiceOnly = voiceFocus && vr >= 100;
    let count;
    if (voiceFocus) {
      count = cfg.commentsPerBatch || 10;
    } else {
      count = Math.round((cfg.commentsPerBatchScreen ?? 4) * (100 - vr) / 100);
      if (count < 1) {
        // 声100%(画面弾幕なし)設定で発話も無い → 今回は生成しない。
        updateRuntimeDiagnostics({
          ai: {
            status: 'idle',
            requestedBrain: cfg.brain || 'codex',
            source: '',
            fallbackFrom: '',
            lastError: '',
            lastResult: '声待ち'
          }
        });
        sendControl('status', { idle: true, lastContext: context });
        return;   // cycleBusy 解除と reactivePending 処理は finally が行う
      }
    }
    const imageForGen = voiceOnly ? null : imagePath;   // 声100%はスクショを渡さない
    if (cycleCancelled(cycleToken)) return;
    updateRuntimeDiagnostics({
      ai: {
        status: 'generating',
        requestedBrain: cfg.brain || 'codex',
        source: '',
        fallbackFrom: '',
        lastError: '',
        lastResult: '生成中'
      }
    });
    const { source, comments, requestedBrain, fallbackFrom, error } = await generateBatchWithWatchdog({ context, transcript, imagePath: imageForGen, recent, count, voiceFocus, voiceOnly });
    // 生成中に停止された場合は結果を破棄（停止後にUIが「配信中」へ戻ったり弾幕が出るのを防ぐ）。
    if (cycleCancelled(cycleToken)) return;
    updateRuntimeDiagnostics({
      ai: {
        status: fallbackFrom ? 'fallback' : 'ready',
        requestedBrain: requestedBrain || cfg.brain || 'codex',
        source,
        fallbackFrom: fallbackFrom || '',
        lastError: error || '',
        lastResult: `${source}: ${comments.length}件`
      }
    });
    sendControl('status', { brain: source, idle: false, lastContext: context });
    enqueueDrip(comments);
  } finally {
    cycleBusy = false;
    // 生成中に発話/画面変化があったら、続けてもう一度だけ反応する。
    if (reactivePending && running) { reactivePending = false; triggerReactiveCycle(); }
  }
}

function ambientTick() {
  if (!running) return;
  // 1分あたり ambientPerMinute 個 → 平均間隔。発話中は密度UP。
  const per = cfg.ambientPerMinute || 0;
  const base = per > 0 ? 60000 / per : 1500;
  const factor = micState.speaking ? 0.4 : 1;
  // AI主体: AI弾幕がドリップ中／直近(3秒以内)に流れている間はフィラーを控える。
  // AIが途切れた“隙間”だけ賑わいを足し、無音を防ぐ。
  const aiFlowing = dripQueue.length > 0 || (Date.now() - lastAiCommentAt < 3000);
  // 「フィラーを追加」がON・密度>0・AIの隙間のときだけ賑わいを足す。
  // OFF時は何も出さず＝AIが生成した弾幕だけが流れる。
  if (cfg.ambientEnabled && per > 0 && !aiFlowing) {
    const n = micState.speaking ? 2 : 1;
    sendComments(ai.mock.generate(n, lastContext(), cfg.commentTone), 'ambient');
  }
  // ループは running 中は維持し、チェック/スライダー変更を即反映する。
  ambientTimer = setTimeout(ambientTick, base * factor * (0.6 + Math.random() * 0.8));
}

let _lastContext = { title: '', process: '' };
function lastContext() { return _lastContext; }

function startRunning() {
  if (running) return;
  running = true;
  logger.info('danmaku.start', {
    brain: cfg.brain,
    sttBackend: cfg.sttBackend,
    micEnabled: cfg.micEnabled,
    sttEnabled: cfg.sttEnabled,
    captureIntervalMs: cfg.captureIntervalMs
  });
  setOverlayStyle();
  updateRuntimeDiagnostics({
    ai: {
      status: 'generating',
      requestedBrain: cfg.brain || 'codex',
      source: '',
      fallbackFrom: '',
      lastError: '',
      lastResult: '起動中'
    },
    stt: {
      status: cfg.sttEnabled ? 'idle' : 'muted',
      backend: cfg.sttBackend || 'local',
      message: cfg.sttEnabled ? '待機' : 'OFF'
    }
  });
  captureCycle();
  captureTimer = setInterval(captureCycle, Math.max(3000, cfg.captureIntervalMs));
  ambientTick();
  broadcastRunning();
}

function stopRunning(options = {}) {
  running = false;
  stopToken++;
  logger.info('danmaku.stop');
  clearInterval(captureTimer); captureTimer = null;
  clearTimeout(ambientTimer); ambientTimer = null;
  clearTimeout(dripTimer); dripTimer = null;
  clearTimeout(reactiveTimer); reactiveTimer = null;
  reactivePending = false;
  dripQueue = [];
  lastEnqueueAt = 0;
  dripDeadline = 0;
  recentAi = [];
  transcriptLog = [];
  prevSignature = null;
  idleStreak = 0;
  if (options.clearOverlay) broadcastOverlay('clear-danmaku', {});
  updateRuntimeDiagnostics({
    ai: {
      status: 'idle',
      requestedBrain: cfg.brain || 'codex',
      source: '',
      fallbackFrom: '',
      lastError: '',
      lastResult: '停止中'
    },
    stt: {
      status: cfg.sttEnabled ? 'idle' : 'muted',
      backend: cfg.sttBackend || 'local',
      message: cfg.sttEnabled ? '停止' : 'OFF'
    }
  });
  broadcastRunning();
}

function emergencyStop(reason = 'shortcut') {
  logger.warn('emergency.stop', { reason });
  stopRunning({ clearOverlay: true });
  updateRuntimeDiagnostics({
    safety: {
      emergencyStoppedAt: Date.now(),
      reason,
      shortcut: cfg.emergencyStopShortcut || 'F9'
    }
  });
  sendControl('emergency-stop', { reason, at: Date.now(), shortcut: cfg.emergencyStopShortcut || 'F9' });
  summonControl();
}

function broadcastRunning() {
  sendControl('running', running);
  updateTrayMenu();
}

// ---- IPC ---------------------------------------------------------------

ipcMain.handle('get-config', () => publicConfig());
ipcMain.handle('get-runtime-diagnostics', () => runtimeDiagnosticsSnapshot());
ipcMain.handle('run-setup-diagnostics', runSetupDiagnostics);
ipcMain.handle('export-config', exportConfigToFile);
ipcMain.handle('import-config', importConfigFromFile);
ipcMain.handle('reset-config', resetConfigToDefaults);

function configSummaryForDiagnostics() {
  return logger.redact({
    brain: cfg.brain,
    preset: cfg.preset,
    commentTone: cfg.commentTone,
    captureIntervalMs: cfg.captureIntervalMs,
    commentsPerBatch: cfg.commentsPerBatch,
    commentsPerBatchScreen: cfg.commentsPerBatchScreen,
    voiceReactivity: cfg.voiceReactivity,
    ambientEnabled: cfg.ambientEnabled,
    ambientPerMinute: cfg.ambientPerMinute,
    multiMonitor: cfg.multiMonitor,
    captureDisplayIndex: cfg.captureDisplayIndex,
    overlayContentProtection: cfg.overlayContentProtection,
    privacyExclusions: {
      enabled: cfg.privacyExclusions && cfg.privacyExclusions.enabled !== false,
      processNamesCount: Array.isArray(cfg.privacyExclusions && cfg.privacyExclusions.processNames)
        ? cfg.privacyExclusions.processNames.length
        : 0,
      titlePatternsCount: Array.isArray(cfg.privacyExclusions && cfg.privacyExclusions.titlePatterns)
        ? cfg.privacyExclusions.titlePatterns.length
        : 0
    },
    emergencyStopShortcut: cfg.emergencyStopShortcut,
    idleDetection: cfg.idleDetection,
    micEnabled: cfg.micEnabled,
    micDeviceId: cfg.micDeviceId ? '<configured>' : '',
    micThreshold: cfg.micThreshold,
    micCalibration: cfg.micCalibration,
    sttEnabled: cfg.sttEnabled,
    sttBackend: cfg.sttBackend,
    whisperModel: cfg.whisperModel,
    safeZone: cfg.safeZone,
    ngMode: cfg.ngMode,
    ngWordsCount: Array.isArray(cfg.ngWords) ? cfg.ngWords.length : 0,
    codex: {
      model: cfg.codex && cfg.codex.model ? '<configured>' : '',
      timeoutMs: cfg.codex && cfg.codex.timeoutMs,
      minIntervalMs: cfg.codex && cfg.codex.minIntervalMs,
      maxFailures: cfg.codex && cfg.codex.maxFailures,
      backoffMs: cfg.codex && cfg.codex.backoffMs
    }
  });
}

function buildDiagnosticsText() {
  const state = logger.redact({
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    running,
    overlayWindows: overlayWins.filter((w) => w && !w.isDestroyed()).length,
    controlWindowOpen: !!(controlWin && !controlWin.isDestroyed()),
    lastContext: _lastContext,
    micState: {
      level: micState.level,
      speaking: micState.speaking,
      hasTranscript: !!micState.transcript,
      transcriptAt: micState.transcriptAt
    },
    queue: {
      dripQueue: dripQueue.length,
      cycleBusy,
      reactivePending,
      idleStreak
    },
    runtimeDiagnostics: runtimeDiagnosticsSnapshot()
  });
  const lines = [
    'Ji-Danmaku Diagnostics',
    `GeneratedAt: ${new Date().toISOString()}`,
    `ConfigPath: ${configStore.CONFIG_PATH}`,
    `LogDir: ${logger.LOG_DIR}`,
    '',
    'State:',
    JSON.stringify(state, null, 2),
    '',
    'ConfigSummary:',
    JSON.stringify(configSummaryForDiagnostics(), null, 2),
    '',
    'RecentLogs:',
    ...logger.readRecentLines(80)
  ];
  return logger.redact(lines.join('\n'));
}

ipcMain.handle('get-diagnostics', () => {
  const text = buildDiagnosticsText();
  logger.info('diagnostics.copy_requested');
  return { text, logDir: logger.LOG_DIR };
});

ipcMain.handle('export-diagnostics', () => {
  const text = buildDiagnosticsText();
  const file = logger.writeDiagnostics(text);
  logger.info('diagnostics.exported', { file });
  return { text, file };
});

function setupItem(id, label, status, message, action = '') {
  return { id, label, status, message, action };
}

function summarizeSetupStatus(checks) {
  if (checks.some((check) => check.status === 'error')) return 'error';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'ok';
}

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 5000, ...options }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve(String(stdout || stderr || '').trim());
    });
  });
}

function setupErrorDetail(error) {
  const detail = String(
    (error && (error.stderr || error.stdout || error.message)) || ''
  ).trim().replace(/\s+/g, ' ');
  return detail ? detail.slice(0, 180) : '詳細不明';
}

async function execCodexText(args, options = {}) {
  let lastError = null;
  for (const command of codexCommandCandidates()) {
    try {
      const target = codexCommandTarget(command, args);
      const text = await execFileText(target.command, target.args, { ...target.options, ...options });
      return { command, text };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Codex CLI not found');
}

async function checkCodexSetup() {
  try {
    const version = await execCodexText(['--version'], { timeout: 5000 });
    try {
      await execCodexText(['app-server', '--help'], { timeout: 5000 });
    } catch (error) {
      return setupItem(
        'codex',
        'Codex',
        cfg.brain === 'codex' ? 'error' : 'warn',
        version.text ? `Codex CLI は起動できます: ${version.text}` : 'Codex CLI は起動できます',
        `codex app-server を確認できません: ${setupErrorDetail(error)}`
      );
    }
    return setupItem(
      'codex',
      'Codex',
      'ok',
      version.text ? `利用可能: ${version.text} / app-server OK` : 'Codex CLI と app-server を確認できました',
      cfg.brain === 'codex' ? '' : 'Codexを使う場合はAIブレインをCodexに切り替えてください'
    );
  } catch (error) {
    return setupItem(
      'codex',
      'Codex',
      cfg.brain === 'codex' ? 'error' : 'warn',
      'Codex CLI を確認できません',
      `codex login と PATH 設定を確認してください: ${setupErrorDetail(error)}`
    );
  }
}

async function checkCaptureSetup() {
  try {
    const shot = await scr.captureScreenshot(captureTargetDisplay());
    if (shot && shot.file && fs.existsSync(shot.file)) {
      return setupItem('capture', '画面キャプチャ', 'ok', 'スクリーンショットを取得できます');
    }
    return setupItem('capture', '画面キャプチャ', 'error', 'スクリーンショットが空でした', '画面キャプチャ権限やディスプレイ接続を確認してください');
  } catch (e) {
    return setupItem('capture', '画面キャプチャ', 'error', '取得に失敗: ' + e.message, '画面キャプチャ権限やセキュリティソフトの制限を確認してください');
  }
}

async function runSetupDiagnostics() {
  const checks = [
    await checkCodexSetup(),
    await checkCaptureSetup()
  ];
  const status = summarizeSetupStatus(checks);
  const updatedAt = Date.now();
  updateRuntimeDiagnostics({
    setup: {
      status,
      checks,
      updatedAt
    }
  });
  logger.info('setup_diagnostics.completed', {
    status,
    checks: checks.map((check) => ({ id: check.id, status: check.status }))
  });
  return { status, checks, updatedAt };
}

function normalizeConfigPatch(patch) {
  const nextPatch = { ...(patch || {}) };
  const keyChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'openaiApiKey');
  const modelChanged = Object.prototype.hasOwnProperty.call(nextPatch, 'openaiSttModel');
  delete nextPatch.openaiApiKey;
  delete nextPatch.openaiApiKeyEncrypted;
  delete nextPatch.openaiSttModel;
  delete nextPatch.openaiSttUsdPerMin;
  delete nextPatch.openaiUsageMs;
  delete nextPatch.anthropic;
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'brain') && !['codex', 'mock'].includes(nextPatch.brain)) {
    nextPatch.brain = 'codex';
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'sttBackend') && nextPatch.sttBackend !== 'local') {
    nextPatch.sttBackend = 'local';
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'ngWords')) {
    nextPatch.ngWords = normalizeNgWords(nextPatch.ngWords);
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'ngMode') && !['drop', 'mask'].includes(nextPatch.ngMode)) {
    nextPatch.ngMode = 'drop';
  }
  return { nextPatch, keyChanged, modelChanged };
}

function afterConfigChanged(nextPatch, hadMulti, keyChanged, modelChanged) {
  updateRuntimeDiagnostics({
    ai: {
      requestedBrain: cfg.brain || 'codex'
    },
    stt: {
      backend: cfg.sttBackend || 'local',
      status: cfg.sttEnabled ? 'idle' : 'muted',
      message: cfg.sttEnabled ? '待機' : 'OFF'
    },
    safety: {
      shortcut: cfg.emergencyStopShortcut || 'F9'
    }
  });
  if (nextPatch && 'multiMonitor' in nextPatch && nextPatch.multiMonitor !== hadMulti) {
    createOverlays();
  } else {
    setOverlayStyle();
  }
  if (running) {
    clearInterval(captureTimer);
    captureTimer = setInterval(captureCycle, Math.max(3000, cfg.captureIntervalMs));
  }
}

function applyConfigPatch(patch) {
  const hadMulti = cfg.multiMonitor;
  const { nextPatch, keyChanged, modelChanged } = normalizeConfigPatch(patch);
  cfg = configStore.deepMerge(cfg, nextPatch);
  const saved = configStore.save(cfg);
  if (!saved) logger.error('config.save_failed', { keys: Object.keys(nextPatch) });
  afterConfigChanged(nextPatch, hadMulti, keyChanged, modelChanged);
  return publicConfig();
}

function replaceConfig(nextConfig) {
  const hadMulti = cfg.multiMonitor;
  cfg = configStore.defaultConfig();
  cfg = configStore.deepMerge(cfg, configStore.sanitizeImportedConfig(nextConfig || {}));
  const saved = configStore.save(cfg);
  if (!saved) logger.error('config.save_failed', { source: 'replaceConfig' });
  afterConfigChanged(cfg, hadMulti, true, true);
  return publicConfig();
}

function configDialogParent() {
  return controlWin && !controlWin.isDestroyed() ? controlWin : undefined;
}

function configExportPayload() {
  return {
    app: 'ji-danmaku',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    config: configStore.exportableConfig(cfg)
  };
}

async function exportConfigToFile() {
  const result = await dialog.showSaveDialog(configDialogParent(), {
    title: '設定をエクスポート',
    defaultPath: `ji-danmaku-config-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const payload = configExportPayload();
  fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  logger.info('config.exported', { file: result.filePath });
  return { canceled: false, file: result.filePath };
}

function parseImportedConfigFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const source = parsed && typeof parsed === 'object' && parsed.config && typeof parsed.config === 'object'
    ? parsed.config
    : parsed;
  const sanitized = configStore.sanitizeImportedConfig(source);
  if (!Object.keys(sanitized).length) throw new Error('有効な設定項目がありません');
  return sanitized;
}

async function importConfigFromFile() {
  const result = await dialog.showOpenDialog(configDialogParent(), {
    title: '設定をインポート',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return { canceled: true };
  try {
    const imported = parseImportedConfigFile(result.filePaths[0]);
    const next = applyConfigPatch(imported);
    logger.info('config.imported', { file: result.filePaths[0], keys: Object.keys(imported) });
    return { canceled: false, file: result.filePaths[0], config: next };
  } catch (e) {
    logger.warn('config.import_failed', { file: result.filePaths[0], message: e.message });
    return { canceled: false, error: e.message || '設定のインポートに失敗しました' };
  }
}

async function resetConfigToDefaults() {
  const result = await dialog.showMessageBox(configDialogParent(), {
    type: 'warning',
    buttons: ['リセット', 'キャンセル'],
    cancelId: 1,
    defaultId: 1,
    title: '設定をリセット',
    message: '設定を既定値に戻します',
    detail: '表示、音声、プライバシーなどの設定を既定値に戻します。'
  });
  if (result.response !== 0) return { canceled: true };
  const next = replaceConfig(configStore.defaultConfig());
  logger.warn('config.reset_to_defaults');
  return { canceled: false, config: next };
}

ipcMain.handle('set-config', (_e, patch) => {
  return applyConfigPatch(patch);
});

ipcMain.handle('toggle', (_e, on) => {
  if (on === undefined) on = !running;
  if (on) startRunning(); else stopRunning();
  return running;
});

ipcMain.handle('emergency-stop', (_e, reason) => {
  emergencyStop(reason || 'control');
  return true;
});

ipcMain.handle('test-comment', (_e, text) => {
  sendComments([{ text: text || 'テスト弾幕！888', style: { color: '#ffe14d', big: true } }], 'test');
  return true;
});

// コントロール画面(通常ウィンドウ)からマイク状態を受け取る。
ipcMain.on('mic', (_e, state) => {
  const prevTranscript = micState.transcript;
  micState = { ...micState, ...state };
  // 新しい文字起こしが届いたら時刻を記録し、発話ログに追記、即反応の生成を促す。
  if (state.transcript && state.transcript !== prevTranscript) {
    micState.transcriptAt = Date.now();
    transcriptLog.push({ text: state.transcript, at: micState.transcriptAt });
    if (transcriptLog.length > 8) transcriptLog.shift();
    triggerReactiveCycle();
  }
  // 発話の立ち上がり: フィラーONなら軽くざわつかせて即時感を出す。
  // どちらでも AI 生成は前倒しで促す（AI字幕は常に出す）。
  if (state.justSpoke && running) {
    if (cfg.ambientEnabled) {
      const n = 1 + Math.floor(Math.random() * 2);
      sendComments(ai.mock.generate(n, lastContext(), cfg.commentTone), 'voice');
    }
    triggerReactiveCycle();
  }
});

ipcMain.on('context-cache', (_e, c) => { if (c) _lastContext = c; });

// ---- アプリライフサイクル ----------------------------------------------

function summonExistingInstance() {
  logger.info('app.second_instance');
  if (app.isReady()) {
    summonControl();
    return;
  }
  app.whenReady().then(summonControl);
}

app.on('second-instance', summonExistingInstance);

app.whenReady().then(() => {
  logger.info('app.ready');
  createOverlays();
  createTray();
  createControl();

  // ディスプレイ着脱・解像度/配置変更に追従してオーバーレイを作り直す。
  screen.on('display-added', scheduleOverlayRebuild);
  screen.on('display-removed', scheduleOverlayRebuild);
  screen.on('display-metrics-changed', scheduleOverlayRebuild);

  // F8 で配信ON/OFF
  const f8Registered = globalShortcut.register('F8', () => {
    if (running) stopRunning(); else startRunning();
  });
  // F7 でコントロール画面を最前面に呼び出す（裏に隠れた時の救済）
  const f7Registered = globalShortcut.register('F7', summonControl);
  // F9 で緊急停止: 画面キャプチャ・弾幕送出・マイク監視を即停止する。
  const emergencyShortcut = cfg.emergencyStopShortcut || 'F9';
  const emergencyRegistered = globalShortcut.register(emergencyShortcut, () => emergencyStop('shortcut'));
  logger.info('shortcuts.registered', {
    f7: f7Registered,
    f8: f8Registered,
    emergency: emergencyRegistered,
    emergencyShortcut
  });
  // 起動時にも一度前面化して見失いを防ぐ
  setTimeout(summonControl, 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlays();
      createControl();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  logger.info('app.will_quit');
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  try { require('./ai/codex').shutdown(); } catch {}
});
app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});
