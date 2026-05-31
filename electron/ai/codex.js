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
//  - スクリーンショットは localImage 入力として渡し、画面を見て弾幕を生成させる。
//  - effort=low で低レイテンシ・低コスト。

const { spawn } = require('child_process');
const { extractJson, normalizeComments } = require('./json-comments');

const CODEX_BIN = process.platform === 'win32' ? 'codex.cmd' : 'codex';

function buildPrompt({ count, context, transcript, recent, voiceFocus, voiceOnly }) {
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
    'ニコニコ動画のように流れる短い弾幕コメントを、いろんな視聴者がリアルタイムに',
    '書き込んでいる体で生成してください。',
    '',
    ...focus,
    '',
    '出し方:',
    `- ${count}個ちょうど。1個ずつ別人が書いた体で、口調もテンションもバラけさせる`,
    '- 各コメントは日本語で最大20文字程度、口語で短く(ライブチャット感)',
    '- 反応の種類を混ぜる: ツッコミ / 共感(わかる・それな) / 質問 / 感心 / 実況 /',
    '  軽いイジり / ネットスラング(w・草・888・kawaii)',
    '- 同じ語の連発を避け、大勢が見ている多様さを出す',
    '- 煽り/誹謗中傷/不適切表現はNG。明るく楽しいノリ',
    '- たまに color(例 "#ff5b5b")/big:true/small:true/pos:"ue"・"shita" で変化を付ける(各1割以内)',
    '',
    // 声100%(voiceOnly)では画面文脈(前面アプリ名)も渡さない。
    ...(voiceOnly ? [] : [ctxLine]),
    ...(avoidLine ? [avoidLine] : []),
    '',
    'ツールやコマンドは一切使わず、最終メッセージで以下の形の JSON だけを返す:',
    '{"comments":[{"text":"わかるw"},{"text":"それなww"},{"text":"888","color":"#ffe14d"},{"text":"ここ好き","pos":"ue"}]}'
  ].join('\n');
}

// ---- 常駐 app-server クライアント -------------------------------------

class AppServer {
  constructor() {
    this.child = null;
    this.buf = '';
    this.nextId = 0;
    this.pending = new Map();      // id -> {resolve}
    this.turnHandler = null;       // 進行中の turn 通知の受け手
    this.ready = null;             // initialize 完了の Promise
  }

  // 既に起動済みなら再利用。落ちていたら起動し直す。
  async ensure() {
    if (this.child && !this.child.killed && this.ready) {
      try { await this.ready; return; } catch { /* 再起動へ */ }
    }
    this.start();
    await this.ready;
  }

  start() {
    this.buf = '';
    this.pending.clear();
    this.turnHandler = null;

    const child = spawn(CODEX_BIN, ['app-server'], { shell: true, windowsHide: true });
    this.child = child;

    child.stdout.on('data', (d) => this._onData(d));
    child.stderr.on('data', () => { /* モデル一覧取得失敗等のノイズは無視 */ });
    child.on('exit', () => {
      this.child = null;
      this.ready = null;
      for (const { reject } of this.pending.values()) reject(new Error('app-server exited'));
      this.pending.clear();
    });
    child.on('error', () => { this.child = null; this.ready = null; });

    // ハンドシェイク: initialize → initialized
    this.ready = (async () => {
      await this._request('initialize', {
        clientInfo: { name: 'ji-danmaku', title: 'Ji-Danmaku', version: '0.1.0' },
        capabilities: { experimentalApi: true, requestAttestation: false }
      });
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
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(JSON.stringify(m.error).slice(0, 200)));
        else p.resolve(m.result);
      }
      return;
    }
    // サーバ発のリクエスト(承認要求など)。弾幕用途では使わないので一律拒否して握りつぶす。
    if (m.id !== undefined && m.method) {
      this._send({ id: m.id, error: { code: -32601, message: 'not supported' } });
      return;
    }
    // 通知 → 進行中 turn のハンドラへ
    if (m.method && this.turnHandler) this.turnHandler(m);
  }

  _send(obj) {
    if (!this.child || !this.child.stdin.writable) return;
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }

  _request(method, params) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this._send({ method, id, params });
    });
  }

  _notify(method, params) {
    this._send(params === undefined ? { method } : { method, params });
  }

  // 1回の生成: ephemeral スレッド + turn を回し、エージェントの最終メッセージを返す。
  async runTurn({ promptText, imagePath, model, timeoutMs }) {
    await this.ensure();

    const thread = await this._request('thread/start', {
      sandbox: 'read-only',
      ephemeral: true,
      cwd: process.cwd(),
      ...(model ? { model } : {})
    });
    const threadId =
      (thread && thread.thread && thread.thread.id) || (thread && thread.threadId);
    if (!threadId) throw new Error('thread/start: no id');

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
        finish(finalText || acc); // 取れた分だけ返す（無ければ後段で mock）
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

      this._request('turn/start', {
        threadId,
        input,
        effort: 'low'
      }).catch((e) => finish(null, e));
    });
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
    console.error(`[codex] ${maxFailures}回連続失敗 → ${Math.round((backoffMs || 30000) / 1000)}秒バックオフ。その間はmock弾幕で継続します。`);
  }
}

// 戻り値: [{ text, style:{color?,big?} }, ...]  失敗/抑制時は null（main側でmockへフォールバック）
async function generate({ count, context, transcript, imagePath, recent, voiceFocus, voiceOnly, model, timeoutMs, minIntervalMs, maxFailures, backoffMs }) {
  if (busy) return null;                                   // 多重実行を防止（main 側でもガード済み）
  const now = Date.now();
  if (now < backoffUntil) return null;                     // バックオフ中はスキップ
  if (minIntervalMs && now - lastGenAt < minIntervalMs) return null;  // レート制御
  busy = true;
  lastGenAt = now;
  try {
    const promptText = buildPrompt({ count, context, transcript, recent, voiceFocus, voiceOnly });
    const text = await server.runTurn({ promptText, imagePath, model, timeoutMs });
    const parsed = extractJson(text || '');
    if (!parsed) {
      warnOnce('JSON を取得できませんでした');
      noteFailure(maxFailures, backoffMs);
      return null;
    }
    consecutiveFails = 0;   // 成功 → 失敗カウントをリセット
    return normalizeComments(parsed);
  } catch (e) {
    warnOnce(e.message);
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
    '\n  -> `codex login` 済みか確認してください。mock弾幕で継続します。');
}

// アプリ終了時にサーバを落とすためのフック。
function shutdown() {
  try { if (server.child) server.child.kill(); } catch {}
}

function status() {
  const now = Date.now();
  return {
    serverRunning: !!(server.child && !server.child.killed),
    busy,
    warned,
    consecutiveFails,
    backoffRemainingMs: Math.max(0, backoffUntil - now),
    lastGenAt
  };
}

module.exports = { generate, shutdown, status };
