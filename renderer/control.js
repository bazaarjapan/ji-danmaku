'use strict';

const $ = (id) => document.getElementById(id);
let cfg = null;
let running = false;

// ---- 初期化 ------------------------------------------------------------

async function init() {
  cfg = await window.ji.getConfig();
  reflectConfig();
  bindControls();
  window.ji.onRunning((r) => setRunning(r));
  window.ji.onStatus((s) => {
    if (s.brain) $('brainBadge').textContent = 'brain: ' + s.brain;
    // 停止後に届く遅延ステータスでUIを「配信中」に戻さないよう running でガード。
    if (s.idle !== undefined && running) {
      $('statusText').textContent = s.idle
        ? '💤 アイドル（画面変化なし → 生成スキップ中・節約）'
        : '配信中（弾幕が流れています）';
    }
    if (s.lastContext) {
      const c = s.lastContext;
      $('ctxInfo').textContent = c.process || c.title
        ? `見ている画面: ${c.process || ''} ${c.title ? '／ ' + c.title : ''}`.slice(0, 80)
        : '';
      window.ji.sendContext(c);
    }
  });
}

function reflectConfig() {
  $('brain').value = cfg.brain;
  $('ambientEnabled').checked = cfg.ambientEnabled !== false;
  $('ambientPerMinute').disabled = cfg.ambientEnabled === false;
  $('micEnabled').checked = !!cfg.micEnabled;
  $('sttEnabled').checked = !!cfg.sttEnabled;
  $('whisperModel').value = cfg.whisperModel;
  setSlider('captureIntervalMs', cfg.captureIntervalMs, (v) => (v / 1000).toFixed(0) + '秒', 'capLabel');
  setSlider('voiceReactivity', cfg.voiceReactivity, (v) => `声:${v}% / 画面:${100 - v}%`, 'vrLabel');
  setSlider('ambientPerMinute', cfg.ambientPerMinute, (v) => v + '個', 'ambLabel');
  setSlider('speedMs', cfg.speedMs, (v) => (v / 1000).toFixed(1) + '秒', 'spdLabel');
  setSlider('fontSize', cfg.fontSize, (v) => v + 'px', 'fsLabel');
  setSlider('opacity', cfg.opacity, (v) => Math.round(v * 100) + '%', 'opLabel');
}

function setSlider(id, val, fmt, labelId) {
  $(id).value = val;
  $(labelId).textContent = fmt(Number(val));
  $(id)._fmt = fmt;
  $(id)._label = labelId;
}

function bindControls() {
  $('toggle').addEventListener('click', async () => {
    running = await window.ji.toggle();
    setRunning(running);
  });

  $('testBtn').addEventListener('click', () => {
    window.ji.testComment($('testText').value || undefined);
    $('testText').value = '';
  });
  $('testText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('testBtn').click();
  });

  $('brain').addEventListener('change', () => patch({ brain: $('brain').value }));
  $('ambientEnabled').addEventListener('change', () => {
    const on = $('ambientEnabled').checked;
    patch({ ambientEnabled: on });
    $('ambientPerMinute').disabled = !on;  // OFF時は密度スライダーを無効化
  });
  $('micEnabled').addEventListener('change', () => {
    patch({ micEnabled: $('micEnabled').checked });
    if ($('micEnabled').checked) startMic(); else stopMic();
  });
  $('sttEnabled').addEventListener('change', () => {
    cfg.sttEnabled = $('sttEnabled').checked;
    patch({ sttEnabled: cfg.sttEnabled });
    if (cfg.sttEnabled) { if (micStream) startStt(); } else stopStt();
  });
  $('whisperModel').addEventListener('change', () => {
    cfg.whisperModel = $('whisperModel').value;
    patch({ whisperModel: cfg.whisperModel });
    restartStt();
  });

  for (const id of ['captureIntervalMs', 'voiceReactivity', 'ambientPerMinute', 'speedMs', 'fontSize', 'opacity']) {
    $(id).addEventListener('input', () => {
      const el = $(id);
      const num = id === 'opacity' ? parseFloat(el.value) : parseInt(el.value, 10);
      $(el._label).textContent = el._fmt(num);
      patch({ [id]: num });
    });
  }
}

let patchTimer = null;
let pendingPatch = {};
function patch(p) {
  Object.assign(pendingPatch, p);
  clearTimeout(patchTimer);
  patchTimer = setTimeout(async () => {
    cfg = await window.ji.setConfig(pendingPatch);
    pendingPatch = {};
  }, 150);
}

function setRunning(r) {
  running = r;
  const btn = $('toggle');
  btn.classList.toggle('on', r);
  btn.classList.toggle('off', !r);
  btn.innerHTML = r
    ? '■ 配信ストップ <span class="hot">(F8)</span>'
    : '▶ 配信スタート <span class="hot">(F8)</span>';
  $('dot').classList.toggle('live', r);
  $('statusText').textContent = r ? '配信中（弾幕が流れています）' : '停止中';
  if (r && $('micEnabled').checked) startMic();
}

// ---- マイク監視 --------------------------------------------------------

let audioCtx = null, analyser = null, micStream = null, micRAF = null, scriptNode = null;
let lastTranscript = '', speaking = false, speakDecay = 0;

// 音声認識(ローカルWhisper)は 16kHz mono で扱う。
const SR_HZ = 16000;
const STT_CHUNK = 4096;                  // ScriptProcessor のブロックサイズ(約0.256s)
const STT_MIN_SAMPLES = SR_HZ * 0.8;     // 0.8秒未満の発話は誤認識の元なので無視
const STT_MAX_SAMPLES = SR_HZ * 12;      // 12秒で強制的に区切る
const STT_SILENCE_CHUNKS = 3;            // 約0.77秒の無音で発話終了とみなす
const STT_PREROLL_CHUNKS = 2;            // 発話の頭欠けを防ぐため直前(約0.5s)を含める

async function startMic() {
  if (micStream) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    $('micInfo').textContent = 'マイク取得失敗: ' + e.message;
    return;
  }
  // Whisper入力に合わせて 16kHz で取り込む（ブラウザ側が自動リサンプル）。
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR_HZ });
  const src = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const buf = new Uint8Array(analyser.frequencyBinCount);

  const loop = () => {
    analyser.getByteTimeDomainData(buf);
    // RMS で音量(0-1)
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
    $('vuBar').style.width = (level * 100).toFixed(0) + '%';

    const th = cfg.micThreshold || 0.12;
    const justSpoke = level > th && !speaking;
    if (level > th) { speaking = true; speakDecay = 18; }
    else if (speakDecay > 0) { speakDecay--; if (speakDecay === 0) speaking = false; }

    window.ji.sendMic({ level, speaking, justSpoke, transcript: lastTranscript });
    micRAF = requestAnimationFrame(loop);
  };
  loop();
  $('micInfo').textContent = '🎤 マイク監視中';

  // 生PCMを拾って発話の切れ目でWhisperに渡す。
  scriptNode = audioCtx.createScriptProcessor(STT_CHUNK, 1, 1);
  scriptNode.onaudioprocess = onAudioFrame;
  src.connect(scriptNode);
  scriptNode.connect(audioCtx.destination); // 発火のため接続（出力は無音）

  if (cfg.sttEnabled) startStt();
}

function stopMic() {
  if (micRAF) cancelAnimationFrame(micRAF);
  micRAF = null;
  if (scriptNode) { try { scriptNode.disconnect(); } catch {} scriptNode.onaudioprocess = null; scriptNode = null; }
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  $('vuBar').style.width = '0%';
  $('micInfo').textContent = 'マイク停止';
  stopStt();
}

// ---- ローカルWhisper (Web Worker) --------------------------------------

let sttWorker = null, sttReady = false, sttBusy = false;
// VAD用の収集バッファ
let utterChunks = [], utterLen = 0, silentChunks = 0;
let preRoll = [];   // 無音中の直前チャンク（発話の頭を取りこぼさない）

function startStt() {
  if (sttWorker) return;
  sttReady = false; sttBusy = false;
  utterChunks = []; utterLen = 0; silentChunks = 0; preRoll = [];
  try {
    sttWorker = new Worker('whisper-worker.js', { type: 'module' });
  } catch (e) {
    $('sttInfo').textContent = 'Whisper起動失敗: ' + e.message;
    sttWorker = null;
    return;
  }
  sttWorker.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === 'progress') {
      if (m.status === 'progress' && typeof m.progress === 'number') {
        $('sttInfo').textContent = `WhisperモデルDL中… ${Math.round(m.progress)}%`;
      }
    } else if (m.type === 'ready') {
      sttReady = true;
      $('sttInfo').textContent = `🧠 Whisper準備OK（${m.device || 'wasm'}・発話を文字起こし中）`;
    } else if (m.type === 'result') {
      sttBusy = false;
      if (m.text) {
        lastTranscript = m.text.slice(-120);
        $('sttInfo').textContent = '認識: ' + lastTranscript;
      }
    } else if (m.type === 'skipped') {
      sttBusy = false;
    } else if (m.type === 'error') {
      sttBusy = false;
      $('sttInfo').textContent = 'Whisperエラー: ' + (m.message || '').slice(0, 80);
    }
  };
  sttWorker.onerror = (e) => { $('sttInfo').textContent = 'Whisperエラー: ' + e.message; };
  sttWorker.postMessage({ type: 'load', model: cfg.whisperModel });
  $('sttInfo').textContent = 'Whisperモデル読込中…（初回はDL）';
}

function stopStt() {
  if (sttWorker) { try { sttWorker.terminate(); } catch {} sttWorker = null; }
  sttReady = false; sttBusy = false;
  utterChunks = []; utterLen = 0; silentChunks = 0;
  preRoll = [];
  lastTranscript = '';
  $('sttInfo').textContent = '';
}

// 設定変更でモデルを切り替えるときの再起動。
function restartStt() {
  if (!micStream) return;        // マイク停止中なら次回startMicで反映
  stopStt();
  if (cfg.sttEnabled) startStt();
}

// ScriptProcessor から呼ばれる: 発話を貯めて、切れ目でWhisperへ。
function onAudioFrame(e) {
  if (!sttWorker) return;
  const input = e.inputBuffer.getChannelData(0);
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
  const level = Math.min(1, Math.sqrt(sum / input.length) * 3.2);
  const active = level > (cfg.micThreshold || 0.12);

  if (active) {
    // 発話の立ち上がりでプリロール(直前の無音)を頭に足し、最初の音の欠けを防ぐ。
    if (utterLen === 0 && preRoll.length) {
      for (const c of preRoll) { utterChunks.push(c); utterLen += c.length; }
      preRoll = [];
    }
    utterChunks.push(new Float32Array(input)); // inputBufferは再利用されるのでコピー
    utterLen += input.length;
    silentChunks = 0;
  } else if (utterLen > 0) {
    utterChunks.push(new Float32Array(input)); // 語尾を切らないよう無音も少し含める
    utterLen += input.length;
    silentChunks++;
  } else {
    // 無音中: プリロールをローリング更新（直近 STT_PREROLL_CHUNKS 個を保持）。
    preRoll.push(new Float32Array(input));
    if (preRoll.length > STT_PREROLL_CHUNKS) preRoll.shift();
  }

  if (utterLen >= STT_MAX_SAMPLES || (silentChunks >= STT_SILENCE_CHUNKS && utterLen > 0)) {
    flushUtterance();
  }
}

function flushUtterance() {
  const chunks = utterChunks, total = utterLen;
  utterChunks = []; utterLen = 0; silentChunks = 0;
  if (total < STT_MIN_SAMPLES) return;        // 短すぎ → 破棄
  if (!sttReady || sttBusy) return;           // モデル未準備/処理中 → 今回は捨てて溜めない
  const audio = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { audio.set(c, off); off += c.length; }
  sttBusy = true;
  sttWorker.postMessage({ type: 'transcribe', model: cfg.whisperModel, audio }, [audio.buffer]);
}

init();
