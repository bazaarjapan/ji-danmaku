'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const configStore = require('./config');
const scr = require('./screen');
const ai = require('./ai');

let overlayWin = null;
let controlWin = null;
let cfg = configStore.load();

let running = false;          // 弾幕配信ON/OFF
let captureTimer = null;      // AI生成ループ
let ambientTimer = null;      // アンビエント弾幕ループ
let micState = { level: 0, speaking: false, transcript: '' };
let lastBatchAt = 0;

// ---- ウィンドウ生成 ----------------------------------------------------

function createOverlay() {
  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.bounds;

  overlayWin = new BrowserWindow({
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
      nodeIntegration: false
    }
  });

  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // クリック透過: 弾幕は完全に「上を流れるだけ」で操作を邪魔しない。
  overlayWin.setIgnoreMouseEvents(true, { forward: true });
  // 自分が流した弾幕を画面キャプチャから除外する（Windows: WDA_EXCLUDEFROMCAPTURE）。
  // これにより (1) アイドル検知の画面署名が自分の弾幕の動きで汚れない、
  //          (2) AIブレインへ渡すスクショに自分の弾幕が写り込まず、実画面だけに反応できる。
  // ユーザーの目には弾幕は通常どおり表示される（キャプチャ系ツールにのみ非表示）。
  overlayWin.setContentProtection(true);
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));

  overlayWin.on('closed', () => { overlayWin = null; });
}

function createControl() {
  controlWin = new BrowserWindow({
    width: 420,
    height: 600,
    title: 'Ji-Danmaku コントロール',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlWin.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'));
  controlWin.on('closed', () => { controlWin = null; });
}

// ---- 弾幕送出 ----------------------------------------------------------

function sendComments(comments, source) {
  if (!overlayWin || !comments || !comments.length) return;
  overlayWin.webContents.send('danmaku', { comments, source });
}

function setOverlayStyle() {
  if (!overlayWin) return;
  overlayWin.webContents.send('style', {
    fontSize: cfg.fontSize,
    speedMs: cfg.speedMs,
    opacity: cfg.opacity,
    maxOnScreen: cfg.maxOnScreen
  });
}

// AI生成バッチを間隔内で少しずつ流す（連続感を出す）。
let dripQueue = [];
let dripTimer = null;

function enqueueDrip(comments) {
  dripQueue.push(...comments);
  if (dripTimer) return;
  const tick = () => {
    if (!running || !dripQueue.length) {
      clearTimeout(dripTimer);
      dripTimer = null;
      return;
    }
    // 発話中はテンポ良く、通常は穏やかに
    const burst = micState.speaking ? 3 : 1;
    const chunk = dripQueue.splice(0, burst);
    sendComments(chunk, 'ai');
    const gap = micState.speaking ? 250 : 700 + Math.random() * 600;
    dripTimer = setTimeout(tick, gap);
  };
  tick();
}

// ---- ループ ------------------------------------------------------------

let cycleBusy = false;
let prevSignature = null;   // 前サイクルの画面署名（アイドル検知用）
let idleStreak = 0;         // 「変化なし」連続回数

async function captureCycle() {
  if (!running || cycleBusy) return;  // 生成中なら今回の発火はスキップ（プロセス重複防止）
  cycleBusy = true;
  lastBatchAt = Date.now();
  let context = { title: '', process: '' };
  let imagePath = null;
  let signature = null;
  try {
    context = await scr.getForegroundWindow();
    _lastContext = context;
  } catch {}
  try {
    const shot = await scr.captureScreenshot();
    if (shot) { imagePath = shot.file; signature = shot.signature; }
  } catch (e) {
    console.error('[capture] screenshot失敗:', e.message);
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
        if (controlWin) controlWin.webContents.send('status', { idle: true, lastContext: context });
        cycleBusy = false;
        return;
      }
    } else {
      idleStreak = 0;  // 変化/発話を検知 → 即再開
    }
  }

  const transcript = speaking ? micState.transcript : '';
  try {
    const { source, comments } = await ai.generateBatch(cfg, { context, transcript, imagePath });
    // 生成中に停止された場合は結果を破棄（停止後にUIが「配信中」へ戻ったり弾幕が出るのを防ぐ）。
    if (!running) return;
    if (controlWin) controlWin.webContents.send('status', { brain: source, idle: false, lastContext: context });
    enqueueDrip(comments);
  } finally {
    cycleBusy = false;
  }
}

function ambientTick() {
  if (!running || !cfg.ambientPerMinute) return;
  // 1分あたり ambientPerMinute 個 → 平均間隔。発話中は密度UP。
  const base = 60000 / cfg.ambientPerMinute;
  const factor = micState.speaking ? 0.4 : 1;
  const n = micState.speaking ? 2 : 1;
  const comments = ai.mock.generate(n, lastContext());
  sendComments(comments, 'ambient');
  ambientTimer = setTimeout(ambientTick, base * factor * (0.6 + Math.random() * 0.8));
}

let _lastContext = { title: '', process: '' };
function lastContext() { return _lastContext; }

function startRunning() {
  if (running) return;
  running = true;
  setOverlayStyle();
  captureCycle();
  captureTimer = setInterval(captureCycle, Math.max(3000, cfg.captureIntervalMs));
  ambientTick();
  broadcastRunning();
}

function stopRunning() {
  running = false;
  clearInterval(captureTimer); captureTimer = null;
  clearTimeout(ambientTimer); ambientTimer = null;
  clearTimeout(dripTimer); dripTimer = null;
  dripQueue = [];
  prevSignature = null;
  idleStreak = 0;
  broadcastRunning();
}

function broadcastRunning() {
  if (controlWin) controlWin.webContents.send('running', running);
}

// ---- IPC ---------------------------------------------------------------

ipcMain.handle('get-config', () => cfg);

ipcMain.handle('set-config', (_e, patch) => {
  cfg = configStore.deepMerge(cfg, patch || {});
  configStore.save(cfg);
  setOverlayStyle();
  // 間隔変更を反映
  if (running) {
    clearInterval(captureTimer);
    captureTimer = setInterval(captureCycle, Math.max(3000, cfg.captureIntervalMs));
  }
  return cfg;
});

ipcMain.handle('toggle', (_e, on) => {
  if (on === undefined) on = !running;
  if (on) startRunning(); else stopRunning();
  return running;
});

ipcMain.handle('test-comment', (_e, text) => {
  sendComments([{ text: text || 'テスト弾幕！888', style: { color: '#ffe14d', big: true } }], 'test');
  return true;
});

// コントロール画面(通常ウィンドウ)からマイク状態を受け取る。
ipcMain.on('mic', (_e, state) => {
  micState = { ...micState, ...state };
  // 発話の立ち上がりでリアクションを軽く盛る
  if (state.justSpoke && running) {
    const n = 2 + Math.floor(Math.random() * 3);
    sendComments(ai.mock.generate(n, lastContext()), 'voice');
  }
});

ipcMain.on('context-cache', (_e, c) => { if (c) _lastContext = c; });

// ---- アプリライフサイクル ----------------------------------------------

app.whenReady().then(() => {
  createOverlay();
  createControl();

  // F8 で配信ON/OFF、F9 でクリック透過の一時解除トグル（デバッグ用）
  globalShortcut.register('F8', () => {
    if (running) stopRunning(); else startRunning();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlay();
      createControl();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { require('./ai/codex').shutdown(); } catch {}
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
