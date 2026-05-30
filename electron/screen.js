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

// プライマリ画面のスクリーンショットを撮り PNG 保存して { file, signature } を返す。
// file: 弾幕ブレイン（Codex/Claude のビジョン）への入力に使う PNG パス。
// signature: 32x18 の極小ビットマップ(Buffer)。前サイクルとの差分で「画面が変化したか」を判定し、
//            無変化ならAI生成をスキップしてコスト(サブスク利用量)を抑えるために使う。
async function captureScreenshot(targetDisplay) {
  const display = targetDisplay || screen.getPrimaryDisplay();
  const { width, height } = display.size;
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
  // 対象ディスプレイの source を display_id で選ぶ（無ければ先頭）。
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  const img = src.thumbnail;
  if (img.isEmpty()) return null;
  const file = path.join(TMP, `shot.png`);
  fs.writeFileSync(file, img.toPNG());

  let signature = null;
  try {
    signature = img.resize({ width: 32, height: 18, quality: 'good' }).toBitmap();
  } catch {}
  return { file, signature };
}

// 2つの署名(BGRAビットマップ)の平均絶対差を返す(0-255)。大きいほど画面が変化。
function signatureDiff(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

module.exports = { getForegroundWindow, captureScreenshot, signatureDiff, TMP };
