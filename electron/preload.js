'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ji', {
  // 設定
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),
  exportConfig: () => ipcRenderer.invoke('export-config'),
  importConfig: () => ipcRenderer.invoke('import-config'),
  resetConfig: () => ipcRenderer.invoke('reset-config'),

  // 配信制御
  toggle: (on) => ipcRenderer.invoke('toggle', on),
  emergencyStop: (reason) => ipcRenderer.invoke('emergency-stop', reason),
  testComment: (text) => ipcRenderer.invoke('test-comment', text),
  getRuntimeDiagnostics: () => ipcRenderer.invoke('get-runtime-diagnostics'),
  runSetupDiagnostics: () => ipcRenderer.invoke('run-setup-diagnostics'),
  getDiagnostics: () => ipcRenderer.invoke('get-diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('export-diagnostics'),

  // マイク状態送信（コントロール画面 → main）
  sendMic: (state) => ipcRenderer.send('mic', state),
  sendContext: (c) => ipcRenderer.send('context-cache', c),

  // 受信
  onReactions: (cb) => ipcRenderer.on('reactions', (_e, d) => cb(d)),
  onClearReactions: (cb) => ipcRenderer.on('clear-reactions', () => cb()),
  onStyle: (cb) => ipcRenderer.on('style', (_e, s) => cb(s)),
  onRunning: (cb) => ipcRenderer.on('running', (_e, r) => cb(r)),
  onEmergencyStop: (cb) => ipcRenderer.on('emergency-stop', (_e, d) => cb(d)),
  onDiagnostics: (cb) => ipcRenderer.on('diagnostics', (_e, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
});
