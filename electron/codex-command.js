'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function codexCommandCandidates(platform = process.platform, env = process.env) {
  if (platform !== 'win32') return ['codex'];

  const winPath = path.win32;
  const userProfile = env.USERPROFILE || os.homedir();
  const appData = env.APPDATA || winPath.join(userProfile, 'AppData', 'Roaming');

  return unique([
    winPath.join(appData, 'npm', 'codex.cmd'),
    winPath.join(userProfile, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
    'codex',
    'codex.cmd'
  ]);
}

function resolveCodexCommand(platform = process.platform, env = process.env, existsSync = fs.existsSync) {
  const candidates = codexCommandCandidates(platform, env);
  if (platform !== 'win32') return candidates[0];
  return candidates.find((candidate) => !path.win32.isAbsolute(candidate) || existsSync(candidate)) || candidates[0];
}

function quoteWindowsCmdToken(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function codexCommandTarget(command, args = [], platform = process.platform, env = process.env) {
  if (platform !== 'win32') {
    return {
      command,
      args,
      options: { windowsHide: true }
    };
  }

  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${[command, ...args].map(quoteWindowsCmdToken).join(' ')}"`],
    options: { windowsHide: true, windowsVerbatimArguments: true }
  };
}

module.exports = {
  codexCommandCandidates,
  resolveCodexCommand,
  codexCommandTarget
};
