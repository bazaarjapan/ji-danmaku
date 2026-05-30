'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ji', {
  // 設定
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (patch) => ipcRenderer.invoke('set-config', patch),

  // 配信制御
  toggle: (on) => ipcRenderer.invoke('toggle', on),
  testComment: (text) => ipcRenderer.invoke('test-comment', text),

  // マイク状態送信（コントロール画面 → main）
  sendMic: (state) => ipcRenderer.send('mic', state),
  sendContext: (c) => ipcRenderer.send('context-cache', c),

  // 受信
  onDanmaku: (cb) => ipcRenderer.on('danmaku', (_e, d) => cb(d)),
  onStyle: (cb) => ipcRenderer.on('style', (_e, s) => cb(s)),
  onRunning: (cb) => ipcRenderer.on('running', (_e, r) => cb(r)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, s) => cb(s))
});
