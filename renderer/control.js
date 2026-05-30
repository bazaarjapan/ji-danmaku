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
  $('micEnabled').checked = !!cfg.micEnabled;
  setSlider('captureIntervalMs', cfg.captureIntervalMs, (v) => (v / 1000).toFixed(0) + '秒', 'capLabel');
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
  $('micEnabled').addEventListener('change', () => {
    patch({ micEnabled: $('micEnabled').checked });
    if ($('micEnabled').checked) startMic(); else stopMic();
  });

  for (const id of ['captureIntervalMs', 'ambientPerMinute', 'speedMs', 'fontSize', 'opacity']) {
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

let audioCtx = null, analyser = null, micStream = null, micRAF = null;
let recog = null, lastTranscript = '', speaking = false, speakDecay = 0;

async function startMic() {
  if (micStream) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    $('micInfo').textContent = 'マイク取得失敗: ' + e.message;
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

  startRecognition(); // 任意（環境により無効）
}

function stopMic() {
  if (micRAF) cancelAnimationFrame(micRAF);
  micRAF = null;
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  $('vuBar').style.width = '0%';
  $('micInfo').textContent = 'マイク停止';
  stopRecognition();
}

// Web Speech API（Chromium）。使えない環境では静かに無効化。
function startRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  try {
    recog = new SR();
    recog.lang = 'ja-JP';
    recog.continuous = true;
    recog.interimResults = true;
    recog.onresult = (ev) => {
      let t = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        t += ev.results[i][0].transcript;
      }
      lastTranscript = t.trim().slice(-60);
    };
    recog.onerror = () => {};
    recog.onend = () => { if (micStream) { try { recog.start(); } catch {} } };
    recog.start();
    $('micInfo').textContent = '🎤 マイク監視中（音声認識ON）';
  } catch {
    recog = null;
  }
}

function stopRecognition() {
  if (recog) { try { recog.stop(); } catch {} recog = null; }
  lastTranscript = '';
}

init();
