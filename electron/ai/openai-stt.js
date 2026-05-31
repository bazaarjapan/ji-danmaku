'use strict';

// OpenAI Realtime API(GA) の文字起こしクライアント。
// 発話の区切りごとに音声(pcm16 24kHz)を append + commit して、
// conversation.item.input_audio_transcription.completed の transcript を得る。
// turn_detection: null で手動コミット＝発話のたびにだけ送る＝「声に反応する間だけ課金」。

const WebSocket = require('ws');

const URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

let ws = null;
let ready = false;
let connecting = null;
let pending = null;          // { resolve, itemId, timer } 1件ずつ処理
let apiKey = '';
let model = 'gpt-realtime-whisper';

function configure(key, m) { apiKey = key || ''; if (m) model = m; }
function isConfigured() { return !!apiKey; }

function connect() {
  if (ready && ws) return Promise.resolve();
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    let settled = false;
    ws = new WebSocket(URL, { headers: { Authorization: 'Bearer ' + apiKey } });
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: { model, language: 'ja' },
              turn_detection: null
            }
          }
        }
      }));
    });
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch { return; }
      switch (m.type) {
        case 'session.updated':
          ready = true;
          if (!settled) { settled = true; resolve(); }
          break;
        case 'input_audio_buffer.committed':
          if (pending && !pending.itemId) pending.itemId = m.item_id;
          break;
        case 'conversation.item.input_audio_transcription.completed':
          if (pending && (!pending.itemId || pending.itemId === m.item_id)) {
            const p = pending; pending = null; clearTimeout(p.timer);
            p.resolve((m.transcript || '').trim());
          }
          break;
        case 'error':
          console.error('[openai-stt] error:', JSON.stringify(m.error).slice(0, 200));
          break;
      }
    });
    ws.on('error', (e) => {
      ready = false;
      if (!settled) { settled = true; reject(e); }
    });
    ws.on('close', () => {
      ready = false; ws = null; connecting = null;
      if (pending) { const p = pending; pending = null; clearTimeout(p.timer); p.resolve(''); }
    });
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('connect timeout')); } }, 10000);
  }).catch((e) => {
    connecting = null; ready = false;
    try { if (ws) ws.close(); } catch {}
    console.error('[openai-stt] 接続失敗:', e.message);
    throw e;
  });
  return connecting;
}

// Float32(24kHz mono) を文字起こし。失敗/未設定時は ''（呼び出し側でlocalフォールバック等）。
async function transcribe(float32) {
  if (!apiKey || !float32 || !float32.length) return '';
  try { await connect(); } catch { return ''; }
  if (!ready || pending) return '';   // 1件ずつ（呼び出し側でもガード）
  const buf = Buffer.alloc(float32.length * 2);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  const b64 = buf.toString('base64');
  return await new Promise((resolve) => {
    pending = { resolve, itemId: null, timer: setTimeout(() => {
      if (pending) { const p = pending; pending = null; p.resolve(''); }
    }, 15000) };
    try {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    } catch (e) {
      const p = pending; pending = null; clearTimeout(p.timer); resolve('');
    }
  });
}

function close() {
  try { if (ws) ws.close(); } catch {}
  ws = null; ready = false; connecting = null;
  if (pending) { clearTimeout(pending.timer); pending = null; }
}

module.exports = { configure, isConfigured, transcribe, close };
