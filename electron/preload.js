'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ji', {
  // 設定
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),

  // 配信制御
  toggle: (on) => ipcRenderer.invoke('toggle', on),
  testComment: (text) => ipcRenderer.invoke('test-comment', text),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),

  // マイク状態送信（コントロール画面 → main）
  sendMic: (state) => ipcRenderer.send('mic', state),
  sendContext: (c) => ipcRenderer.send('context-cache', c),

  // クラウド音声認識(OpenAI)用: 発話音声を main へ送り、文字起こし結果を受け取る
  sttTranscribe: (audio) => ipcRenderer.send('stt-utterance', audio),
  sttStop: () => ipcRenderer.send('stt-stop'),
  onSttResult: (cb) => ipcRenderer.on('stt-result', (_e, r) => cb(r)),

  // 受信
  onDanmaku: (cb) => ipcRenderer.on('danmaku', (_e, d) => cb(d)),
  onStyle: (cb) => ipcRenderer.on('style', (_e, s) => cb(s)),
  onRunning: (cb) => ipcRenderer.on('running', (_e, r) => cb(r)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
});
