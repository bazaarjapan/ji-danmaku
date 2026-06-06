'use strict';

const { execFile } = require('child_process');

function emptyWindowContext() {
  return { title: '', process: '' };
}

function parseMacForegroundOutput(stdout) {
  const lines = String(stdout || '').replace(/\r/g, '').split('\n');
  const process = (lines.shift() || '').trim();
  const title = lines.join('\n').trim();
  return { title, process };
}

function getWindowsForegroundWindow(execFileImpl = execFile) {
  return new Promise((resolve) => {
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
    execFileImpl(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(emptyWindowContext());
        try {
          const j = JSON.parse(stdout.trim());
          resolve({ title: j.title || '', process: j.process || '' });
        } catch {
          resolve(emptyWindowContext());
        }
      }
    );
  });
}

function getMacForegroundWindow(execFileImpl = execFile) {
  return new Promise((resolve) => {
    const script = `
tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set windowTitle to ""
  try
    set windowTitle to name of front window of frontApp
  end try
  return appName & linefeed & windowTitle
end tell
`;
    execFileImpl('osascript', ['-e', script], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(emptyWindowContext());
      resolve(parseMacForegroundOutput(stdout));
    });
  });
}

function getForegroundWindow(platform = process.platform, execFileImpl = execFile) {
  if (platform === 'win32') return getWindowsForegroundWindow(execFileImpl);
  if (platform === 'darwin') return getMacForegroundWindow(execFileImpl);
  return Promise.resolve(emptyWindowContext());
}

module.exports = {
  emptyWindowContext,
  getForegroundWindow,
  getMacForegroundWindow,
  getWindowsForegroundWindow,
  parseMacForegroundOutput
};
