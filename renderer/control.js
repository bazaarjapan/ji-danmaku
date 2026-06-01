'use strict';

const $ = (id) => document.getElementById(id);
const DEFAULT_WHISPER_MODEL = 'Xenova/whisper-small';
const DEFAULT_NG_WORDS = ['死ね', '殺す', 'ぶっ殺', '消えろ', 'クズ', 'カス', 'ブス', 'デブ', 'キモい', 'ウザい', '黙れ'];
const PRESETS = {
  chat: {
    captureIntervalMs: 12000,
    voiceReactivity: 75,
    ambientEnabled: true,
    ambientPerMinute: 55,
    speedMs: 8000,
    fontSize: 30,
    opacity: 0.92
  },
  work: {
    captureIntervalMs: 16000,
    voiceReactivity: 55,
    ambientEnabled: true,
    ambientPerMinute: 25,
    speedMs: 9500,
    fontSize: 28,
    opacity: 0.88
  },
  game: {
    captureIntervalMs: 8000,
    voiceReactivity: 45,
    ambientEnabled: true,
    ambientPerMinute: 70,
    speedMs: 6500,
    fontSize: 28,
    opacity: 0.9
  },
  presentation: {
    captureIntervalMs: 14000,
    voiceReactivity: 85,
    ambientEnabled: true,
    ambientPerMinute: 12,
    speedMs: 11000,
    fontSize: 32,
    opacity: 0.86
  },
  quiet: {
    captureIntervalMs: 18000,
    voiceReactivity: 50,
    ambientEnabled: false,
    ambientPerMinute: 0,
    speedMs: 11000,
    fontSize: 26,
    opacity: 0.78
  },
  lively: {
    captureIntervalMs: 7000,
    voiceReactivity: 80,
    ambientEnabled: true,
    ambientPerMinute: 95,
    speedMs: 6200,
    fontSize: 32,
    opacity: 0.94
  }
};
let cfg = null;
let running = false;
let runtimeDiagnostics = {};
let applyingPreset = false;

// 関係ない項目を隠して見やすくする。
function show(id, on) { const el = $(id); if (el) el.classList.toggle('hidden', !on); }
function applyVisibility() {
  const mic = $('micEnabled').checked;
  const stt = $('sttEnabled').checked;
  const openai = $('sttBackend').value === 'openai';
  const filler = $('ambientEnabled').checked;
  show('micDetails', mic);                       // マイクON時だけ音声詳細
  show('sttOptions', mic && stt);                // 文字起こしON時だけエンジン等
  show('whisperModelField', mic && stt && !openai); // ローカル時だけWhisperモデル
  show('openaiKeyField', mic && stt && openai);  // GPT Realtime Whisper時だけAPIキー
  show('sttCost', mic && stt && openai);         // GPT Realtime Whisper時だけ概算コスト
  show('ambientField', filler);                  // フィラーON時だけ密度
}

// ---- 初期化 ------------------------------------------------------------

async function init() {
  cfg = await window.ji.getConfig();
  await refreshMicDevices();
  reflectConfig();
  bindControls();
  applyVisibility();
  setSettingsOpen(false);
  window.ji.onRunning((r) => setRunning(r));
  window.ji.onSttResult(handleSttResult);
  window.ji.onEmergencyStop(handleEmergencyStop);
  window.ji.onStatus((s) => {
    if (s.brain) $('brainBadge').textContent = 'brain: ' + s.brain;
    if (s.privacyExcluded) {
      const message = s.privacyReason || 'プライバシー除外中';
      $('statusText').textContent = message;
      $('mainStatusText').textContent = '除外中';
      setPrivacyNotice(true, message);
    } else if (s.idle !== undefined) {
      setPrivacyNotice(false);
    }
    // 停止後に届く遅延ステータスでUIを「配信中」に戻さないよう running でガード。
    if (s.idle !== undefined && running && !s.privacyExcluded) {
      $('statusText').textContent = s.idle
        ? '💤 アイドル（画面変化なし → 生成スキップ中・節約）'
        : '配信中（弾幕が流れています）';
      $('mainStatusText').textContent = s.idle ? 'アイドル節約中' : '弾幕稼働中';
    }
    if (s.lastContext) {
      const c = s.lastContext;
      $('ctxInfo').textContent = c.process || c.title
        ? `見ている画面: ${c.process || ''} ${c.title ? '／ ' + c.title : ''}`.slice(0, 80)
        : '';
      window.ji.sendContext(c);
    }
  });
  window.ji.onDiagnostics(updateDiagnosticsPanel);
  updateDiagnosticsPanel(await window.ji.getRuntimeDiagnostics());
}

function reflectConfig() {
  $('preset').value = PRESETS[cfg.preset] ? cfg.preset : 'custom';
  $('brain').value = cfg.brain;
  $('commentTone').value = isKnownSelectValue('commentTone', cfg.commentTone) ? cfg.commentTone : 'balanced';
  $('micDeviceId').value = isKnownSelectValue('micDeviceId', cfg.micDeviceId) ? cfg.micDeviceId : '';
  $('ambientEnabled').checked = cfg.ambientEnabled !== false;
  $('ambientPerMinute').disabled = cfg.ambientEnabled === false;
  $('micEnabled').checked = !!cfg.micEnabled;
  $('sttEnabled').checked = !!cfg.sttEnabled;
  $('sttBackend').value = cfg.sttBackend || 'local';
  const whisperModel = isWhisperModel(cfg.whisperModel) ? cfg.whisperModel : DEFAULT_WHISPER_MODEL;
  $('whisperModel').value = whisperModel;
  if (cfg.whisperModel !== whisperModel) {
    cfg.whisperModel = whisperModel;
    patch({ whisperModel });
  }
  $('openaiApiKey').value = '';
  updateOpenAiKeyStatus();
  const privacy = cfg.privacyExclusions || {};
  $('privacyExclusionsEnabled').checked = privacy.enabled !== false;
  $('privacyProcessNames').value = listToText(privacy.processNames);
  $('privacyTitlePatterns').value = listToText(privacy.titlePatterns);
  $('ngMode').value = cfg.ngMode === 'mask' ? 'mask' : 'drop';
  renderNgWords();
  $('emergencyShortcut').textContent = cfg.emergencyStopShortcut || 'F9';
  setSlider('micThreshold', cfg.micThreshold || 0.12, (v) => Number(v).toFixed(2), 'micThresholdLabel');
  setSlider('captureIntervalMs', cfg.captureIntervalMs, (v) => (v / 1000).toFixed(0) + '秒', 'capLabel');
  setSlider('voiceReactivity', cfg.voiceReactivity, (v) => `声:${v}% / 画面:${100 - v}%`, 'vrLabel');
  setSlider('ambientPerMinute', cfg.ambientPerMinute, (v) => v + '個', 'ambLabel');
  setSlider('speedMs', cfg.speedMs, (v) => (v / 1000).toFixed(1) + '秒', 'spdLabel');
  setSlider('fontSize', cfg.fontSize, (v) => v + 'px', 'fsLabel');
  setSlider('opacity', cfg.opacity, (v) => Math.round(v * 100) + '%', 'opLabel');
  const safeZone = cfg.safeZone || {};
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    setSafeZoneSlider(edge, safeZone[edge] || 0);
  }
  // 起動時に累計の概算コストを表示。
  updateCost((cfg.openaiUsageMs / 60000) * (cfg.openaiSttUsdPerMin || 0.017), cfg.openaiUsageMs);
  setMainRunStatus(running);
  setStoppedInputStatus();
}

function setSlider(id, val, fmt, labelId) {
  $(id).value = val;
  $(labelId).textContent = fmt(Number(val));
  $(id)._fmt = fmt;
  $(id)._label = labelId;
}

function safeZoneControlId(edge) {
  return 'safeZone' + edge[0].toUpperCase() + edge.slice(1);
}

function safeZoneLabelId(edge) {
  return safeZoneControlId(edge) + 'Label';
}

function setSafeZoneSlider(edge, value) {
  const id = safeZoneControlId(edge);
  const labelId = safeZoneLabelId(edge);
  $(id).value = Number(value) || 0;
  $(labelId).textContent = `${Number(value) || 0}px`;
}

function listToText(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function textToList(value) {
  return String(value || '')
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNgWords(value) {
  const seen = new Set();
  const source = Array.isArray(value) ? value.join('\n') : value;
  const out = [];
  for (const word of textToList(source)) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

function setNgWordStatus(text, level) {
  const el = $('ngWordStatus');
  if (!el) return;
  el.classList.remove('ok', 'warn');
  if (level) el.classList.add(level);
  el.textContent = text || '';
}

function saveNgWords(words, message = '保存しました') {
  cfg.ngWords = normalizeNgWords(words);
  renderNgWords();
  patch({ ngWords: cfg.ngWords });
  setNgWordStatus(message, 'ok');
}

function renderNgWords() {
  const list = $('ngWordList');
  if (!list) return;
  list.innerHTML = '';
  const words = normalizeNgWords(cfg.ngWords || []);
  cfg.ngWords = words;
  if (!words.length) {
    const empty = document.createElement('span');
    empty.className = 'hint';
    empty.textContent = '登録なし';
    list.appendChild(empty);
    return;
  }
  for (const word of words) {
    const chip = document.createElement('span');
    chip.className = 'ng-chip';
    const label = document.createElement('span');
    label.textContent = word;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `${word} を削除`;
    remove.setAttribute('aria-label', `${word} を削除`);
    remove.addEventListener('click', () => saveNgWords(cfg.ngWords.filter((item) => item !== word), '削除しました'));
    chip.appendChild(label);
    chip.appendChild(remove);
    list.appendChild(chip);
  }
}

function addNgWord() {
  const input = $('ngWordInput');
  const additions = normalizeNgWords(input.value);
  if (!additions.length) {
    setNgWordStatus('追加するNGワードを入力してください', 'warn');
    return;
  }
  const before = normalizeNgWords(cfg.ngWords || []);
  const next = normalizeNgWords([...before, ...additions]);
  input.value = '';
  saveNgWords(next, next.length > before.length ? '追加しました' : '重複は追加しませんでした');
}

function resetNgWords() {
  saveNgWords(cfg.defaultNgWords || DEFAULT_NG_WORDS, '既定に戻しました');
}

function markPresetCustom() {
  if (applyingPreset) return {};
  $('preset').value = 'custom';
  return { preset: 'custom' };
}

function presetControlledPatch(values) {
  return mergeDiagnostics(markPresetCustom(), values);
}

async function applyPreset(value) {
  if (value === 'custom') {
    cfg = await flushPatch({ preset: 'custom' });
    return;
  }
  const preset = PRESETS[value];
  if (!preset) return;
  applyingPreset = true;
  try {
    const next = { preset: value, ...preset };
    cfg = mergeDiagnostics(cfg, next);
    reflectConfig();
    applyVisibility();
    cfg = await flushPatch(next);
    reflectConfig();
    applyVisibility();
  } finally {
    applyingPreset = false;
  }
}

function bindControls() {
  $('menuToggle').addEventListener('click', () => setSettingsOpen(true));
  $('menuClose').addEventListener('click', () => setSettingsOpen(false));
  $('settingsBackdrop').addEventListener('click', () => setSettingsOpen(false));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setSettingsOpen(false);
  });

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
  $('copyDiagnostics').addEventListener('click', copyDiagnostics);
  $('exportDiagnostics').addEventListener('click', exportDiagnostics);
  $('emergencyStop').addEventListener('click', emergencyStop);

  $('preset').addEventListener('change', () => applyPreset($('preset').value));
  $('brain').addEventListener('change', () => patch({ brain: $('brain').value }));
  $('commentTone').addEventListener('change', () => patch({ commentTone: $('commentTone').value }));
  $('ambientEnabled').addEventListener('change', () => {
    patch(presetControlledPatch({ ambientEnabled: $('ambientEnabled').checked }));
    applyVisibility();  // フィラーOFFで密度スライダーを隠す
  });
  $('micEnabled').addEventListener('change', () => {
    cfg.micEnabled = $('micEnabled').checked;
    patch({ micEnabled: cfg.micEnabled });
    if (running && cfg.micEnabled) startMic(); else stopMic();
    applyVisibility();
  });
  $('micDeviceId').addEventListener('change', () => {
    cfg.micDeviceId = $('micDeviceId').value;
    patch({ micDeviceId: cfg.micDeviceId });
    setCalibrationStatus('入力デバイスを切り替えました', 'ok');
    restartMic();
  });
  $('refreshMicDevices').addEventListener('click', refreshMicDevices);
  $('calibrateMic').addEventListener('click', calibrateMic);
  $('micThreshold').addEventListener('input', () => {
    const value = parseFloat($('micThreshold').value);
    cfg.micThreshold = value;
    $('micThresholdLabel').textContent = value.toFixed(2);
    patch({ micThreshold: value });
  });
  $('sttEnabled').addEventListener('change', () => {
    cfg.sttEnabled = $('sttEnabled').checked;
    patch({ sttEnabled: cfg.sttEnabled });
    if (cfg.sttEnabled) { if (micStream) startStt(); } else stopStt();
    if (!micStream) setStoppedInputStatus();
    applyVisibility();
  });
  $('whisperModel').addEventListener('change', () => {
    cfg.whisperModel = $('whisperModel').value;
    patch({ whisperModel: cfg.whisperModel });
    restartStt();
  });
  $('sttBackend').addEventListener('change', () => {
    cfg.sttBackend = $('sttBackend').value;
    patch({ sttBackend: cfg.sttBackend });
    applyVisibility();  // GPT Realtime Whisper選択でWhisperモデルを隠す
    updateOpenAiKeyStatus();
    // バックエンドで取り込みレートが変わるため、マイクごと再起動して反映。
    if (micStream) { stopMic(); if (running && cfg.micEnabled) startMic(); }
    else setStoppedInputStatus();
  });
  $('saveOpenaiApiKey').addEventListener('click', saveOpenAiKey);
  $('clearOpenaiApiKey').addEventListener('click', clearOpenAiKey);
  $('openaiApiKey').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveOpenAiKey();
  });
  $('privacyExclusionsEnabled').addEventListener('change', () => {
    patch({ privacyExclusions: { enabled: $('privacyExclusionsEnabled').checked } });
  });
  $('privacyProcessNames').addEventListener('input', () => {
    patch({ privacyExclusions: { processNames: textToList($('privacyProcessNames').value) } });
  });
  $('privacyTitlePatterns').addEventListener('input', () => {
    patch({ privacyExclusions: { titlePatterns: textToList($('privacyTitlePatterns').value) } });
  });
  $('ngMode').addEventListener('change', () => {
    cfg.ngMode = $('ngMode').value === 'mask' ? 'mask' : 'drop';
    patch({ ngMode: cfg.ngMode });
    setNgWordStatus('保存しました', 'ok');
  });
  $('addNgWord').addEventListener('click', addNgWord);
  $('ngWordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNgWord();
  });
  $('resetNgWords').addEventListener('click', resetNgWords);

  for (const id of ['captureIntervalMs', 'voiceReactivity', 'ambientPerMinute', 'speedMs', 'fontSize', 'opacity']) {
    $(id).addEventListener('input', () => {
      const el = $(id);
      const num = id === 'opacity' ? parseFloat(el.value) : parseInt(el.value, 10);
      $(el._label).textContent = el._fmt(num);
      patch(presetControlledPatch({ [id]: num }));
    });
  }
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    const id = safeZoneControlId(edge);
    $(id).addEventListener('input', () => {
      const value = parseInt($(id).value, 10) || 0;
      $(safeZoneLabelId(edge)).textContent = `${value}px`;
      patch({ safeZone: { [edge]: value } });
    });
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshMicDevices);
  }
}

let patchTimer = null;
let pendingPatch = {};
function patch(p) {
  pendingPatch = mergeDiagnostics(pendingPatch, p);
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => { flushPatch(); }, 150);
}

async function flushPatch(extra = {}) {
  clearTimeout(patchTimer);
  patchTimer = null;
  const merged = mergeDiagnostics(pendingPatch, extra);
  pendingPatch = {};
  if (!Object.keys(merged).length) return cfg;
  cfg = await window.ji.setConfig(merged);
  return cfg;
}

async function refreshMicDevices() {
  const select = $('micDeviceId');
  if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    setCalibrationStatus('音声入力デバイス一覧を取得できません', 'warn');
    return;
  }
  const selected = cfg ? (cfg.micDeviceId || '') : (select.value || '');
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((device) => device.kind === 'audioinput');
    select.innerHTML = '';
    select.appendChild(new Option('既定のマイク', ''));
    inputs.forEach((device, index) => {
      const label = device.label || `マイク ${index + 1}`;
      select.appendChild(new Option(label, device.deviceId));
    });
    if (selected && !inputs.some((device) => device.deviceId === selected)) {
      select.appendChild(new Option('選択中のマイク（未接続）', selected));
    }
    select.value = selected && isKnownSelectValue('micDeviceId', selected) ? selected : '';
    select.disabled = inputs.length === 0;
    if (inputs.length === 0) {
      setCalibrationStatus('音声入力デバイスが見つかりません', 'warn');
    }
  } catch (e) {
    setCalibrationStatus('デバイス一覧の取得に失敗: ' + e.message, 'warn');
  }
}

function setCalibrationStatus(text, level) {
  const el = $('micCalibrationStatus');
  if (!el) return;
  el.classList.remove('ok', 'warn');
  if (level) el.classList.add(level);
  el.textContent = text || '';
}

function selectedMicLabel() {
  const select = $('micDeviceId');
  const option = select && select.selectedOptions && select.selectedOptions[0];
  return option ? option.textContent : '既定のマイク';
}

function audioConstraints() {
  if (cfg && cfg.micDeviceId) {
    return { audio: { deviceId: { exact: cfg.micDeviceId } } };
  }
  return { audio: true };
}

function isSelectedDeviceMissing(error) {
  return cfg && cfg.micDeviceId && ['NotFoundError', 'OverconstrainedError', 'DevicesNotFoundError'].includes(error && error.name);
}

function micErrorMessage(error) {
  if (!error) return 'マイク取得に失敗しました';
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return 'マイク権限が拒否されています。Windowsまたはブラウザの権限を確認してください';
  }
  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return '選択したマイクが見つかりません。デバイス更新または既定のマイクを選んでください';
  }
  if (error.name === 'NotReadableError') {
    return 'マイクを開けません。他のアプリが使用中の可能性があります';
  }
  return 'マイク取得失敗: ' + error.message;
}

function clampMicThreshold(value) {
  return Math.max(0.02, Math.min(0.4, value));
}

function computeCalibratedThreshold(samples) {
  const levels = samples.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!levels.length) return { threshold: 0.12, noiseFloor: 0, peak: 0 };
  const sum = levels.reduce((acc, value) => acc + value, 0);
  const noiseFloor = sum / levels.length;
  const peak = levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.95))] || 0;
  const threshold = clampMicThreshold(Math.max(0.04, noiseFloor * 2.8, peak * 1.7));
  return {
    threshold: Number(threshold.toFixed(2)),
    noiseFloor: Number(noiseFloor.toFixed(3)),
    peak: Number(peak.toFixed(3))
  };
}

function isWhisperModel(value) {
  return Array.from($('whisperModel').options).some((option) => option.value === value);
}

function isKnownSelectValue(id, value) {
  return Array.from($(id).options).some((option) => option.value === value);
}

function setSettingsOpen(open) {
  $('settingsPanel').classList.toggle('hidden', !open);
  $('settingsBackdrop').classList.toggle('hidden', !open);
  $('settingsPanel').setAttribute('aria-hidden', open ? 'false' : 'true');
  $('menuToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setSignal(cardId, textId, text, state = 'idle') {
  const card = $(cardId);
  const label = $(textId);
  if (card) card.dataset.state = state;
  if (label) label.textContent = text;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function mergeDiagnostics(base, patchData) {
  const out = { ...(base || {}) };
  for (const key of Object.keys(patchData || {})) {
    if (isPlainObject(out[key]) && isPlainObject(patchData[key])) {
      out[key] = mergeDiagnostics(out[key], patchData[key]);
    } else {
      out[key] = patchData[key];
    }
  }
  return out;
}

function stateFromRuntime(status) {
  if (status === 'generating' || status === 'loading') return 'loading';
  if (status === 'fallback') return 'loading';
  if (status === 'error') return 'error';
  if (status === 'muted') return 'muted';
  if (status === 'ready' || status === 'active') return 'ready';
  return 'idle';
}

function setDiagSignal(rowId, textId, text, state = 'idle') {
  const row = $(rowId);
  const label = $(textId);
  if (row) row.dataset.state = state;
  if (label) label.textContent = text;
}

function secondsText(ms) {
  const sec = Math.max(0, Math.ceil((ms || 0) / 1000));
  return `${sec}秒`;
}

function updateLocalSttDiagnostics(text, state = 'idle') {
  const status = state === 'loading'
    ? 'loading'
    : (state === 'error' ? 'error' : (state === 'muted' ? 'muted' : (state === 'ready' || state === 'active' ? 'ready' : 'idle')));
  updateDiagnosticsPanel({
    stt: {
      status,
      backend: cfg ? (cfg.sttBackend || 'local') : '',
      message: text || '',
      updatedAt: Date.now()
    }
  });
}

function updateDiagnosticsPanel(patchData) {
  runtimeDiagnostics = mergeDiagnostics(runtimeDiagnostics, patchData || {});
  renderDiagnosticsPanel();
}

function renderDiagnosticsPanel() {
  const aiDiag = runtimeDiagnostics.ai || {};
  const sttDiag = runtimeDiagnostics.stt || {};
  const codexDiag = runtimeDiagnostics.codex || {};
  const privacyDiag = runtimeDiagnostics.privacy || {};
  const safetyDiag = runtimeDiagnostics.safety || {};
  const aiBrain = aiDiag.requestedBrain || (cfg && cfg.brain) || 'codex';
  const aiText = privacyDiag.excluded
    ? '除外中'
    : (aiDiag.status === 'generating'
    ? `${aiBrain} 生成中`
    : (aiDiag.lastResult || (running ? '待機' : '停止')));
  setDiagSignal('diagAiRow', 'diagAiText', aiText, privacyDiag.excluded ? 'muted' : stateFromRuntime(aiDiag.status));

  const fallbackText = aiDiag.fallbackFrom
    ? `${aiDiag.fallbackFrom} -> ${aiDiag.source || 'mock'}`
    : 'なし';
  setDiagSignal('diagFallbackRow', 'diagFallbackText', fallbackText, aiDiag.fallbackFrom ? 'loading' : 'idle');

  let codexText = '待機';
  let codexState = 'idle';
  if (codexDiag.backoffRemainingMs > 0) {
    codexText = `バックオフ ${secondsText(codexDiag.backoffRemainingMs)}`;
    codexState = 'error';
  } else if (codexDiag.busy || (aiDiag.status === 'generating' && aiBrain === 'codex')) {
    codexText = '生成中';
    codexState = 'loading';
  } else if (codexDiag.serverRunning) {
    codexText = '接続中';
    codexState = 'ready';
  } else if (codexDiag.warned) {
    codexText = '警告あり';
    codexState = 'error';
  }
  setDiagSignal('diagCodexRow', 'diagCodexText', codexText, codexState);

  const sttBackend = sttDiag.backend === 'openai' ? 'GPT' : 'Local';
  const sttMessage = sttDiag.message || (cfg && cfg.sttEnabled ? '停止' : 'OFF');
  setDiagSignal('diagSttRow', 'diagSttText', `${sttBackend}: ${sttMessage}`, stateFromRuntime(sttDiag.status));

  const details = [];
  if (privacyDiag.excluded && privacyDiag.message) details.push(privacyDiag.message);
  if (aiDiag.lastError) details.push(aiDiag.lastError);
  if (codexDiag.consecutiveFails) details.push(`Codex失敗 ${codexDiag.consecutiveFails}回`);
  if (sttDiag.status === 'error' && sttDiag.message) details.push(sttDiag.message);
  if (safetyDiag.emergencyStoppedAt) details.push('緊急停止済み');
  $('diagDetail').textContent = details.join(' / ').slice(0, 160);
}

function setMainRunStatus(isRunning) {
  $('mainStatusText').textContent = isRunning ? '弾幕稼働中' : '停止中';
  const badge = $('mainModeBadge');
  badge.textContent = isRunning ? 'LIVE' : 'STANDBY';
  badge.classList.toggle('live', isRunning);
  badge.classList.toggle('off', !isRunning);
}

function setMicStatus(text, state = 'idle') {
  setSignal('micStateCard', 'micStateText', text, state);
}

function setSttStatus(text, state = 'idle') {
  setSignal('sttStateCard', 'sttStateText', text, state);
  updateLocalSttDiagnostics(text, state);
}

function setWhisperStatus(shortText, detailText, state = 'idle', progress = 0) {
  setSignal('whisperStateCard', 'whisperStateText', shortText, state);
  $('whisperDetailText').textContent = detailText;
  $('whisperProgressBar').style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function setSttInfo(text) {
  $('sttInfo').textContent = text || '';
}

function setStoppedInputStatus() {
  setMicStatus(
    micStream ? '監視中' : (cfg && cfg.micEnabled ? '停止' : 'OFF'),
    micStream ? 'active' : (cfg && cfg.micEnabled ? 'idle' : 'muted')
  );
  setSttStatus(cfg && cfg.sttEnabled ? '停止' : 'OFF', cfg && cfg.sttEnabled ? 'idle' : 'muted');
  setWhisperStatus(
    cfg && cfg.sttBackend === 'openai' ? 'GPT Realtime' : '未起動',
    cfg && cfg.sttEnabled ? 'スタートすると文字起こしを準備します' : '文字起こしはOFFです',
    cfg && cfg.sttEnabled ? 'idle' : 'muted',
    0
  );
  setSttInfo('');
}

function updateOpenAiKeyStatus(message, level) {
  const el = $('openaiKeyStatus');
  if (!el) return;
  el.classList.remove('ok', 'warn');
  if (level) el.classList.add(level);
  if (message) {
    el.textContent = message;
    return;
  }
  if (cfg.openaiApiKeySource === 'env') {
    el.classList.add('ok');
    el.textContent = '環境変数 OPENAI_API_KEY を使用中';
  } else if (cfg.openaiApiKeyConfigured) {
    el.classList.add('ok');
    el.textContent = '保存済みAPIキーを使用中';
  } else if (!cfg.openaiApiKeyStorageAvailable) {
    el.classList.add('warn');
    el.textContent = 'この環境ではAPIキーを安全に保存できません';
  } else {
    el.classList.add('warn');
    el.textContent = 'GPT Realtime Whisperを使う場合はAPIキーを保存してください';
  }
}

async function saveOpenAiKey() {
  const input = $('openaiApiKey');
  const key = input.value.trim();
  if (!key) {
    updateOpenAiKeyStatus('APIキーを入力してください', 'warn');
    return;
  }
  try {
    cfg = await flushPatch({ openaiApiKey: key });
    input.value = '';
    updateOpenAiKeyStatus('APIキーを保存しました', 'ok');
    if (isOpenAiStt()) restartStt();
  } catch (e) {
    updateOpenAiKeyStatus(e.message || 'APIキーの保存に失敗しました', 'warn');
  }
}

async function clearOpenAiKey() {
  try {
    cfg = await flushPatch({ openaiApiKey: '' });
    $('openaiApiKey').value = '';
    updateOpenAiKeyStatus();
    if (isOpenAiStt()) restartStt();
  } catch (e) {
    updateOpenAiKeyStatus(e.message || 'APIキーの削除に失敗しました', 'warn');
  }
}

function setDiagnosticsStatus(text, level) {
  const el = $('diagnosticsStatus');
  if (!el) return;
  el.classList.remove('ok', 'warn');
  if (level) el.classList.add(level);
  el.textContent = text || '';
}

function setEmergencyStatus(text, level) {
  const el = $('emergencyStatus');
  if (!el) return;
  el.classList.remove('ok', 'warn');
  if (level) el.classList.add(level);
  el.textContent = text || '';
}

function setPrivacyNotice(showNotice, text = '') {
  const el = $('privacyNotice');
  if (!el) return;
  el.classList.toggle('hidden', !showNotice);
  el.textContent = showNotice ? text : '';
}

async function copyDiagnostics() {
  try {
    const result = await window.ji.getDiagnostics();
    await navigator.clipboard.writeText(result.text);
    setDiagnosticsStatus('診断情報をコピーしました', 'ok');
  } catch (e) {
    setDiagnosticsStatus(e.message || '診断情報のコピーに失敗しました', 'warn');
  }
}

async function exportDiagnostics() {
  try {
    const result = await window.ji.exportDiagnostics();
    setDiagnosticsStatus(`保存しました: ${result.file}`, 'ok');
  } catch (e) {
    setDiagnosticsStatus(e.message || '診断情報の保存に失敗しました', 'warn');
  }
}

async function emergencyStop() {
  try {
    await window.ji.emergencyStop('control');
    handleEmergencyStop({ reason: 'control', shortcut: cfg.emergencyStopShortcut || 'F9' });
  } catch (e) {
    setEmergencyStatus(e.message || '緊急停止に失敗しました', 'warn');
  }
}

function handleEmergencyStop(payload = {}) {
  setRunning(false);
  const shortcut = payload.shortcut || (cfg && cfg.emergencyStopShortcut) || 'F9';
  setEmergencyStatus(`緊急停止しました（${shortcut}）`, 'ok');
  setPrivacyNotice(false);
}

function setRunning(r) {
  running = r;
  setMainRunStatus(r);
  const btn = $('toggle');
  btn.classList.toggle('on', r);
  btn.classList.toggle('off', !r);
  btn.innerHTML = r
    ? '■ 字弾幕ストップ'
    : '▶ 字弾幕スタート';
  $('dot').classList.toggle('live', r);
  $('statusText').textContent = r ? '配信中（弾幕が流れています）' : '停止中';
  if (!r) setPrivacyNotice(false);
  if (r && $('micEnabled').checked) startMic();
  else stopMic();
}

// ---- マイク監視 --------------------------------------------------------

let audioCtx = null, analyser = null, micStream = null, micRAF = null, scriptNode = null;
let micStartToken = 0;
let currentMicLevel = 0, micNoiseFrames = 0, calibrationActive = false;
let lastTranscript = '', speaking = false, speakDecay = 0;

// 取り込みサンプルレート: ローカルWhisperは16kHz、GPT Realtime Whisperは24kHz。
let sttSR = 16000;
const STT_CHUNK = 4096;                  // ScriptProcessor のブロックサイズ
const STT_PREROLL_CHUNKS = 2;            // 発話の頭欠けを防ぐため直前(約0.5s)を含める
function isOpenAiStt() { return cfg.sttBackend === 'openai'; }
// 区切り(会話の間)・最小長・最大長は実サンプルレートと設定から算出。
function sttChunkMs() { return (STT_CHUNK / sttSR) * 1000; }
function sttSilenceChunks() { return Math.max(2, Math.round((cfg.sttSilenceMs ?? 1200) / sttChunkMs())); }
function sttMinSamples() { return sttSR * 0.8; }   // 0.8秒未満は誤認識の元なので無視
function sttMaxSamples() { return sttSR * ((cfg.sttMaxMs ?? 20000) / 1000); }

async function requestMicStream() {
  try {
    return await navigator.mediaDevices.getUserMedia(audioConstraints());
  } catch (e) {
    if (!isSelectedDeviceMissing(e)) throw e;
    setCalibrationStatus('選択したマイクが見つからないため、既定のマイクで再試行します', 'warn');
    cfg.micDeviceId = '';
    $('micDeviceId').value = '';
    patch({ micDeviceId: '' });
    await refreshMicDevices();
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

async function startMic() {
  if (micStream) return;
  const token = ++micStartToken;
  setMicStatus('許可待ち', 'loading');
  setSttStatus(cfg.sttEnabled ? '待機中' : 'OFF', cfg.sttEnabled ? 'idle' : 'muted');
  let stream = null;
  try {
    stream = await requestMicStream();
  } catch (e) {
    if (token !== micStartToken || !running) return;
    const message = micErrorMessage(e);
    $('micInfo').textContent = message;
    setCalibrationStatus(message, 'warn');
    setMicStatus(e.name === 'NotAllowedError' ? '許可拒否' : '取得失敗', 'error');
    setSttStatus('停止', 'idle');
    return;
  }
  if (token !== micStartToken || !running || !cfg.micEnabled) {
    stream.getTracks().forEach((t) => t.stop());
    setStoppedInputStatus();
    return;
  }
  micStream = stream;
  await refreshMicDevices();
  if (token !== micStartToken || !micStream || micStream !== stream) {
    stream.getTracks().forEach((t) => t.stop());
    return;
  }
  // バックエンドに合わせた取り込みレート（ローカル16k / GPT Realtime Whisper 24k）。
  sttSR = isOpenAiStt() ? 24000 : 16000;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sttSR });
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
    currentMicLevel = level;
    $('vuBar').style.width = (level * 100).toFixed(0) + '%';

    const th = cfg.micThreshold || 0.12;
    const justSpoke = level > th && !speaking;
    if (level > th) { speaking = true; speakDecay = 18; }
    else if (speakDecay > 0) { speakDecay--; if (speakDecay === 0) speaking = false; }
    updateMicNoiseHint(level, th);

    window.ji.sendMic({ level, speaking, justSpoke, transcript: lastTranscript });
    micRAF = requestAnimationFrame(loop);
  };
  loop();
  const track = micStream.getAudioTracks()[0];
  $('micInfo').textContent = `🎤 マイク監視中: ${(track && track.label) || selectedMicLabel()}`;
  setCalibrationStatus(`しきい値 ${Number(cfg.micThreshold || 0.12).toFixed(2)}`, '');
  setMicStatus('監視中', 'active');

  // 生PCMを拾って発話の切れ目でWhisperに渡す。
  scriptNode = audioCtx.createScriptProcessor(STT_CHUNK, 1, 1);
  scriptNode.onaudioprocess = onAudioFrame;
  src.connect(scriptNode);
  scriptNode.connect(audioCtx.destination); // 発火のため接続（出力は無音）

  if (cfg.sttEnabled) startStt();
  else {
    setSttStatus('OFF', 'muted');
    setWhisperStatus('未起動', '文字起こしはOFFです', 'muted', 0);
  }
}

function stopMic() {
  micStartToken++;
  currentMicLevel = 0;
  micNoiseFrames = 0;
  calibrationActive = false;
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
  setMicStatus(cfg && cfg.micEnabled ? '停止' : 'OFF', cfg && cfg.micEnabled ? 'idle' : 'muted');
}

function restartMic() {
  if (micStream) stopMic();
  if (running && cfg.micEnabled) startMic();
}

function updateMicNoiseHint(level, threshold) {
  if (calibrationActive || !running || !cfg.micEnabled) return;
  const nearThreshold = level > Math.max(0.03, threshold * 0.75) && level <= threshold;
  micNoiseFrames = nearThreshold ? micNoiseFrames + 1 : Math.max(0, micNoiseFrames - 2);
  if (micNoiseFrames === 90) {
    setCalibrationStatus('周囲音がしきい値に近いです。自動調整を試してください', 'warn');
  }
}

async function calibrateMic() {
  if (!micStream) {
    setCalibrationStatus('字弾幕スタート後、静かな状態で実行してください', 'warn');
    return;
  }
  calibrationActive = true;
  micNoiseFrames = 0;
  const button = $('calibrateMic');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '測定中';
  setCalibrationStatus('2.5秒だけ静かにしてください', 'warn');
  const samples = [];
  const startedAt = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      samples.push(currentMicLevel);
      if (!micStream || performance.now() - startedAt >= 2500) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  button.disabled = false;
  button.textContent = originalText;
  calibrationActive = false;
  if (!micStream) {
    setCalibrationStatus('測定中にマイクが停止しました', 'warn');
    return;
  }
  const result = computeCalibratedThreshold(samples);
  cfg.micThreshold = result.threshold;
  setSlider('micThreshold', result.threshold, (v) => Number(v).toFixed(2), 'micThresholdLabel');
  patch({
    micThreshold: result.threshold,
    micCalibration: {
      noiseFloor: result.noiseFloor,
      peak: result.peak,
      calibratedAt: new Date().toISOString()
    }
  });
  const level = result.peak > 0.18 ? 'warn' : 'ok';
  const suffix = result.peak > 0.18 ? ' 周囲音が大きめです' : '';
  setCalibrationStatus(`しきい値を ${result.threshold.toFixed(2)} に調整しました${suffix}`, level);
}

// ---- ローカルWhisper (Web Worker) --------------------------------------

let sttWorker = null, sttReady = false, sttBusy = false, sttActive = false;
// VAD用の収集バッファ
let utterChunks = [], utterLen = 0, silentChunks = 0;
let preRoll = [];   // 無音中の直前チャンク（発話の頭を取りこぼさない）

function startStt() {
  if (sttActive) return;
  sttReady = false; sttBusy = false; sttActive = true;
  utterChunks = []; utterLen = 0; silentChunks = 0; preRoll = [];
  setSttStatus('準備中', 'loading');
  setWhisperStatus(
    isOpenAiStt() ? 'GPT Realtime' : '読込中',
    isOpenAiStt() ? 'GPT Realtime Whisperを準備中' : 'Whisperモデルを読込中です',
    'loading',
    12
  );

  // GPT Realtime Whisperバックエンド: workerを使わず、発話ごとに main 経由で Realtime文字起こしへ。
  if (isOpenAiStt()) {
    if (!cfg.openaiApiKeyConfigured) {
      sttReady = false; sttActive = false;
      const message = 'GPT Realtime Whisper用のOpenAI APIキーを保存してください';
      setSttInfo(message);
      setSttStatus('キー未設定', 'error');
      setWhisperStatus('要APIキー', message, 'error', 0);
      return;
    }
    sttReady = true;
    setSttInfo('☁ GPT Realtime Whisperで文字起こし');
    setSttStatus('待機中', 'ready');
    setWhisperStatus('GPT Realtime', '発話を検出するとクラウドで文字起こしします', 'ready', 100);
    return;
  }

  // ローカルWhisper: Web Worker
  try {
    sttWorker = new Worker('whisper-worker.js', { type: 'module' });
  } catch (e) {
    const message = 'Whisper起動失敗: ' + e.message;
    setSttInfo(message);
    setSttStatus('エラー', 'error');
    setWhisperStatus('起動失敗', message, 'error', 0);
    sttActive = false;
    sttWorker = null;
    return;
  }
  sttWorker.onmessage = (ev) => {
    const m = ev.data || {};
    if (m.type === 'progress') {
      if (m.status === 'progress' && typeof m.progress === 'number') {
        const progress = Math.round(m.progress);
        const message = `WhisperモデルDL中… ${progress}%`;
        setSttInfo(message);
        setSttStatus('準備中', 'loading');
        setWhisperStatus(`DL中 ${progress}%`, message, 'loading', progress);
      }
    } else if (m.type === 'ready') {
      sttReady = true;
      const message = `Whisper準備OK（${m.device || 'wasm'}・発話を文字起こし中）`;
      setSttInfo(`🧠 ${message}`);
      setSttStatus('待機中', 'ready');
      setWhisperStatus('準備OK', message, 'ready', 100);
    } else if (m.type === 'result') {
      sttBusy = false;
      if (m.text) { lastTranscript = m.text.slice(-120); pushRecognized(m.text); }
      setSttStatus('待機中', 'ready');
    } else if (m.type === 'skipped') {
      sttBusy = false;
      setSttStatus('待機中', 'ready');
    } else if (m.type === 'error') {
      sttBusy = false;
      const message = 'Whisperエラー: ' + (m.message || '').slice(0, 80);
      setSttInfo(message);
      setSttStatus('エラー', 'error');
      setWhisperStatus('エラー', message, 'error', 0);
    }
  };
  sttWorker.onerror = (e) => {
    const message = 'Whisperエラー: ' + e.message;
    setSttInfo(message);
    setSttStatus('エラー', 'error');
    setWhisperStatus('エラー', message, 'error', 0);
  };
  sttWorker.postMessage({ type: 'load', model: cfg.whisperModel });
  setSttInfo('Whisperモデル読込中…（初回はDL）');
}

function stopStt() {
  if (sttWorker) { try { sttWorker.terminate(); } catch {} sttWorker = null; }
  if (isOpenAiStt()) { try { window.ji.sttStop(); } catch {} }
  sttReady = false; sttBusy = false; sttActive = false;
  utterChunks = []; utterLen = 0; silentChunks = 0;
  preRoll = [];
  lastTranscript = '';
  setStoppedInputStatus();
}

// main からの OpenAI 文字起こし結果。
function handleSttResult(r) {
  sttBusy = false;
  if (!r) return;
  if (r.error) {
    const message = 'GPT Realtime Whisperエラー: ' + r.error;
    setSttInfo(message);
    setSttStatus('エラー', 'error');
    setWhisperStatus('エラー', message, 'error', 0);
    return;
  }
  if (typeof r.usageUsd === 'number') updateCost(r.usageUsd, r.usageMs);
  if (r.text) {
    lastTranscript = r.text.slice(-120);
    pushRecognized(r.text);
    setSttStatus('待機中', 'ready');
    setWhisperStatus('GPT Realtime', '発話を検出するとクラウドで文字起こしします', 'ready', 100);
  }
}

// OpenAI従量課金の概算表示（累計）。
function updateCost(usd, ms) {
  const sec = Math.round((ms || 0) / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  $('sttCost').textContent = `☁ OpenAI概算: $${(usd || 0).toFixed(4)}（累計 ${mm}分${ss}秒）`;
}

function updateMainTranscript(text) {
  const el = $('mainTranscript');
  if (!el || !text) return;
  el.textContent = text;
}

// どう聞き取ったか（認識テキスト）を直近6件まで履歴表示。
function pushRecognized(text) {
  updateMainTranscript(text);
  const log = $('sttLog');
  if (!log || !text) return;
  const div = document.createElement('div');
  div.className = 'rec';
  div.textContent = '🗣 ' + text;
  log.prepend(div);
  while (log.children.length > 6) log.removeChild(log.lastChild);
}

// 設定変更でモデルを切り替えるときの再起動。
function restartStt() {
  if (!micStream) return;        // マイク停止中なら次回startMicで反映
  stopStt();
  if (cfg.sttEnabled) startStt();
}

// ScriptProcessor から呼ばれる: 発話を貯めて、切れ目で文字起こしへ。
function onAudioFrame(e) {
  if (!sttActive) return;
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

  // 発話の終わりらしい「間」(sttSilenceMs)まで待って一文まるごと解析。
  // 区切りが来ない長文だけ sttMaxMs で強制区切り。
  if (utterLen >= sttMaxSamples() || (silentChunks >= sttSilenceChunks() && utterLen > 0)) {
    flushUtterance();
  }
}

function flushUtterance() {
  const chunks = utterChunks, total = utterLen;
  utterChunks = []; utterLen = 0; silentChunks = 0;
  if (total < sttMinSamples()) return;        // 短すぎ → 破棄
  if (!sttReady || sttBusy) return;           // 未準備/処理中 → 今回は捨てて溜めない
  const audio = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { audio.set(c, off); off += c.length; }
  sttBusy = true;
  setSttStatus('解析中', 'loading');
  if (isOpenAiStt()) {
    // main 経由で OpenAI Realtime へ（結果は onSttResult で受信）。
    window.ji.sttTranscribe(audio);
  } else if (sttWorker) {
    sttWorker.postMessage({ type: 'transcribe', model: cfg.whisperModel, audio }, [audio.buffer]);
  } else {
    sttBusy = false;
  }
}

init();
