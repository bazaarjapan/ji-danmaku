'use strict';

const { app, BrowserWindow, ipcMain, screen, globalShortcut } = require('electron');
const path = require('path');
const os = require('os');
const configStore = require('./config');
const scr = require('./screen');
const ai = require('./ai');

let overlayWins = [];         // 各ディスプレイのオーバーレイ（マルチモニター対応）
let controlWin = null;
let cfg = configStore.load();

let running = false;          // 弾幕配信ON/OFF
let captureTimer = null;      // AI生成ループ
let ambientTimer = null;      // アンビエント弾幕ループ
let micState = { level: 0, speaking: false, transcript: '' };
let transcriptLog = [];    // 直近の発話ログ { text, at }（話題追従の文脈用）
let lastBatchAt = 0;       // 直近の生成サイクル開始時刻（反応トリガのデバウンス用）
let lastAiCommentAt = 0;   // 直近にAI弾幕を画面へ流した時刻（アンビエント抑制用）

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
  controlWin.on('closed', () => { controlWin = null; });
}

// ---- 弾幕送出 ----------------------------------------------------------

// AIコメントの重複抑制用: 直近に流したテキストをローリング保持する。
// アンビエント/発話ざわめき(www/草/888)は"群衆らしい繰り返し"なので対象外。
let recentAi = [];               // { n: 正規化テキスト, text: 原文, at: 時刻 }
const RECENT_AI_TTL = 45000;     // 45秒以内は重複とみなす

function normText(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[。、!！?？w～~ー]+$/g, '');
}

// 'ai' バッチからバッチ内＋直近窓の重複を除去する。
function dedupeAi(comments) {
  const now = Date.now();
  recentAi = recentAi.filter((r) => now - r.at < RECENT_AI_TTL);
  const seen = new Set(recentAi.map((r) => r.n));
  const out = [];
  for (const c of comments) {
    const n = normText(c.text);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    recentAi.push({ n, text: c.text, at: now });
    out.push(c);
  }
  return out;
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
  const words = (cfg.ngWords || []).filter(Boolean);
  if (!words.length) return comments;
  const mask = cfg.ngMode === 'mask';
  const out = [];
  for (const c of comments) {
    const t = c.text || '';
    if (!words.some((w) => t.includes(w))) { out.push(c); continue; }
    if (mask) {
      let m = t;
      for (const w of words) m = m.split(w).join('〇'.repeat([...w].length));
      out.push({ ...c, text: m });
    }
    // drop: 何もpushしない（除外）
  }
  return out;
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
    maxOnScreen: cfg.maxOnScreen
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
    // 発話中はテンポ良く複数、通常は1個ずつ。
    const burst = speaking ? 3 : 1;
    const chunk = dripQueue.splice(0, burst);
    sendComments(chunk, 'ai');
    lastAiCommentAt = Date.now();
    let gap;
    if (speaking) {
      gap = 250;
    } else {
      // 残り時間を残り個数で均等割り（0.5〜3秒にクランプ）し、自然なゆらぎを足す。
      const remain = Math.max(0, dripDeadline - Date.now());
      const per = remain / Math.max(1, dripQueue.length);
      gap = Math.min(3000, Math.max(500, per)) * (0.85 + Math.random() * 0.3);
    }
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
    const shot = await scr.captureScreenshot(captureTargetDisplay());
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
    let count;
    if (voiceFocus) {
      count = cfg.commentsPerBatch || 10;
    } else {
      count = Math.round((cfg.commentsPerBatchScreen ?? 4) * (100 - vr) / 100);
      if (count < 1) {
        // 声100%(画面弾幕なし)設定で発話も無い → 今回は生成しない。
        if (controlWin) controlWin.webContents.send('status', { idle: true, lastContext: context });
        return;   // cycleBusy 解除と reactivePending 処理は finally が行う
      }
    }
    const { source, comments } = await ai.generateBatch(cfg, { context, transcript, imagePath, recent, count, voiceFocus });
    // 生成中に停止された場合は結果を破棄（停止後にUIが「配信中」へ戻ったり弾幕が出るのを防ぐ）。
    if (!running) return;
    if (controlWin) controlWin.webContents.send('status', { brain: source, idle: false, lastContext: context });
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
    sendComments(ai.mock.generate(n, lastContext()), 'ambient');
  }
  // ループは running 中は維持し、チェック/スライダー変更を即反映する。
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
  clearTimeout(reactiveTimer); reactiveTimer = null;
  reactivePending = false;
  dripQueue = [];
  lastEnqueueAt = 0;
  dripDeadline = 0;
  recentAi = [];
  transcriptLog = [];
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
  const hadMulti = cfg.multiMonitor;
  cfg = configStore.deepMerge(cfg, patch || {});
  configStore.save(cfg);
  // マルチモニター設定が変わったらオーバーレイを作り直す（スタイルは生成側で再送）。
  if (patch && 'multiMonitor' in patch && patch.multiMonitor !== hadMulti) {
    createOverlays();
  } else {
    setOverlayStyle();
  }
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
      sendComments(ai.mock.generate(n, lastContext()), 'voice');
    }
    triggerReactiveCycle();
  }
});

ipcMain.on('context-cache', (_e, c) => { if (c) _lastContext = c; });

// ---- アプリライフサイクル ----------------------------------------------

app.whenReady().then(() => {
  createOverlays();
  createControl();

  // ディスプレイ着脱・解像度/配置変更に追従してオーバーレイを作り直す。
  screen.on('display-added', scheduleOverlayRebuild);
  screen.on('display-removed', scheduleOverlayRebuild);
  screen.on('display-metrics-changed', scheduleOverlayRebuild);

  // F8 で配信ON/OFF、F9 でクリック透過の一時解除トグル（デバッグ用）
  globalShortcut.register('F8', () => {
    if (running) stopRunning(); else startRunning();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createOverlays();
      createControl();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { require('./ai/codex').shutdown(); } catch {}
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
