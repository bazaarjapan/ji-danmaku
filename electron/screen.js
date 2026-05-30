'use strict';

const { desktopCapturer, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP = path.join(os.tmpdir(), 'ji-danmaku');
try { fs.mkdirSync(TMP, { recursive: true }); } catch {}

// 前面ウィンドウのタイトルとプロセス名を取得（Windows）。
// 弾幕ブレインへの軽量なテキスト文脈として使う。
function getForegroundWindow() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ title: '', process: '' });
    const ps = `
$sig = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
'@
Add-Type $sig
$h = [W]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 1024
[void][W]::GetWindowText($h, $sb, 1024)
$pid2 = 0
[void][W]::GetWindowThreadProcessId($h, [ref]$pid2)
$p = try { (Get-Process -Id $pid2 -ErrorAction Stop).ProcessName } catch { '' }
$o = @{ title = $sb.ToString(); process = $p } | ConvertTo-Json -Compress
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Output $o
`;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve({ title: '', process: '' });
        try {
          const j = JSON.parse(stdout.trim());
          resolve({ title: j.title || '', process: j.process || '' });
        } catch {
          resolve({ title: '', process: '' });
        }
      }
    );
  });
}

// プライマリ画面のスクリーンショットを撮り PNG ファイルに保存してパスを返す。
// 弾幕ブレイン（Codex/Claude のビジョン）への入力に使う。
async function captureScreenshot() {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.size;
  // ビジョン入力には大きすぎない方が速いので長辺 ~1280 に縮小。
  const scale = Math.min(1, 1280 / Math.max(width, height));
  const thumb = {
    width: Math.round(width * scale),
    height: Math.round(height * scale)
  };
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: thumb
  });
  if (!sources.length) return null;
  const img = sources[0].thumbnail;
  if (img.isEmpty()) return null;
  const file = path.join(TMP, `shot.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

module.exports = { getForegroundWindow, captureScreenshot, TMP };
