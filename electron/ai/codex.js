'use strict';

// Codex をブレインに使うアダプタ（codex app-server 方式）。
//
// 方針:
//  - `codex app-server`（JSON-RPC / stdio）を【1本だけ常駐】させて使い回す。
//    毎回 `codex exec` を起動しないので軽量・高速。
//  - 認証は既存の `codex login`（ChatGPT/Codex サブスク）をそのまま利用するため、
//    API 従量課金のような【追加料金は発生しない】。
//  - 1回の生成ごとに ephemeral スレッドを作って turn を1回回すだけ。
//    履歴を溜めない＝毎回の入力トークンを最小に保ち、コストを抑える。
//  - スクリーンショットは localImage 入力として渡し、画面を見て短いリアクションを生成させる。
//  - effort=low で低レイテンシ・低コスト。

const { spawn } = require('child_process');
const { extractJson, normalizeComments } = require('./json-comments');
const { toneInstruction } = require('./comment-tone');
const logger = require('../logger');
const { codexCommandCandidates, codexCommandTarget } = require('../codex-command');

const DEFAULT_TURN_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_FLOOR_MS = 5000;
const SERVER_RESTART_GRACE_MS = 5000;
const MAX_TURNS_PER_SERVER = 24;
const MAX_SERVER_AGE_MS = 10 * 60 * 1000;

function buildPrompt({ count, context, transcript, recent, voiceFocus, voiceOnly, tone }) {
  const ctxLine = context && (context.title || context.process)
    ? `前面アプリ: ${context.process || ''} / ウィンドウ: ${context.title || ''}`
    : '前面アプリ情報なし';
  const avoidLine = recent && recent.length
    ? `直前に流れたコメント(繰り返さず、別の切り口で): ${recent.slice(-12).join(' / ')}`
    : '';

  // voiceOnly=声100%は画面情報を一切使わず発言のみ。voiceFocus=声主役+画面補助。発話なし=画面のみ。
  const focus = voiceOnly
    ? [
        `配信者の発話(自動文字起こし・誤認識を含む可能性あり): 「${transcript}」`,
        '→ 画面は一切見ず、この【発言だけ】に視聴者として反応してください。',
        '   文字を鵜呑みにせず文脈から意図を推測して反応(同意/ツッコミ/返答/笑い/共感)。',
        '   意味が取れない時は一般的な相づち程度に留め、画面の話には触れないこと。',
        '   オウム返しは正しく聞き取れたと思える時だけ。'
      ]
    : (voiceFocus && transcript)
    ? [
        `配信者の発話(自動文字起こし・誤認識を含む可能性あり): 「${transcript}」`,
        '→ これは音声認識の生テキストで、誤変換・聞き間違いが混じることがあります。',
        '   文字を鵜呑みにせず、まず添付スクショと文脈から【配信者が実際に言いたかった意図】を',
        '   推測し、その"意図"に視聴者として反応してください',
        '   (同意 / ツッコミ / 質問への返答 / 笑い / 共感 / 茶化し)。',
        '   意味が取れない・ノイズっぽい時は無理に拾わず、画面の話題に寄せてOK。',
        '   オウム返しは正しく聞き取れたと思える時だけにする。'
      ]
    : [
        '配信者の発話は今ありません。',
        '添付スクショの画面を見て、画面の"今"に触れるコメントを【控えめに】作ってください',
        '（出しすぎない・静かめでよい）。'
      ];

  return [
    'あなたはライブ配信を【今まさに見ている大勢の匿名視聴者】です。',
    '短い画面リアクションを、複数の参加者がリアルタイムに',
    '反応している体で生成してください。特定サービスの表示様式は模倣しないでください。',
    '',
    ...focus,
    '',
    '出し方:',
    `- トーン: ${toneInstruction(tone)}`,
    `- ${count}個ちょうど。1個ずつ別人が書いた体で、口調もテンションもバラけさせる`,
    '- 各コメントは日本語で最大20文字程度、口語で短く(ライブチャット感)',
    '- 反応の種類を混ぜる: ツッコミ / 共感(わかる・それな) / 質問 / 感心 / 実況 /',
    '  軽いイジり / ネットスラング(w・草・888・kawaii)',
    '- 同じ語の連発を避け、大勢が見ている多様さを出す',
    '- 煽り/誹謗中傷/不適切表現はNG。明るく楽しいノリ',
    '- たまに color(例 "#ff5b5b")/big:true/small:true で変化を付ける(各1割以内)',
    '',
    // 声100%(voiceOnly)では画面文脈(前面アプリ名)も渡さない。
    ...(voiceOnly ? [] : [ctxLine]),
    ...(avoidLine ? [avoidLine] : []),
    '',
    'ツールやコマンドは一切使わず、最終メッセージで以下の形の JSON だけを返す:',
    '{"comments":[{"text":"わかるw"},{"text":"それなww"},{"text":"888","color":"#ffe14d"},{"text":"ここ好き"}]}'
  ].join('\n');
}

// ---- 常駐 app-server クライアント -------------------------------------

class AppServer {
  constructor() {
    this.child = null;
    this.buf = '';
    this.nextId = 0;
    this.pending = new Map();      // id -> {resolve, reject, timer, method}
    this.turnHandler = null;       // 進行中の turn 通知の受け手
    this.ready = null;             // initialize 完了の Promise
    this.threadId = '';
    this.threadModel = '';
    this.threadKey = '';
    this.startedAt = 0;
    this.turnsOnServer = 0;
    this.restartCount = 0;
  }

  // 既に起動済みなら再利用。落ちていたら起動し直す。
  async ensure(timeoutMs) {
    if (this.child && !this.child.killed && this.ready) {
      try {
        await this.ready;
        return;
      } catch (e) {
        this.restart(`ready failed: ${e.message}`);
      }
    }
    await this.startWithFallback(timeoutMs);
  }

  async startWithFallback(timeoutMs, commands = codexCommandCandidates()) {
    let lastError = null;
    for (const command of commands) {
      this.start(timeoutMs, command);
      try {
        await this.ready;
        return;
      } catch (error) {
        lastError = error;
        if (this.child) this.restart(`app-server start failed: ${error.message}`);
      }
    }
    throw lastError || new Error('app-server start failed');
  }

  start(timeoutMs, command) {
    this.buf = '';
    this._rejectPending(new Error('app-server restarting'));
    this.turnHandler = null;
    this.threadId = '';
    this.threadModel = '';
    this.threadKey = '';
    this.turnsOnServer = 0;

    const target = codexCommandTarget(command, ['app-server']);
    const child = spawn(target.command, target.args, { ...appServerSpawnOptions(), ...target.options });
    this.child = child;
    this.startedAt = Date.now();

    child.stdout.on('data', (d) => this._onData(d));
    child.stderr.on('data', () => { /* モデル一覧取得失敗等のノイズは無視 */ });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = null;
      this.threadId = '';
      this.threadModel = '';
      this.threadKey = '';
      this._rejectPending(new Error('app-server exited'));
    });
    child.on('error', () => {
      if (this.child !== child) return;
      this.child = null;
      this.ready = null;
      this.threadId = '';
      this.threadModel = '';
      this.threadKey = '';
      this._rejectPending(new Error('app-server error'));
    });

    // ハンドシェイク: initialize → initialized
    this.ready = (async () => {
      await this._request('initialize', {
        clientInfo: { name: 'ji-reaction-overlay', title: 'Ji-Reaction', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false }
      }, requestTimeoutMs(timeoutMs));
      this._notify('initialized');
    })();
  }

  _onData(d) {
    this.buf += d.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      this._dispatch(m);
    }
  }

  _dispatch(m) {
    // リクエストへの応答
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
      const p = this.pending.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error).slice(0, 200)));
        else p.resolve(m.result);
      }
      return;
    }
    // サーバ発のリクエスト(承認要求など)。リアクション用途では使わないので一律拒否して握りつぶす。
    if (m.id !== undefined && m.method) {
      this._send({ id: m.id, error: { code: -32601, message: 'not supported' } });
      return;
    }
    // 通知 → 進行中 turn のハンドラへ
    if (m.method && this.turnHandler) this.turnHandler(m);
  }

  _send(obj) {
    if (!this.child || !this.child.stdin.writable) return false;
    this.child.stdin.write(JSON.stringify(obj) + '\n');
    return true;
  }

  _request(method, params, timeoutMs = DEFAULT_TURN_TIMEOUT_MS) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        const err = new Error(`${method} timeout after ${timeoutMs}ms`);
        err.code = 'CODEX_REQUEST_TIMEOUT';
        reject(err);
      }, Math.max(REQUEST_TIMEOUT_FLOOR_MS, timeoutMs));
      this.pending.set(id, { resolve, reject, timer, method });
      if (!this._send({ method, id, params })) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('app-server stdin not writable'));
      }
    });
  }

  _notify(method, params) {
    this._send(params === undefined ? { method } : { method, params });
  }

  // app-server 内の ephemeral スレッドを短時間だけ再利用し、子プロセス増殖を抑える。
  // 生成が詰まった場合は runTurn 全体のタイムアウトで app-server ツリーごと再起動する。
  async runTurn({ promptText, imagePath, model, timeoutMs, voiceOnly }) {
    const limitMs = turnTimeoutMs(timeoutMs);
    try {
      return await withTimeout(
        this._runTurn({ promptText, imagePath, model, timeoutMs: limitMs, voiceOnly }),
        limitMs + SERVER_RESTART_GRACE_MS,
        'codex app-server turn'
      );
    } catch (e) {
      this.restart(`turn failed: ${e.message}`);
      throw e;
    }
  }

  async _runTurn({ promptText, imagePath, model, timeoutMs, voiceOnly }) {
    if (this.shouldRecycle()) this.restart('scheduled recycle');
    await this.ensure(timeoutMs);

    const threadId = await this.ensureThread({ model, timeoutMs, voiceOnly });

    const input = [{ type: 'text', text: promptText, text_elements: [] }];
    if (imagePath) input.push({ type: 'localImage', path: imagePath });

    return await new Promise((resolve, reject) => {
      let finalText = '';
      let acc = '';
      let settled = false;
      const finish = (val, err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.turnHandler = null;
        if (err) reject(err); else resolve(val);
      };

      const timer = setTimeout(() => {
        try { this._notify('turn/interrupt', { threadId }); } catch {}
        const err = new Error(`turn/start timeout after ${timeoutMs}ms`);
        err.code = 'CODEX_TURN_TIMEOUT';
        finish(finalText || acc, err);
      }, timeoutMs || 60000);

      this.turnHandler = (m) => {
        switch (m.method) {
          case 'item/agentMessage/delta':
            acc += (m.params && m.params.delta) || '';
            break;
          case 'item/completed':
            if (m.params && m.params.item && m.params.item.type === 'agentMessage') {
              finalText = m.params.item.text || finalText;
            }
            break;
          case 'turn/completed':
            finish(finalText || acc);
            break;
          case 'error':
            finish(finalText || acc, new Error(JSON.stringify(m.params).slice(0, 200)));
            break;
        }
      };

      try {
        this._request('turn/start', {
          threadId,
          input,
          effort: 'low'
        }, requestTimeoutMs(timeoutMs)).catch((e) => finish(null, e));
      } catch (e) {
        finish(null, e);
      }
    });
  }

  async ensureThread({ model, timeoutMs, voiceOnly }) {
    const threadKey = `${model || ''}:${voiceOnly ? 'voice-only' : 'screen-aware'}`;
    if (this.threadId && this.threadKey === threadKey) return this.threadId;
    const thread = await this._request('thread/start', {
      sandbox: 'read-only',
      ephemeral: true,
      cwd: process.cwd(),
      ...(model ? { model } : {})
    }, requestTimeoutMs(timeoutMs));
    const threadId =
      (thread && thread.thread && thread.thread.id) || (thread && thread.threadId);
    if (!threadId) throw new Error('thread/start: no id');
    this.threadId = threadId;
    this.threadModel = model || '';
    this.threadKey = threadKey;
    this.turnsOnServer = 0;
    return threadId;
  }

  markTurnCompleted() {
    this.turnsOnServer++;
  }

  shouldRecycle(now = Date.now()) {
    if (!this.child || this.child.killed) return false;
    if (this.turnsOnServer >= MAX_TURNS_PER_SERVER) return true;
    return this.startedAt > 0 && now - this.startedAt >= MAX_SERVER_AGE_MS;
  }

  restart(reason = 'restart') {
    const child = this.child;
    const pid = child && child.pid;
    this.restartCount++;
    this.child = null;
    this.ready = null;
    this.threadId = '';
    this.threadModel = '';
    this.threadKey = '';
    this.turnHandler = null;
    this.buf = '';
    this.turnsOnServer = 0;
    this._rejectPending(new Error(reason));
    if (pid) {
      logger.warn('codex.app_server_restart', { reason, pid, restartCount: this.restartCount });
      killProcessTree(pid);
    }
  }

  _rejectPending(err) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }

  status() {
    return {
      serverRunning: !!(this.child && !this.child.killed),
      pid: this.child && this.child.pid ? this.child.pid : 0,
      pendingRequests: this.pending.size,
      threadActive: !!this.threadId,
      turnsOnServer: this.turnsOnServer,
      startedAt: this.startedAt,
      restartCount: this.restartCount
    };
  }
}

function turnTimeoutMs(timeoutMs) {
  return Math.max(REQUEST_TIMEOUT_FLOOR_MS, timeoutMs || DEFAULT_TURN_TIMEOUT_MS);
}

function requestTimeoutMs(timeoutMs) {
  return Math.max(REQUEST_TIMEOUT_FLOOR_MS, Math.min(turnTimeoutMs(timeoutMs), 30000));
}

function appServerSpawnOptions(platform = process.platform) {
  if (platform === 'win32') return { windowsHide: true };
  return { detached: true, windowsHide: true };
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`${label} timeout after ${timeoutMs}ms`);
        err.code = 'CODEX_TOTAL_TIMEOUT';
        reject(err);
      }, timeoutMs);
    })
  ]);
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => {});
    killer.unref();
    return;
  }
  signalProcessTree(pid, 'SIGTERM');
  setTimeout(() => signalProcessTree(pid, 'SIGKILL'), 1500).unref();
}

function signalProcessTree(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch {}
  }
}

const server = new AppServer();
let warned = false;
let busy = false;            // app-server は1ターンずつ処理
let lastGenAt = 0;           // 直近の生成開始時刻（レート制御）
let consecutiveFails = 0;    // 連続失敗カウント
let backoffUntil = 0;        // この時刻まで生成をスキップ（バックオフ）

function noteFailure(maxFailures, backoffMs) {
  consecutiveFails++;
  if (maxFailures && consecutiveFails >= maxFailures) {
    backoffUntil = Date.now() + (backoffMs || 30000);
    consecutiveFails = 0;
    console.error(`[codex] ${maxFailures}回連続失敗 → ${Math.round((backoffMs || 30000) / 1000)}秒バックオフ。その間はmockリアクションで継続します。`);
  }
}

// 戻り値: [{ text, style:{color?,big?} }, ...]  失敗/抑制時は null（main側でmockへフォールバック）
async function generate({ count, context, transcript, imagePath, recent, voiceFocus, voiceOnly, tone, model, timeoutMs, minIntervalMs, maxFailures, backoffMs }) {
  if (busy) return null;                                   // 多重実行を防止（main 側でもガード済み）
  const now = Date.now();
  if (now < backoffUntil) return null;                     // バックオフ中はスキップ
  if (minIntervalMs && now - lastGenAt < minIntervalMs) return null;  // レート制御
  busy = true;
  lastGenAt = now;
  try {
    const promptText = buildPrompt({ count, context, transcript, recent, voiceFocus, voiceOnly, tone });
    const text = await server.runTurn({ promptText, imagePath, model, timeoutMs, voiceOnly });
    server.markTurnCompleted();
    const parsed = extractJson(text || '');
    if (!parsed) {
      warnOnce('JSON を取得できませんでした');
      noteFailure(maxFailures, backoffMs);
      return null;
    }
    consecutiveFails = 0;   // 成功 → 失敗カウントをリセット
    warned = false;
    return normalizeComments(parsed);
  } catch (e) {
    warnOnce(e.message);
    logger.error('codex.generate_failed', { message: e.message, code: e.code || '' });
    noteFailure(maxFailures, backoffMs);
    return null;
  } finally {
    busy = false;
  }
}

function warnOnce(msg) {
  if (warned) return;
  warned = true;
  console.error('[codex/app-server] 生成失敗(初回のみ表示):', String(msg).slice(0, 200),
    '\n  -> `codex login` 済みか確認してください。mockリアクションで継続します。');
}

// アプリ終了時にサーバを落とすためのフック。
function shutdown() {
  try { server.restart('shutdown'); } catch {}
}

function status() {
  const now = Date.now();
  return {
    ...server.status(),
    busy,
    warned,
    consecutiveFails,
    backoffRemainingMs: Math.max(0, backoffUntil - now),
    lastGenAt
  };
}

module.exports = {
  generate,
  shutdown,
  status,
  __test: {
    AppServer,
    appServerSpawnOptions,
    requestTimeoutMs,
    turnTimeoutMs,
    withTimeout
  }
};
